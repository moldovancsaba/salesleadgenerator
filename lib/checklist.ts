// Per-lead action checklist (issue #117) — structured, completion-tracked
// items, distinct from the free-text `notes` field on Lead.

export type ChecklistItemInput = Record<string, any>;

export type ChecklistItem = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  completedAt?: string;
};

function makeId(): string {
  return `chk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Returns null for an entry with no usable text — never stores a blank
// checklist row.
export function sanitizeChecklistItem(
  input: ChecklistItemInput,
  existing?: ChecklistItem | null,
  now?: Date
): ChecklistItem | null {
  if (!input || typeof input !== 'object') return null;
  const text = typeof input.text === 'string' ? input.text.trim().slice(0, 500) : '';
  if (!text) return null;

  const nowDate = now ?? new Date();
  const done = input.done === true;
  const wasDone = existing?.done === true;

  return {
    id: typeof input.id === 'string' && input.id ? input.id : (existing?.id ?? makeId()),
    text,
    done,
    createdAt: existing?.createdAt ?? (typeof input.createdAt === 'string' ? input.createdAt : nowDate.toISOString()),
    // Stamped the moment done flips true->false is not possible (completedAt
    // is only ever set, matching declinedAt's "audit trail, not toggle
    // history" convention elsewhere in this codebase); re-checking an item
    // after un-checking it re-stamps completedAt to the new completion time.
    completedAt: done ? (wasDone && existing?.completedAt ? existing.completedAt : nowDate.toISOString()) : undefined,
  };
}

export function sanitizeChecklist(input: any, existingItems?: ChecklistItem[] | null, now?: Date): ChecklistItem[] {
  if (!Array.isArray(input)) return [];
  const existingById = new Map((existingItems ?? []).map((item) => [item.id, item]));
  return input
    .map((raw) => sanitizeChecklistItem(raw, typeof raw?.id === 'string' ? existingById.get(raw.id) ?? null : null, now))
    .filter((item): item is ChecklistItem => item !== null);
}

export function checklistProgress(items: ChecklistItem[] | undefined | null): { done: number; total: number } {
  if (!Array.isArray(items)) return { done: 0, total: 0 };
  return { done: items.filter((i) => i?.done === true).length, total: items.length };
}
