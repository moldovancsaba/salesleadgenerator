import { BRAND_CONFIG, PRO_FIELD, CON_FIELD } from './brand'
import { normalizeLead } from './normalize-lead'
import { validatePatchPayload } from '../../lib/validate-lead'
import { isMongoConfigured } from '../../lib/mongodb'
import { tenantFilter as buildTenantFilter } from '../../lib/tenant'
import { dedupeContacts, normalizeContact, contactKey, verifiableFieldsDiffer } from '../../lib/contacts'
import { scanTechStack } from '../../lib/tech-stack-scan'
import { computeTicketSizeForLead } from './ticket-size-store'
import { createManualTicketSizeOverride } from '../../lib/ticket-size'
import { defaultRevenueTargetCurrency } from './sales-settings'
import { checkStageGate, formatStageGateError } from '../../lib/stage-gate'

export type LeadActionInput = {
  brand: string
  tenantId: string
  leadId: string
  action: 'ACCEPT' | 'DECLINE' | 'MODIFY' | 'PIN' | 'REQUEST_REFRESH' | 'COLUMN_MOVE' | 'RESCAN_TECH'
  payload: Record<string, any>
}

export type LeadActionResult = {
  success: boolean
  lead?: Record<string, any>
  error?: string
  requestId?: string
}

export async function executeLeadAction(input: LeadActionInput): Promise<LeadActionResult> {
  const { brand, tenantId, leadId, action, payload } = input
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

  if (!isMongoConfigured()) {
    return { success: false, error: 'Database not configured', requestId }
  }

  const config = BRAND_CONFIG[brand]

  const client = await (await import('../../lib/mongodb')).getClientPromise()
  const db = client.db()
  const { ObjectId } = await import('mongodb')

  const tenantFilter = buildTenantFilter(tenantId)

  const existing = await db.collection(config.dbCollection).findOne({ _id: new ObjectId(leadId), ...tenantFilter })
  if (!existing) return { success: false, error: 'Lead not found', requestId }

  const validation = validatePatchPayload({ action, ...payload }, brand)
  if (!validation.valid) return { success: false, error: validation.errors.join('; '), requestId }

  const normalizedBody = normalizeLead({ ...existing, ...payload, action })
  const updateData: Record<string, any> = { updatedAt: new Date() }
  let outcomeValue: string = action

  // Issue #72: hard block, no bypass. Checked against normalizedBody (already
  // existing+payload merged), so a same-request field edit can satisfy the
  // gate, not just pre-existing lead state. DISCOVERED/QUALIFIED stay
  // auto-managed (lib/kanban-column.ts) and are never gated; WON/LOST are
  // terminal and not gated either.
  const destinationColumn = action === 'PIN' ? 'ENGAGED' : action === 'COLUMN_MOVE' ? normalizedBody.kanbanColumn : null
  if (destinationColumn) {
    const gate = checkStageGate(destinationColumn, normalizedBody)
    if (!gate.allowed) {
      return { success: false, error: formatStageGateError(destinationColumn, gate.missing), requestId }
    }
  }

  if (action === 'COLUMN_MOVE') {
    const now = new Date()
    updateData.kanbanColumn = normalizedBody.kanbanColumn
    updateData.sortOrder = normalizedBody.sortOrder || 0
    updateData.manualLaneOverrideAt = now
    // 24h cooldown: a drag-and-drop move to an arbitrary column is a lighter-weight
    // signal than an explicit PIN below, so it protects the lead from auto-reclassification
    // for a shorter window.
    updateData.manualLaneCooldownUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    updateData.manualLaneFloorColumn = normalizedBody.kanbanColumn
    updateData.manualLaneOverrideBy = normalizedBody.manualLaneOverrideBy || 'webapp-user'
    outcomeValue = `Moved to ${normalizedBody.kanbanColumn}`
  }

  if (action === 'ACCEPT') {
    updateData.status = 'qualified'
    updateData.acceptanceCount = (existing.acceptanceCount || 0) + 1
    updateData.feedbackScore = (existing.feedbackScore || 0) + 1
  }

  if (action === 'DECLINE') {
    updateData.status = 'lost'
    updateData.kanbanColumn = 'LOST'
    updateData.declineReason = normalizedBody.declineReason || 'OTHER'
    updateData.declinedAt = new Date()
    updateData.declineCount = (existing.declineCount || 0) + 1
    updateData.feedbackScore = (existing.feedbackScore || 0) - 1
    outcomeValue = normalizedBody.declineReason || 'DECLINED'
  }

  if (action === 'MODIFY') {
    const fields = ['entity_name', 'url', 'address', 'general_contact', 'size', 'industry',
                    'sport_or_sector', 'level_league', 'value_proposition', 'notes', 'tags',
                    'actualDealValueUsd']
    fields.forEach(field => {
      if (normalizedBody[field] !== undefined) updateData[field] = normalizedBody[field]
    })
    // The real, closed contract value once a lead is WON (issue #83) — coerced
    // to a real number here, the same corruption class the ice-field fix
    // (2.4.8) and PUT's own explicit `ice` coercion already guard against;
    // normalizeLead() has no special-case for this field, so without this it
    // would pass through as whatever type the client sent.
    if (updateData.actualDealValueUsd !== undefined) {
      const coerced = Number(updateData.actualDealValueUsd)
      updateData.actualDealValueUsd = Number.isFinite(coerced) ? coerced : undefined
    }
    // Manual ticket-size override (issue #86) — a rep's direct knowledge of a
    // specific deal takes precedence over the firmographic model. Requires a
    // non-empty reason (mirrors DECLINE's own required declineReason) so
    // #83's calibration report can see how often and why humans override the
    // model; a request with an expected value but no reason is silently
    // ignored (not applied, not erroring) rather than storing an
    // unaccountable override — the same "never fabricate/never corrupt"
    // contract as every other sanitizer in this codebase.
    const wantsOverride = normalizedBody.manualTicketSizeExpected !== undefined
      && normalizedBody.manualTicketSizeExpected !== null
      && normalizedBody.manualTicketSizeExpected !== ''
    const wantsClearOverride = normalizedBody.clearManualTicketSizeOverride === true

    if (wantsOverride) {
      const coercedExpected = Number(normalizedBody.manualTicketSizeExpected)
      const reason = typeof normalizedBody.manualTicketSizeReason === 'string' ? normalizedBody.manualTicketSizeReason.trim() : ''
      if (Number.isFinite(coercedExpected) && coercedExpected > 0 && reason) {
        const currency = existing.ticketSizeEstimate?.currency || defaultRevenueTargetCurrency(brand)
        updateData.ticketSizeEstimate = createManualTicketSizeOverride(
          { expected: coercedExpected, reason, overriddenBy: 'webapp-user' },
          currency
        )
        outcomeValue = `Manual ticket-size override: ${reason}`
      }
    } else if (wantsClearOverride) {
      // Reverts to the modeled estimate immediately, regardless of whether
      // `size` also changed in this same request.
      updateData.ticketSizeEstimate = await computeTicketSizeForLead(db, brand, tenantId, {
        size: updateData.size !== undefined ? updateData.size : existing.size,
        estimated_participants: existing.estimated_participants,
        region: existing.region,
      })
      outcomeValue = 'Manual ticket-size override cleared'
    } else if (
      updateData.size !== undefined
      && updateData.size !== existing.size
      && existing.ticketSizeEstimate?.method !== 'manual_override'
    ) {
      // Change-triggered ticket-size recompute (issue #82) — a size-tier edit
      // is exactly the kind of firmographic change that invalidates the
      // stored ticketSizeEstimate; recomputed inline (cheap, in-process, no
      // reason to defer) rather than waiting for the weekly cron sweep or a
      // Sales Settings save. estimated_participants isn't in MODIFY's own
      // field whitelist above, so the existing stored value is reused as-is.
      // Skipped when an active manual override exists (issue #86) — an
      // override permanently exempts the lead from this recompute until
      // explicitly cleared via wantsClearOverride above.
      updateData.ticketSizeEstimate = await computeTicketSizeForLead(db, brand, tenantId, {
        size: updateData.size,
        estimated_participants: existing.estimated_participants,
        region: existing.region,
      })
    }
    // Previously MODIFY had no way to touch contacts[] at all — the only path
    // that could write it was PUT. Added so decision-maker status (a flag on a
    // contact, not a top-level field — see lib/contacts.ts, issue #45) can
    // actually be edited via the same action the detail modal already uses.
    if (Array.isArray(normalizedBody.contacts)) {
      // Unlike POST/PUT, MODIFY is not necessarily a re-verification event —
      // handleModify() in app/detail.tsx sends the whole contacts[] array on
      // every save, even for unrelated field edits (e.g. a notes typo fix).
      // Only stamp lastVerifiedAt for a contact whose verifiable fields
      // (email/phone/linkedin/title/role) actually differ from what's
      // already stored for that same dedup key — everything else keeps its
      // prior timestamp (issue #66).
      const now = new Date()
      const existingByKey = new Map<string, ReturnType<typeof normalizeContact>>()
      dedupeContacts(existing.contacts).forEach((c) => existingByKey.set(contactKey(c), c))
      const stamped = normalizedBody.contacts.map((raw: Record<string, any>) => {
        const normalized = normalizeContact(raw)
        const key = contactKey(normalized)
        const match = key ? existingByKey.get(key) : undefined
        const changed = verifiableFieldsDiffer(match, normalized)
        return { ...raw, lastVerifiedAt: changed ? now.toISOString() : match?.lastVerifiedAt }
      })
      updateData.contacts = dedupeContacts(stamped)
    }
    if (normalizedBody[PRO_FIELD]) updateData[PRO_FIELD] = normalizedBody[PRO_FIELD]
    if (normalizedBody[CON_FIELD]) updateData[CON_FIELD] = normalizedBody[CON_FIELD]
    if (normalizedBody.qualityStatus) {
      const { enforceQualityCeiling } = await import('../../lib/quality-registry')
      const upstreamQuality = normalizedBody.upstreamQualityStatuses || ['DRAFT']
      updateData.qualityStatus = enforceQualityCeiling(normalizedBody.qualityStatus, upstreamQuality)
    }
  }

  if (action === 'PIN') {
    updateData.kanbanColumn = 'ENGAGED'
    const now = new Date()
    updateData.manualLaneOverrideAt = now
    // 48h cooldown: PIN is a deliberate "I'm actively working this lead" signal
    // (vs. an incidental drag), so it earns double COLUMN_MOVE's protection window.
    updateData.manualLaneCooldownUntil = new Date(now.getTime() + 48 * 60 * 60 * 1000)
    outcomeValue = 'Pinned to ENGAGED'
  }

  if (action === 'REQUEST_REFRESH') {
    outcomeValue = 'Refresh requested'
  }

  if (action === 'RESCAN_TECH') {
    // Deliberately scans existing.url (the lead's own stored homepage), never
    // a URL from the request payload — this action is not a general-purpose
    // "fetch any URL" endpoint, per issue #69's own requirement. Awaited
    // (unlike the POST-time scan) because this is an explicit user-triggered
    // action expecting an immediate result; scanTechStack() itself enforces a
    // 5s ceiling and never throws, so this can't hang the request.
    if (!existing.url || typeof existing.url !== 'string') {
      return { success: false, error: 'Lead has no url to scan', requestId }
    }
    const scan = await scanTechStack(existing.url)
    updateData.techSignals = scan.signals
    updateData.techSignalsScannedAt = scan.scannedAt
    updateData.techSignalsScanStatus = scan.status
    outcomeValue = `Tech scan: ${scan.status}`
  }

  const result = await db.collection(config.dbCollection).findOneAndUpdate(
    { _id: new ObjectId(leadId), ...tenantFilter },
    { $set: updateData },
    { returnDocument: 'after' }
  )

  if (!result) return { success: false, error: 'Lead not found after update', requestId }
  const updatedLead = result

  await db.collection('outcomelogs').insertOne({
    leadId,
    action,
    outcomeType: action,
    outcomeValue,
    annotation: payload.annotation || payload.notes || '',
    // Relative confidence recorded in the outcome-log audit trail for this action
    // type: DECLINE is the strongest signal (explicit rejection), MODIFY is a close
    // second (a human corrected the record), everything else is weaker/implicit.
    // Not currently read back by any scoring or learning code in this repo — see
    // docs/ARCHITECTURE.md's Outcome Log section.
    teachingWeight: action === 'MODIFY' ? 95 : action === 'DECLINE' ? 100 : 70,
    actorType: 'USER',
    actedBy: 'webapp-user',
    beforeState: {
      kanbanColumn: existing.kanbanColumn,
      status: existing.status,
      // Only present on the two ticket-size-override branches above — kept
      // out of every other action's log entry rather than always present-
      // but-usually-undefined (issue #86's audit trail).
      ticketSizeMethod: updateData.ticketSizeEstimate ? existing.ticketSizeEstimate?.method : undefined,
    },
    afterState: {
      kanbanColumn: updateData.kanbanColumn || existing.kanbanColumn,
      status: updateData.status || existing.status,
      ticketSizeMethod: updateData.ticketSizeEstimate?.method,
    },
    createdAt: new Date(),
    tenantId,
  })

  const normalizedLead = normalizeLead({ ...updatedLead, _id: updatedLead._id.toString() })

  return { success: true, lead: normalizedLead, requestId }
}
