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

// The write-side shape for a new activityLog document (issue #141, this
// collection's first real writer). `leadId` is nullable here — unlike
// ActivityEntry's read-side `leadId: string` (a display convenience, `''`
// when absent) — because a captured inbound-email event may not resolve to
// any known lead yet (no contactEmails[] cross-lead index exists until
// issue #142 ships). A null-leadId document is intentionally invisible to
// GET /api/leads/[id]/activity (which filters by a real leadId) rather than
// dropped — it stays queryable for future manual triage / reprocessing once
// #142's matching exists.
export type ActivityLogDocument = {
  leadId: string | null
  tenantId: string
  brand: string
  type: ActivityEntryType
  direction: 'outbound' | 'inbound' | null
  fromAddress?: string
  toAddresses?: string[]
  ccAddresses?: string[]
  subject?: string
  bodyExcerpt?: string
  matchedContactKey: string | null
  source: ActivitySource
  // The originating provider's own message identifier (Resend's email_id).
  // Only ever set by inbound-webhook writes — outreach-log-derived entries
  // aren't stored in this collection at all, they're only read/mapped from
  // outreach_logs. Backs the unique index that makes a webhook retry (an
  // expected, documented behavior for Resend and every other inbound-email
  // provider) a no-op instead of a duplicate.
  externalId?: string
  createdAt: Date
}

// Lazily ensures the documented indexes exist — same idempotent,
// call-on-every-request pattern as app/lib/forecast-snapshot.ts's
// ensureIndexes(), not verified against a live Atlas cluster from this
// sandbox (no MONGODB_URI here). The externalId index is sparse + unique:
// sparse because outreach-log-mapped entries never have one (they aren't
// stored in this collection), unique so a webhook retry's insert fails with
// a duplicate-key error the caller treats as "already processed," not a
// distinct index-per-write existence check.
let indexesEnsured = false
export async function ensureActivityLogIndexes(db: Db): Promise<void> {
  if (indexesEnsured) return
  try {
    const collection = db.collection(ACTIVITY_LOG_COLLECTION)
    await collection.createIndex({ leadId: 1, createdAt: -1 })
    await collection.createIndex({ externalId: 1 }, { unique: true, sparse: true })
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
