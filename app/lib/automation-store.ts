import type { Db } from 'mongodb'
import { ObjectId } from 'mongodb'
import {
  computeSetNextActionFields,
  buildNotificationLogEntry,
  matchesEventTrigger,
} from '../../lib/automation-rules'
import type { AutomationAction, AutomationRule, AutomationTriggerType } from '../../lib/automation-rules'

export const AUTOMATION_RULES_COLLECTION = 'automation_rules'
export const AUTOMATION_FIRINGS_COLLECTION = 'automation_rule_firings'
export const ACTIVITY_LOG_COLLECTION = 'activityLog'

// Lazy/idempotent, same convention as lib/bulk-undo.ts's
// ensureBulkUndoIndexes — a failed createIndex must never block a rule
// read/write/evaluation.
export async function ensureAutomationIndexes(db: Db): Promise<void> {
  try {
    await db.collection(AUTOMATION_RULES_COLLECTION).createIndex(
      { brand: 1, tenantId: 1, 'trigger.type': 1, enabled: 1 }
    )
    await db.collection(AUTOMATION_FIRINGS_COLLECTION).createIndex(
      { ruleId: 1, leadId: 1 },
      { unique: true }
    )
  } catch {
    // best-effort; see comment above
  }
}

function toRuleShape(doc: any): AutomationRule {
  return {
    id: doc._id.toString(),
    brand: doc.brand,
    tenantId: doc.tenantId,
    name: doc.name,
    trigger: doc.trigger,
    action: doc.action,
    enabled: doc.enabled === true,
    createdAt: doc.createdAt instanceof Date ? doc.createdAt.toISOString() : doc.createdAt,
    updatedAt: doc.updatedAt instanceof Date ? doc.updatedAt.toISOString() : doc.updatedAt,
    lastEvaluatedAt: doc.lastEvaluatedAt instanceof Date ? doc.lastEvaluatedAt.toISOString() : doc.lastEvaluatedAt,
    firingCount: doc.firingCount || 0,
  }
}

export { toRuleShape as automationRuleToResponseShape }

// The single executor both trigger paths (event-fired and tick-fired) share
// — issue #201 §8's own requirement, so set_next_action/apply_tag/
// log_notification behave identically no matter which trigger fired them.
// No case here re-emits a trigger event: this is what makes rule-chaining
// structurally impossible (§6's own non-goal), not merely undocumented.
export async function applyAction(
  db: Db,
  action: AutomationAction,
  leadId: string,
  leadsCollectionName: string,
  tenantId: string,
  brand: string,
  now: Date
): Promise<void> {
  if (action.type === 'set_next_action') {
    const fields = computeSetNextActionFields(action, now)
    await db.collection(leadsCollectionName).updateOne(
      { _id: new ObjectId(leadId) },
      { $set: { ...fields, updatedAt: now } }
    )
  } else if (action.type === 'apply_tag') {
    if (!action.tag) return
    await db.collection(leadsCollectionName).updateOne(
      { _id: new ObjectId(leadId) },
      { $addToSet: { tags: action.tag }, $set: { updatedAt: now } }
    )
  } else if (action.type === 'log_notification') {
    const entry = buildNotificationLogEntry(action, leadId, tenantId, brand, now)
    await db.collection(ACTIVITY_LOG_COLLECTION).insertOne(entry)
  }
}

async function recordFiring(db: Db, ruleId: string, now: Date): Promise<void> {
  await db.collection(AUTOMATION_RULES_COLLECTION).updateOne(
    { _id: new ObjectId(ruleId) },
    { $inc: { firingCount: 1 } }
  )
  void now
}

// Event-fired evaluation (lead_created / lead_moved_to_column) — called
// synchronously, in-process, from the two real write points (POST
// /api/leads and executeLeadAction()'s COLUMN_MOVE/PIN path, the latter
// only after checkStageGate() already passed). Failures are caught by the
// caller, never allowed to fail the underlying request — an automation rule
// misconfiguration must not be able to block lead creation or a kanban move.
export async function evaluateEventRules(
  db: Db,
  brand: string,
  tenantId: string,
  eventType: AutomationTriggerType,
  leadId: string,
  leadsCollectionName: string,
  context: { destinationColumn?: string } = {},
  now: Date = new Date()
): Promise<void> {
  const docs = await db.collection(AUTOMATION_RULES_COLLECTION)
    .find({ brand, tenantId, enabled: true, 'trigger.type': eventType })
    .toArray()

  for (const doc of docs) {
    if (!matchesEventTrigger(doc.trigger, eventType, context)) continue
    await applyAction(db, doc.action, leadId, leadsCollectionName, tenantId, brand, now)
    await recordFiring(db, doc._id.toString(), now)
  }
}

// Tick-fired evaluation for stale_no_activity rules — this brand's own slice
// of the daily /api/admin/automation-tick sweep. Callers loop every brand;
// this function handles exactly one brand+tenant's leads collection.
export type StaleTickResult = { rulesEvaluated: number; leadsScanned: number; actionsApplied: number }

export async function runStaleTickForBrand(
  db: Db,
  brand: string,
  tenantId: string,
  leadsCollectionName: string,
  maxScan: number,
  now: Date
): Promise<StaleTickResult> {
  const result: StaleTickResult = { rulesEvaluated: 0, leadsScanned: 0, actionsApplied: 0 }

  const ruleDocs = await db.collection(AUTOMATION_RULES_COLLECTION)
    .find({ brand, tenantId, enabled: true, 'trigger.type': 'stale_no_activity' })
    .toArray()
  if (ruleDocs.length === 0) return result

  // Cheap pre-filter: only leads whose updatedAt is at least as old as the
  // SMALLEST threshold across this brand's rules can possibly match any of
  // them — narrows the indexed query itself rather than filtering in memory
  // (issue #201 §11/§16's own "no full collection scan" requirement).
  const minThresholdDays = Math.min(...ruleDocs.map((r: any) => r.trigger.thresholdDays))
  const cutoff = new Date(now.getTime() - minThresholdDays * 24 * 60 * 60 * 1000)

  const { tenantFilter } = await import('../../lib/tenant')
  const candidateLeads = await db.collection(leadsCollectionName)
    .find({
      ...tenantFilter(tenantId),
      kanbanColumn: { $nin: ['WON', 'LOST'] },
      updatedAt: { $lte: cutoff },
    })
    .limit(maxScan)
    .toArray()
  result.leadsScanned = candidateLeads.length

  const { computeStaleness } = await import('../../lib/stale-deal')

  for (const rule of ruleDocs) {
    result.rulesEvaluated++
    const ruleId = rule._id.toString()
    const thresholdDays = rule.trigger.thresholdDays as number

    for (const lead of candidateLeads) {
      const staleness = computeStaleness(
        { kanbanColumn: lead.kanbanColumn, updatedAt: lead.updatedAt instanceof Date ? lead.updatedAt.toISOString() : lead.updatedAt },
        { [lead.kanbanColumn]: thresholdDays },
        now
      )
      if (!staleness) continue

      const leadId = lead._id.toString()
      const alreadyFiredToday = await hasFiredToday(db, ruleId, leadId, now)
      if (alreadyFiredToday) continue

      await applyAction(db, rule.action, leadId, leadsCollectionName, tenantId, brand, now)
      await recordFiring(db, ruleId, now)
      await db.collection(AUTOMATION_FIRINGS_COLLECTION).updateOne(
        { ruleId, leadId },
        { $set: { ruleId, leadId, firedAt: now } },
        { upsert: true }
      )
      result.actionsApplied++
    }

    await db.collection(AUTOMATION_RULES_COLLECTION).updateOne(
      { _id: rule._id },
      { $set: { lastEvaluatedAt: now } }
    )
  }

  return result
}

// One document per (rule, lead) pair — capped by construction (upserted,
// never appended), not a growing log — so a lead that stays stale across
// many ticks doesn't re-fire (and re-noise nextActionDueAt/apply_tag/
// log_notification) more than once per UTC calendar day (issue #201 §15's
// own flagged edge case, resolved rather than left silently ambiguous).
async function hasFiredToday(db: Db, ruleId: string, leadId: string, now: Date): Promise<boolean> {
  const doc = await db.collection(AUTOMATION_FIRINGS_COLLECTION).findOne({ ruleId, leadId })
  if (!doc) return false
  const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const firedAt = doc.firedAt instanceof Date ? doc.firedAt : new Date(doc.firedAt)
  return firedAt >= startOfToday
}
