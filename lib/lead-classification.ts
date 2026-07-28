// Tag generation and merge-key construction from a lead's structured
// classification fields — owner spec, 2026-07-28 ("Sport Sales Lead
// Catalogue and Deduplication Rulebook v1.0"), §5 (tag syntax) and §15
// (merge key). Pure functions, no DB access — mirrors this repo's existing
// convention for logic modules (lib/near-duplicate.ts, lib/lead-merge.ts).
//
// Deliberate deviation from the rulebook, disclosed rather than silently
// applied: country stays ISO 3166-1 **alpha-2** here (`US`, not `USA`) —
// this app's entire existing country field, its validation
// (`lib/validate-lead.ts`'s `ISO_COUNTRY_RE`), and every consumer of it
// already use alpha-2 throughout. Converting to alpha-3 for rulebook
// literal compliance would be a large, cross-cutting, purely cosmetic
// change with no functional benefit — alpha-2 is an equally valid ISO
// 3166 standard. See docs/LEAD_TAXONOMY_MIGRATION_PLAN.md.

import { slugifyForTag } from './lead-taxonomy';

export type ClassificationFields = {
  parentOrgName?: string;
  sportCode?: string;
  orgTypeCode?: string;
  businessUnitCode?: string;
  genderCode?: string;
  demographicCodes?: string[];
  country?: string; // ISO 3166-1 alpha-2, matching this app's existing Lead.country
  cityName?: string;
  region?: string; // this app's existing sales-territory field (US/CEE/MENA) — see note below
};

// Generates the rulebook's `#namespace:value` classification tags from
// structured fields — never invented ad hoc, per the rulebook's "tags must
// be generated from controlled fields, not manually authored" rule (§5.3,
// §8 step 7). Only emits a tag for a field that's actually set; an absent
// field produces no tag rather than a placeholder one, so filtering by tag
// presence itself is meaningful.
//
// These are kept in a dedicated array (see Lead.classificationTags in
// app/types.ts), separate from the pre-existing free-text `tags[]` field —
// that field is operator-authored labels (issue #116, e.g. "priority:high"),
// a different concept with its own established UI/filter support. Mixing
// controlled and free-text tags in one array would break both.
export function generateClassificationTags(fields: ClassificationFields): string[] {
  const tags: string[] = [];
  if (fields.sportCode) tags.push(`#sport:${fields.sportCode}`);
  if (fields.orgTypeCode) tags.push(`#type:${fields.orgTypeCode}`);
  if (fields.businessUnitCode) tags.push(`#unit:${fields.businessUnitCode}`);
  if (fields.genderCode) tags.push(`#gender:${fields.genderCode}`);
  for (const demo of fields.demographicCodes || []) {
    if (demo) tags.push(`#demo:${demo}`);
  }
  if (fields.country) tags.push(`#country:${fields.country.toUpperCase()}`);
  if (fields.cityName) {
    const slug = slugifyForTag(fields.cityName);
    if (slug) tags.push(`#city:${slug}`);
  }
  return tags;
}

// Deterministic candidate-identity key, rulebook §15: a matching key makes
// two leads worth comparing for a possible duplicate — it never proves
// they're the same (§15.3), it's the input to the duplicate-detection
// pipeline (lib/near-duplicate.ts), not a merge decision on its own.
// Missing components use the literal string "unknown", never omitted —
// omitting a segment would make "sport known, city unknown" collide with
// "sport unknown, city known" under naive string concatenation.
export function buildMergeKey(fields: ClassificationFields): string {
  const parent = slugifyForTag(fields.parentOrgName) || 'unknown';
  const sport = fields.sportCode || 'unknown';
  const orgType = fields.orgTypeCode || 'unknown';
  const unit = fields.businessUnitCode || 'unknown';
  const gender = fields.genderCode || 'unknown';
  const country = fields.country ? fields.country.toUpperCase() : 'unknown';
  const city = slugifyForTag(fields.cityName) || 'unknown';
  return [parent, sport, orgType, unit, gender, country, city].join('|');
}
