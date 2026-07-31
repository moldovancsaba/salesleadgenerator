import type { Db } from 'mongodb'

export const ACTIVITY_LOG_COLLECTION = 'activityLog'

// Issue #140 — the first genuinely unified per-lead activity/conversation
// timeline this app has ever had. Deliberately a NEW, separate collection
// rather than embedded on the lead document: email bodies can be large and
// this is expected to grow fast, and every existing GET /api/leads response
// already has enough payload without also carrying full timeline history for
// a board view that never renders it.
//
// Nothing in this codebase writes to this collection yet — issue #141 (the
// inbound-email webhook) is the first real writer. Until then this endpoint
// legitimately returns only the outreach_logs half of the merge below; that
// is not a bug, it's the honest state of a not-yet-fully-built feature.
export type ActivityEntryType = 'email-outbound' | 'email-inbound' | 'note' | 'system'
export type ActivitySource = 'inbound-webhook' | 'manual' | 'outreach-log'

export type ActivityEntry = {
  id: string
  leadId: string
  type: ActivityEntryType
  direction: 'outbound' | 'inbound' | null
  fromAddress?: string
  toAddresses?: string[]
  ccAddresses?: string[]
  subject?: string
  bodyExcerpt?: string
  matchedContactKey?: string | null
  source: ActivitySource
  createdAt: string
}

// Lazily ensures the documented index exists — same idempotent,
// call-on-every-request pattern as app/lib/forecast-snapshot.ts's
// ensureIndexes(), not verified against a live Atlas cluster from this
// sandbox (no MONGODB_URI here).
let indexesEnsured = false
export async function ensureActivityLogIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return
  try {
    await db.collection(ACTIVITY_LOG_COLLECTION).createIndex({ leadId: 1, createdAt: -1 })
    indexesEnsured = true
  } catch (error) {
    console.error('[activity-log-store] index creation failed', error)
  }
}

function truncateBody(body: string | undefined | null, maxLength = 280): string | undefined {
  if (!body) return undefined
  const trimmed = body.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, maxLength)}…`
}

// outreach_logs (app/api/outreach-logs/route.ts) predates activityLog and has
// its own real consumers (the outreach compose modal's own send history) —
// it is not migrated or renamed, only read here and mapped into the same
// shape so it can render in one merged timeline alongside future
// activityLog entries.
export function mapOutreachLogToActivityEntry(log: any): ActivityEntry {
  return {
    id: log._id.toString(),
    leadId: String(log.leadId || ''),
    type: 'email-outbound',
    direction: 'outbound',
    subject: log.subject || undefined,
    bodyExcerpt: truncateBody(log.body),
    matchedContactKey: null,
    source: 'outreach-log',
    createdAt: (log.createdAt instanceof Date ? log.createdAt : new Date(log.createdAt)).toISOString(),
  }
}

export function mapActivityLogDoc(doc: any): ActivityEntry {
  return {
    id: doc._id.toString(),
    leadId: String(doc.leadId || ''),
    type: doc.type,
    direction: doc.direction ?? null,
    fromAddress: doc.fromAddress || undefined,
    toAddresses: Array.isArray(doc.toAddresses) ? doc.toAddresses : undefined,
    ccAddresses: Array.isArray(doc.ccAddresses) ? doc.ccAddresses : undefined,
    subject: doc.subject || undefined,
    bodyExcerpt: truncateBody(doc.bodyExcerpt),
    matchedContactKey: doc.matchedContactKey ?? null,
    source: doc.source,
    createdAt: (doc.createdAt instanceof Date ? doc.createdAt : new Date(doc.createdAt)).toISOString(),
  }
}

// Pure merge: each input is assumed already sorted newest-first and capped
// at `limit` by its caller — taking the top `limit` of each source before
// merging is sufficient to produce a correct top-`limit` merged result (any
// entry in the true top-N of the union must already be in the top-N of its
// own source), so this never needs to see a source's full, unbounded history.
export function mergeActivityTimeline(sources: ActivityEntry[][], limit: number): ActivityEntry[] {
  return sources
    .flat()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
}
