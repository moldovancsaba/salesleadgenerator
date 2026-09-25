// Automation rule engine (issue #201) — a minimal, flat trigger→action
// engine generalizing the one proven execution model this repo already has
// (lib/cadences.ts's due-date sweep) to a small, fixed set of trigger/action
// types. Pure types + sanitize/validate/build logic here, mirroring
// lib/cadences.ts's own module split; the Mongo-aware evaluation layer
// (matching rules, writing the resulting field/collection updates) lives in
// app/lib/automation-store.ts.

export type AutomationTriggerType = 'lead_created' | 'lead_moved_to_column' | 'lead_assigned' | 'stale_no_activity'
export type AutomationActionType = 'set_next_action' | 'apply_tag' | 'log_notification'

export type AutomationTrigger =
  | { type: 'lead_created' }
  | { type: 'lead_moved_to_column'; column: string }
  // Schema-defined for forward-compatibility only — this repo has no
  // user/assignment model an event could fire from yet (see this module's
  // own header comment and issue #201 §6). Rejected at save time whenever
  // `enabled: true` is requested (validateAutomationRule below) so a rule
  // can never be silently dead without the admin knowing, and never offered
  // in the rule-editor UI.
  | { type: 'lead_assigned' }
  | { type: 'stale_no_activity'; thresholdDays: number }

export type AutomationAction =
  | { type: 'set_next_action'; dueInDays: number; note: string }
  | { type: 'apply_tag'; tag: string }
  | { type: 'log_notification'; message: string }

export type AutomationRule = {
  id: string
  brand: string
  tenantId: string
  name: string
  trigger: AutomationTrigger
  action: AutomationAction
  // Defaults false — same safety rail as Cadence.enabled (issue #124): a new
  // rule with real side effects on lead data must be explicitly activated.
  enabled: boolean
  createdAt: string
  updatedAt: string
  // Tick-fired rules only (stale_no_activity) — stamped on every tick run
  // regardless of whether it matched any lead, so the rule list can show
  // "this rule is actually running" (issue #201 §13).
  lastEvaluatedAt?: string
  // Incremented each time this rule's action actually fires (event- or
  // tick-fired alike) — the "firing count" the rule list surfaces per §13,
  // additive beyond the issue's own §9 schema sketch but required by its §13
  // UX text in the same breath as lastEvaluatedAt.
  firingCount?: number
}

const MAX_NAME_LENGTH = 200
const MAX_TAG_LENGTH = 60
const MAX_NOTE_LENGTH = 500
const MAX_MESSAGE_LENGTH = 1000
const MAX_DUE_IN_DAYS = 365
const MAX_THRESHOLD_DAYS = 3650

const TRIGGER_TYPES: AutomationTriggerType[] = ['lead_created', 'lead_moved_to_column', 'lead_assigned', 'stale_no_activity']
const ACTION_TYPES: AutomationActionType[] = ['set_next_action', 'apply_tag', 'log_notification']

// Returns null for anything unrecognized/malformed — never silently coerces
// to a default, matching lib/cadences.ts's sanitizeCadenceStep() convention.
export function sanitizeAutomationTrigger(input: any): AutomationTrigger | null {
  if (!input || typeof input !== 'object') return null
  const type = input.type
  if (!TRIGGER_TYPES.includes(type)) return null

  if (type === 'lead_created') return { type }
  if (type === 'lead_assigned') return { type }

  if (type === 'lead_moved_to_column') {
    const column = typeof input.column === 'string' ? input.column.trim().toUpperCase() : ''
    if (!column) return null
    return { type, column }
  }

  // stale_no_activity
  const rawThreshold = Number(input.thresholdDays)
  if (!Number.isFinite(rawThreshold) || rawThreshold <= 0) return null
  return { type, thresholdDays: Math.min(Math.round(rawThreshold), MAX_THRESHOLD_DAYS) }
}

export function sanitizeAutomationAction(input: any): AutomationAction | null {
  if (!input || typeof input !== 'object') return null
  const type = input.type
  if (!ACTION_TYPES.includes(type)) return null

  if (type === 'set_next_action') {
    const rawDue = Number(input.dueInDays)
    const dueInDays = Number.isFinite(rawDue) && rawDue >= 0 ? Math.min(Math.round(rawDue), MAX_DUE_IN_DAYS) : 0
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, MAX_NOTE_LENGTH) : ''
    return { type, dueInDays, note }
  }

  if (type === 'apply_tag') {
    const tag = typeof input.tag === 'string' ? input.tag.trim().slice(0, MAX_TAG_LENGTH) : ''
    return { type, tag }
  }

  // log_notification
  const message = typeof input.message === 'string' ? input.message.trim().slice(0, MAX_MESSAGE_LENGTH) : ''
  return { type, message }
}

export function sanitizeAutomationRule(
  body: Record<string, any>,
  brand: string,
  tenantId: string,
  existing?: { id: string; createdAt: string } | null,
  now?: Date
): AutomationRule {
  const nowIso = (now ?? new Date()).toISOString()
  const trigger = sanitizeAutomationTrigger(body.trigger)
  const action = sanitizeAutomationAction(body.action)
  return {
    id: existing?.id ?? '',
    brand,
    tenantId,
    name: typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : '',
    // A null trigger/action is carried through as a sentinel the validator
    // below rejects, rather than defaulting to some arbitrary trigger/action
    // — an unrecognized shape must never silently become a different rule
    // than the operator intended.
    trigger: trigger ?? ({ type: '' } as unknown as AutomationTrigger),
    action: action ?? ({ type: '' } as unknown as AutomationAction),
    enabled: body.enabled === true,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  }
}

// A rule with no name, no valid trigger, or no valid action can never
// meaningfully fire — rejected at save time, same "reject rather than
// persist a silently-broken rule" convention as validateCadence(). The
// lead_assigned/enabled=true combination is rejected here too (issue #201
// §15/§18's own edge case): this repo has no assignment model yet, so an
// enabled rule of this trigger type could never execute — better to refuse
// the save than let an admin believe it's live.
export function validateAutomationRule(rule: Pick<AutomationRule, 'name' | 'trigger' | 'action' | 'enabled'>): string[] {
  const errors: string[] = []
  if (!rule.name) errors.push('name is required')
  if (!rule.trigger || !TRIGGER_TYPES.includes(rule.trigger.type as AutomationTriggerType)) {
    errors.push('a valid trigger is required')
  } else if (rule.trigger.type === 'lead_moved_to_column' && !('column' in rule.trigger && rule.trigger.column)) {
    errors.push('lead_moved_to_column trigger requires a column')
  } else if (rule.trigger.type === 'stale_no_activity' && !('thresholdDays' in rule.trigger && rule.trigger.thresholdDays > 0)) {
    errors.push('stale_no_activity trigger requires a positive thresholdDays')
  }
  if (!rule.action || !ACTION_TYPES.includes(rule.action.type as AutomationActionType)) {
    errors.push('a valid action is required')
  } else if (rule.action.type === 'apply_tag' && !('tag' in rule.action && rule.action.tag)) {
    errors.push('apply_tag action requires a non-empty tag')
  } else if (rule.action.type === 'log_notification' && !('message' in rule.action && rule.action.message)) {
    errors.push('log_notification action requires a non-empty message')
  }
  if (rule.trigger?.type === 'lead_assigned' && rule.enabled) {
    errors.push('lead_assigned cannot be enabled yet — this app has no lead-assignment model for it to fire from')
  }
  return errors
}

// Pure field computation for the set_next_action action — split out from
// the DB-writing executor (app/lib/automation-store.ts) so the date math is
// independently unit-testable without a live clock or a database.
export function computeSetNextActionFields(
  action: Extract<AutomationAction, { type: 'set_next_action' }>,
  now: Date
): { nextActionDueAt: string; nextActionNote: string } {
  const dueMs = now.getTime() + action.dueInDays * 24 * 60 * 60 * 1000
  return { nextActionDueAt: new Date(dueMs).toISOString(), nextActionNote: action.note }
}

// Pure activityLog document shape for the log_notification action — see
// app/lib/activity-log-store.ts for the collection this is written into.
// `source: 'manual'` (not a new enum value) per issue #201 §11: the message
// is admin-authored rule config, not a new notification channel.
export function buildNotificationLogEntry(
  action: Extract<AutomationAction, { type: 'log_notification' }>,
  leadId: string,
  tenantId: string,
  brand: string,
  now: Date
) {
  return {
    leadId,
    tenantId,
    brand,
    type: 'system' as const,
    direction: null as 'outbound' | 'inbound' | null,
    bodyExcerpt: action.message,
    matchedContactKey: null as string | null,
    source: 'manual' as const,
    createdAt: now,
  }
}

// Matching logic for an event-fired trigger — pure so it's unit-testable
// without a database. eventType is always the trigger.type being evaluated
// (the caller already scoped the Mongo query to it); this only handles the
// extra per-type condition lead_moved_to_column carries.
export function matchesEventTrigger(
  trigger: AutomationTrigger,
  eventType: AutomationTriggerType,
  context: { destinationColumn?: string } = {}
): boolean {
  if (trigger.type !== eventType) return false
  if (trigger.type === 'lead_moved_to_column') {
    return trigger.column === context.destinationColumn
  }
  return true
}
