// Sales cadences (issue #124/#149) — a per-brand library of multi-step,
// multi-day outreach sequences. A `Cadence` is a reusable template; a lead's
// own position on one (which step, when the next is due) lives on the lead
// itself as `Lead.activeCadence` (app/types.ts), not here — this module only
// owns the template shape and the pure due-date math both the enroll API and
// the cadence-tick scheduler (issue #151) share, so they can never disagree
// about how a due date is computed.
//
// A `linkedin`/`call` step is never auto-sent (see issue #124's own
// Executive Summary — LinkedIn's User Agreement forbids automated message
// sending, confirmed via real research, not assumed) — only an `email` step
// is genuinely automated. This module doesn't know or care which channels
// are auto-sendable; that decision belongs to the scheduler (#151), not the
// data model.

export type CadenceStepChannel = 'email' | 'linkedin' | 'call';

export type CadenceStep = {
  id: string;
  channel: CadenceStepChannel;
  // Days to wait after the *previous* step before this one becomes due.
  // The first step's own value is honored as-is (0 means "due immediately
  // on enrollment"); it has no special forced-zero behavior distinct from
  // any other step — an operator building a cadence that intentionally
  // waits before its first touch is a valid, real use case.
  waitDaysAfterPrevious: number;
  // References an OutreachTemplate (app/lib/outreach/default-templates.ts)
  // for an email/linkedin step. Optional because a `call` step never has a
  // template — it's always just a reminder.
  templateId?: string;
  // Shown as Lead.nextActionNote when this step is a linkedin/call
  // reminder (issue #151) — irrelevant for an email step, which sends the
  // template's own content instead.
  reminderNote?: string;
};

export type CadenceInput = Record<string, any>;

export type Cadence = {
  id: string;
  brand: string;
  tenantId: string;
  name: string;
  steps: CadenceStep[];
  // Defaults false — a cadence must be explicitly activated before any lead
  // enrolled on it can ever trigger a real automated send. See issue #124's
  // own safety-rail rationale: this is the app's first cron with a real
  // external side effect.
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

// A lead's own position on a cadence — stored on the lead (app/types.ts's
// Lead.activeCadence), not here. Exported from this module so both
// app/types.ts and every consumer (enroll API, cadence-tick) reference the
// same shape rather than each declaring their own copy.
export type ActiveCadence = {
  cadenceId: string;
  currentStepIndex: number;
  stepDueAt: string;
  enrolledAt: string;
};

const STEP_CHANNELS: CadenceStepChannel[] = ['email', 'linkedin', 'call'];
const MAX_STEPS = 20;
const MAX_WAIT_DAYS = 365;
const MAX_NAME_LENGTH = 200;
const MAX_REMINDER_NOTE_LENGTH = 500;

function makeStepId(): string {
  // No Math.random()/Date.now() ban applies here — this runs in normal
  // request handlers, not a Workflow script.
  return `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Returns null for a step with no valid channel — never silently coerces an
// unrecognized channel to a default, matching lib/deals.ts's/lib/checklist.ts's
// own drop-invalid-entries convention.
export function sanitizeCadenceStep(input: any): CadenceStep | null {
  if (!input || typeof input !== 'object') return null;
  const channel = typeof input.channel === 'string' && (STEP_CHANNELS as string[]).includes(input.channel)
    ? (input.channel as CadenceStepChannel)
    : null;
  if (!channel) return null;

  const rawWait = Number(input.waitDaysAfterPrevious);
  const waitDaysAfterPrevious = Number.isFinite(rawWait) && rawWait >= 0
    ? Math.min(Math.round(rawWait), MAX_WAIT_DAYS)
    : 0;

  const templateId = typeof input.templateId === 'string' && input.templateId.trim()
    ? input.templateId.trim()
    : undefined;
  const reminderNote = typeof input.reminderNote === 'string'
    ? input.reminderNote.trim().slice(0, MAX_REMINDER_NOTE_LENGTH)
    : undefined;

  return {
    id: typeof input.id === 'string' && input.id ? input.id : makeStepId(),
    channel,
    waitDaysAfterPrevious,
    templateId,
    reminderNote: reminderNote || undefined,
  };
}

// Invalid entries are dropped, not rejected wholesale — one bad row
// shouldn't block saving the rest, matching lib/deals.ts's sanitizeDeals()
// convention. Capped at MAX_STEPS so a cadence can't grow unbounded.
export function sanitizeCadenceSteps(input: unknown): CadenceStep[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_STEPS)
    .map((raw) => sanitizeCadenceStep(raw))
    .filter((s): s is CadenceStep => s !== null);
}

export function sanitizeCadence(
  body: CadenceInput,
  brand: string,
  tenantId: string,
  existing?: { id: string; createdAt: string } | null,
  now?: Date
): Cadence {
  const nowIso = (now ?? new Date()).toISOString();
  return {
    id: existing?.id ?? '',
    brand,
    tenantId,
    name: typeof body.name === 'string' ? body.name.trim().slice(0, MAX_NAME_LENGTH) : '',
    steps: sanitizeCadenceSteps(body.steps),
    enabled: body.enabled === true,
    createdAt: existing?.createdAt ?? nowIso,
    updatedAt: nowIso,
  };
}

// A cadence with no name or no steps is never meaningfully usable — reject
// at save time rather than silently persisting a cadence that can never do
// anything once enrolled (issue #149's own edge case).
export function validateCadence(cadence: Pick<Cadence, 'name' | 'steps'>): string[] {
  const errors: string[] = [];
  if (!cadence.name) errors.push('name is required');
  if (cadence.steps.length === 0) errors.push('at least one step is required');
  return errors;
}

// Shared due-date math — the enroll API (issue #149) and the cadence-tick
// scheduler (issue #151) both call this rather than each computing it their
// own way, so they can never silently disagree about when a step is due.
export function computeStepDueAt(waitDaysAfterPrevious: number, from: Date): string {
  const dueMs = from.getTime() + waitDaysAfterPrevious * 24 * 60 * 60 * 1000;
  return new Date(dueMs).toISOString();
}

// Builds the ActiveCadence for a fresh enrollment — the first step's own
// waitDaysAfterPrevious is honored (see CadenceStep's own doc comment: no
// special forced-zero behavior), so a cadence deliberately delaying its
// first touch computes a real future stepDueAt, not "now" unconditionally.
export function buildInitialActiveCadence(cadence: Pick<Cadence, 'id' | 'steps'>, now?: Date): ActiveCadence | null {
  const nowDate = now ?? new Date();
  const firstStep = cadence.steps[0];
  if (!firstStep) return null;
  return {
    cadenceId: cadence.id,
    currentStepIndex: 0,
    stepDueAt: computeStepDueAt(firstStep.waitDaysAfterPrevious, nowDate),
    enrolledAt: nowDate.toISOString(),
  };
}

// Advances to the next step, or returns null when the cadence is complete
// (the current step was the last one) — the caller (cadence-tick) clears
// Lead.activeCadence entirely on a null result rather than storing a
// dangling reference to a step index past the end of the array.
export function advanceActiveCadence(
  cadence: Pick<Cadence, 'id' | 'steps'>,
  active: ActiveCadence,
  now?: Date
): ActiveCadence | null {
  const nowDate = now ?? new Date();
  const nextIndex = active.currentStepIndex + 1;
  const nextStep = cadence.steps[nextIndex];
  if (!nextStep) return null;
  return {
    cadenceId: active.cadenceId,
    currentStepIndex: nextIndex,
    stepDueAt: computeStepDueAt(nextStep.waitDaysAfterPrevious, nowDate),
    enrolledAt: active.enrolledAt,
  };
}
