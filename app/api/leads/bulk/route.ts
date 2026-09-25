import { NextResponse, type NextRequest } from 'next/server'
import { executeLeadAction } from '../../../lib/lead-actions'
import { resolveBrand, getBrandConfig } from '../../../lib/brand'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'
import { resolveSessionFromIdToken } from '../../../../lib/session'
import { getClientPromise, isMongoConfigured } from '../../../../lib/mongodb'
import { fieldsWrittenBy, inverseCounterDelta, pick, ensureBulkUndoIndexes, UNDO_COLLECTION, UNDO_WINDOW_MS, type BulkAction } from '../../../../lib/bulk-undo'

// Issue #70. No requireApiKey — matches PATCH /api/leads (app/api/leads/
// route.ts), which dropped that guard for the same reason (issue #91): this
// is called from the browser (app/kanban.tsx's bulk action bar), which has
// no safe way to hold SLG_API_KEY. Issue #104: gated by
// requireBrandAccessApi instead, same as PATCH /api/leads. brand comes from
// the JSON body here (not the query string), so the body must be parsed
// before the auth check and reused, not read twice.
const MAX_BULK_SIZE = 100
// ACCEPT joined DECLINE/PIN 2026-09-02: the review-feedback loop this app's own
// schema is built for (acceptanceCount/declineCount/feedbackScore) had a near-zero
// usage rate (1 of 3,027 leads on one tenant) traced to exactly this asymmetry —
// declining a backlog could be done in bulk, accepting one could not, so reviewing
// at scale meant opening thousands of leads one at a time. ACCEPT needs no extra
// payload (unlike DECLINE's declineReason), so it needed no new plumbing here,
// only joining the allow-list — executeLeadAction already handled it.
//
// Bulk actions v2 (issue #203) — FIELD_EDIT (bulk tag add/remove,
// qualityStatus set) and ASSIGN (bulk reassignment) joined 2026-09-25, once
// #198's Lead.assignedTo field existed to reassign at all (this issue's own
// §24 explicitly deferred ASSIGN until that landed — it now has).
const ALLOWED_BULK_ACTIONS = new Set(['ACCEPT', 'DECLINE', 'PIN', 'FIELD_EDIT', 'ASSIGN'])
// Every currently-allowed action is undoable — kept as its own set (not
// reused from ALLOWED_BULK_ACTIONS) so a future action that shouldn't be
// undoable can be added to the former without silently becoming reversible.
const UNDOABLE_ACTIONS = new Set(['ACCEPT', 'DECLINE', 'PIN', 'FIELD_EDIT', 'ASSIGN'])
const FIELD_EDIT_ALLOWED_FIELDS = new Set(['tags', 'qualityStatus'])
const QUALITY_STATUS_VALUES = new Set(['DRAFT', 'CHECKED', 'VERIFIED'])

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const brand = await resolveBrand(body.brand)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })

    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = (body.tenantId || 'default').trim() || 'default'
    const action = String(body.action || '').toUpperCase() as BulkAction
    // Issue #109: de-duplicated (stringified, first-seen order) before the
    // cap check and the processing loop — a duplicated id in the raw
    // request previously ran executeLeadAction twice for the same lead,
    // double-counting declineCount/feedbackScore and writing two
    // outcomelogs rows for what was really one logical action.
    const rawLeadIds = Array.isArray(body.leadIds) ? body.leadIds : []
    const leadIds = Array.from(new Set(rawLeadIds.map((id: unknown) => String(id))))
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}

    if (!ALLOWED_BULK_ACTIONS.has(action)) {
      return NextResponse.json({ error: 'action must be one of: ACCEPT, DECLINE, PIN, FIELD_EDIT, ASSIGN' }, { status: 400 })
    }

    if (leadIds.length === 0) {
      return NextResponse.json({ error: 'leadIds must be a non-empty array' }, { status: 400 })
    }

    if (leadIds.length > MAX_BULK_SIZE) {
      return NextResponse.json({ error: `leadIds exceeds the ${MAX_BULK_SIZE}-lead limit per request` }, { status: 400 })
    }

    // FIELD_EDIT reuses executeLeadAction's existing MODIFY branch — a bulk
    // field edit is just a MODIFY payload naming exactly one field, the
    // same validated write path a single-lead edit already goes through.
    // qualityStatus is a flat "set" (same target value for every lead in
    // the selection, computed once); tags is "add"/"remove" ONE tag against
    // each lead's own current tags[] (computed per-lead inside the loop,
    // since two leads in the same selection can already have different
    // tags), per the issue's own "add/remove a tag" framing (§5) rather
    // than a destructive whole-array replace.
    let field = ''
    let tagOp: 'add' | 'remove' | undefined
    let tagValue: string | undefined
    let staticActionPayload: Record<string, any> | undefined
    if (action === 'FIELD_EDIT') {
      field = typeof payload.field === 'string' ? payload.field : ''
      if (!FIELD_EDIT_ALLOWED_FIELDS.has(field)) {
        return NextResponse.json({ error: `field must be one of: ${Array.from(FIELD_EDIT_ALLOWED_FIELDS).join(', ')}` }, { status: 400 })
      }
      if (field === 'qualityStatus') {
        const value = payload.value
        if (typeof value !== 'string' || !QUALITY_STATUS_VALUES.has(value)) {
          return NextResponse.json({ error: `value must be one of: ${Array.from(QUALITY_STATUS_VALUES).join(', ')}` }, { status: 400 })
        }
        // executeLeadAction's MODIFY branch runs qualityStatus through
        // lib/quality-registry.ts's enforceQualityCeiling(), which clamps a
        // proposed value down to the lowest upstreamQualityStatuses entry —
        // defaulting to ['DRAFT'] when none is supplied, which would make
        // "bulk-set to CHECKED/VERIFIED" silently no-op back to DRAFT on
        // every lead, defeating this action's own point. A rep explicitly
        // choosing to bulk-set a status is itself the evidence for that
        // status (the same trust a human editor is given for any other
        // single-lead qualityStatus edit through this same MODIFY path) —
        // asserting it as its own upstream ceiling makes the set actually
        // take effect, matching this issue's own "qualityStatus set" goal.
        staticActionPayload = { qualityStatus: value, upstreamQualityStatuses: [value] }
      } else {
        tagValue = typeof payload.value === 'string' ? payload.value.trim() : ''
        if (!tagValue) {
          return NextResponse.json({ error: 'value is required for a tags edit' }, { status: 400 })
        }
        tagOp = payload.op === 'remove' ? 'remove' : 'add'
      }
    }

    // ASSIGN needs the caller's real identity (same as the single-lead
    // PATCH /api/leads route, app/api/leads/route.ts) — resolved once here,
    // not per lead. canAssign()'s per-lead authorization (self-assign
    // always allowed, cross-user reassignment admin-only) still runs inside
    // executeLeadAction exactly as it does for a single-lead ASSIGN.
    let actorId: string | undefined
    let actorEmail: string | undefined
    if (action === 'ASSIGN') {
      const idToken = request.cookies.get('sso_id_token')?.value
      const claims = await resolveSessionFromIdToken(idToken)
      actorId = claims?.sub
      actorEmail = claims?.email
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()
    const config = (await getBrandConfig(brand))!
    const { ObjectId } = await import('mongodb')

    const executeAction = action === 'FIELD_EDIT' ? 'MODIFY' : action
    const writtenFields = fieldsWrittenBy(action, field)

    // Sequential, not Promise.all — these are writes to shared per-lead
    // documents; reusing executeLeadAction exactly as the single-lead PATCH
    // route does (app/api/leads/route.ts) keeps this bulk path from ever
    // diverging from that business logic.
    const results: Array<{ leadId: string; success: boolean; error?: string }> = []
    const perLead: Array<{ leadId: string; before: Record<string, any>; after: Record<string, any>; cadenceCancelled: boolean }> = []

    for (const leadId of leadIds) {
      try {
        // Pre-image, captured here (new for #203) — needed both to snapshot
        // for undo and, for a per-lead tags op, to compute the next tags[]
        // value from THIS lead's own current tags rather than a shared one.
        let existingDoc: any = null
        if (writtenFields.length > 0) {
          try {
            existingDoc = await db.collection(config.dbCollection).findOne({ _id: new ObjectId(String(leadId)) })
          } catch {
            existingDoc = null
          }
        }

        let actionPayload: Record<string, any> = payload
        if (action === 'FIELD_EDIT') {
          if (field === 'qualityStatus') {
            actionPayload = staticActionPayload!
          } else {
            const currentTags: string[] = Array.isArray(existingDoc?.tags) ? existingDoc.tags : []
            const nextTags = tagOp === 'remove'
              ? currentTags.filter((t) => t !== tagValue)
              : Array.from(new Set([...currentTags, tagValue as string]))
            actionPayload = { tags: nextTags }
          }
        }

        const result = await executeLeadAction({
          brand,
          tenantId,
          leadId: String(leadId),
          action: executeAction as any,
          payload: actionPayload,
          actorId,
          actorEmail,
        })
        results.push({ leadId: String(leadId), success: result.success, error: result.success ? undefined : result.error })

        if (result.success && UNDOABLE_ACTIONS.has(action) && existingDoc && result.lead) {
          const cadenceCancelled = action === 'DECLINE' && Boolean(existingDoc.activeCadence) && !result.lead.activeCadence
          perLead.push({
            leadId: String(leadId),
            before: pick(existingDoc, writtenFields),
            after: pick(result.lead, writtenFields),
            cadenceCancelled,
          })
        }
      } catch (itemError: any) {
        // A malformed leadId throws synchronously inside executeLeadAction
        // (invalid ObjectId) rather than returning a normal {success:false}
        // result — caught here so one bad ID can't fail the whole batch.
        results.push({ leadId: String(leadId), success: false, error: itemError?.message || 'Invalid lead id' })
      }
    }

    let undo: { token: string; expiresAt: string; notReversible: Array<{ leadId: string; reason: string }> } | undefined
    if (perLead.length > 0) {
      const { randomBytes } = await import('crypto')
      const token = randomBytes(24).toString('hex')
      const now = new Date()
      const expiresAt = new Date(now.getTime() + UNDO_WINDOW_MS)
      await ensureBulkUndoIndexes(db)
      await db.collection(UNDO_COLLECTION).insertOne({
        token, brand, tenantId, action, field: field || null, createdAt: now, expiresAt, perLead,
      })
      undo = {
        token,
        expiresAt: expiresAt.toISOString(),
        notReversible: perLead.filter((p) => p.cadenceCancelled).map((p) => ({
          leadId: p.leadId,
          reason: 'Outreach cadence cancelled; undo will not resume it.',
        })),
      }
    }

    return NextResponse.json({ results, ...(undo ? { undo } : {}) })
  } catch (error: any) {
    console.error('[API:leads/bulk] PATCH error:', error)
    return NextResponse.json({ error: 'Failed to process bulk action', details: error.message }, { status: 500 })
  }
}
