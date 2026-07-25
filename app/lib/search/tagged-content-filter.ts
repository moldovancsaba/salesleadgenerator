// Reusable tag + free-text Mongo filter builder. Pure/synchronous, no Mongo
// import — generic enough for any collection with a `tags: string[]` field
// and a set of free-text fields, not hardcoded to outreach_templates. The
// "Battlecard/objection-handling library" roadmap issue (#65) is expected to
// point its own collection at this same builder rather than reimplementing
// it (issue #64).

export type TaggedContentFilterParams = {
  tenantId?: string;
  brand?: string;
  q?: string;
  tags?: string[];
  textFields: string[];
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Trim, drop empties, dedupe case-insensitively while preserving the
// first-seen casing (matches how `variables[]` is already normalized on
// outreach templates).
export function normalizeTags(input: string[] | undefined | null): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Map<string, string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) seen.set(key, trimmed);
  }
  return [...seen.values()];
}

export function buildTaggedContentFilter(params: TaggedContentFilterParams): Record<string, any> {
  const { tenantId, brand, q, tags, textFields } = params;
  const filter: Record<string, any> = {};
  if (tenantId !== undefined) filter.tenantId = tenantId;
  if (brand !== undefined) filter.brand = brand;

  const clauses: Record<string, any>[] = [];

  const trimmedQ = q?.trim();
  if (trimmedQ && textFields.length > 0) {
    clauses.push({
      $or: textFields.map((field) => ({ [field]: { $regex: trimmedQ, $options: 'i' } })),
    });
  }

  const normalizedTags = normalizeTags(tags);
  if (normalizedTags.length > 0) {
    clauses.push({
      // $in-match ANY of the requested tags, case-insensitive, exact value
      // (not substring) — a tag is a discrete label, not free text.
      tags: { $in: normalizedTags.map((t) => new RegExp(`^${escapeRegExp(t)}$`, 'i')) },
    });
  }

  if (clauses.length > 0) {
    filter.$and = clauses;
  }

  return filter;
}
