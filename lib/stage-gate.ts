// Issue #72 — required-fields-per-stage gating. ENGAGED/PROPOSAL only
// (DISCOVERED/QUALIFIED stay auto-managed per lib/kanban-column.ts; WON/LOST
// are terminal and not gated). Hard block, no bypass, per owner-confirmed
// scope.

export type StageGateColumn = 'ENGAGED' | 'PROPOSAL';

export const GATED_COLUMNS: readonly StageGateColumn[] = ['ENGAGED', 'PROPOSAL'];

export function isGatedColumn(column: string): column is StageGateColumn {
  return (GATED_COLUMNS as readonly string[]).includes(column);
}

// Record<string, any> (not a narrow interface) so this composes with
// NormalizedLead (app/lib/normalize-lead.ts's `LeadRaw = Record<string, any>`
// based type) and any other loosely-typed lead shape already flowing through
// executeLeadAction, matching this codebase's established convention for
// lead-shaped data.
type GatedLead = Record<string, any>;

type RequiredFieldCheck = {
  label: string;
  isSatisfied: (lead: GatedLead) => boolean;
};

const REQUIRED_FIELDS: RequiredFieldCheck[] = [
  {
    label: 'a decision-maker contact',
    isSatisfied: (lead) => Array.isArray(lead.contacts) && lead.contacts.some((c: any) => c?.isDecisionMaker === true),
  },
  {
    label: 'a value proposition',
    isSatisfied: (lead) => typeof lead.value_proposition === 'string' && lead.value_proposition.trim().length > 0,
  },
];

export type StageGateResult = {
  allowed: boolean;
  missing: string[];
};

export function checkStageGate(destinationColumn: string, lead: GatedLead): StageGateResult {
  if (!isGatedColumn(destinationColumn)) {
    return { allowed: true, missing: [] };
  }

  const missing = REQUIRED_FIELDS.filter((field) => !field.isSatisfied(lead)).map((field) => field.label);
  return { allowed: missing.length === 0, missing };
}

export function formatStageGateError(destinationColumn: string, missing: string[]): string {
  return `Missing required fields for ${destinationColumn}: ${missing.join(', ')}`;
}
