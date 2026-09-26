import { NextResponse, type NextRequest } from 'next/server'
import { executeLeadAction } from '../../../../lib/lead-actions'
import { resolveBrand, getBrandConfig } from '../../../../lib/brand'
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api'
import { getClientPromise, isMongoConfigured } from '../../../../../lib/mongodb'
import { inverseCounterDelta, deepEqual, UNDO_COLLECTION, type BulkAction } from '../../../../../lib/bulk-undo'

// Bulk actions v2 (issue #203) — reverses a completed bulk action within
// its time-boxed window. Mongo-backed (bulkActionUndoTokens, TTL-indexed
// on expiresAt), not in-process state — this app runs on Vercel serverless
// functions, so the original PATCH /api/leads/bulk request and this later
// undo click are not guaranteed to hit the same running instance.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as any))
    const brand = await resolveBrand(body.brand)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })

    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = (body.tenantId || 'default').trim() || 'default'
    const token = typeof body.token === 'string' ? body.token : ''
    if (!token) {
      return NextResponse.json({ error: 'token is required' }, { status: 400 })
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()

    // Security (issue #203 §17) — the token must match the requester's own
    // authorized brand/tenant, not merely exist as a value somewhere in the
    // collection, so a token leaked or guessed by a different tenant's
    // session can never replay someone else's bulk action.
    const doc = await db.collection(UNDO_COLLECTION).findOne({ token, brand, tenantId })
    if (!doc) {
      return NextResponse.json({ error: 'Undo token not found' }, { status: 404 })
    }
    // Server-side expiresAt is the real authority, not the client's own
    // countdown timer (issue #203 §15 "window expiry race") — a request
    // that arrives after expiry gets 410 regardless of what the UI showed.
    if (new Date(doc.expiresAt).getTime() < Date.now()) {
      // Single-use even on expiry — an expired token is never valid again.
      await db.collection(UNDO_COLLECTION).deleteOne({ token })
      return NextResponse.json({ error: 'Undo window has expired' }, { status: 410 })
    }

    const config = (await getBrandConfig(brand))!
    const { ObjectId } = await import('mongodb')

    const action = doc.action as BulkAction
    const results: Array<{ leadId: string; success: boolean; error?: string }> = []
    const skipped: Array<{ leadId: string; reason: string }> = []

    for (const entry of doc.perLead as Array<{ leadId: string; before: Record<string, any>; after: Record<string, any> }>) {
      let current: any = null
      try {
        current = await db.collection(config.dbCollection).findOne({ _id: new ObjectId(entry.leadId) })
      } catch {
        current = null
      }
      if (!current) {
        skipped.push({ leadId: entry.leadId, reason: 'Lead not found' })
        continue
      }

      // Compare-and-swap (issue #203 §15 "CAS mismatch") — only apply the
      // inverse if the lead's current relevant fields still equal what the
      // original bulk action left them as; otherwise something else
      // touched this lead since, and silently overwriting that change
      // would be worse than skipping it.
      const casOk = Object.entries(entry.after).every(([key, value]) => deepEqual(current[key] ?? null, value ?? null))
      if (!casOk) {
        skipped.push({ leadId: entry.leadId, reason: 'Lead changed since the original action' })
        continue
      }

      const inverseResult = await executeLeadAction({
        brand,
        tenantId,
        leadId: entry.leadId,
        action: 'UNDO_BULK' as any,
        payload: { restoreFields: entry.before, restoreInc: inverseCounterDelta(action), originalAction: action },
      })
      results.push({ leadId: entry.leadId, success: inverseResult.success, error: inverseResult.success ? undefined : inverseResult.error })
    }

    // Single-use (issue #203 §15 "token reuse / double-click") — deleted
    // regardless of per-lead outcome; a second click after a first
    // successful undo gets a clean 404, never a duplicate reversal.
    await db.collection(UNDO_COLLECTION).deleteOne({ token })

    return NextResponse.json({ results, skipped })
  } catch (error: any) {
    console.error('[API:leads/bulk/undo] POST error:', error)
    return NextResponse.json({ error: 'Failed to undo bulk action' }, { status: 500 })
  }
}
