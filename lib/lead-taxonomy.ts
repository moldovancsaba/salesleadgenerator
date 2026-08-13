// Controlled vocabularies for the sports-industry lead taxonomy — owner
// spec, 2026-07-28 ("Sport Sales Lead Catalogue and Deduplication
// Rulebook v1.0"). Single source of truth for every enum this app's
// classification/matching/enrichment layers use, so a value validated here
// can never silently drift from a value another module assumes is valid.
//
// Deliberately additive to the existing Lead schema, not a replacement:
// `sport_or_sector`/`industry` (free text, pre-existing) are untouched —
// `sportCode`/`orgTypeCode`/etc. are new, optional fields a lead may not
// have yet. See docs/LEAD_TAXONOMY_MIGRATION_PLAN.md for the full rationale
// and the plan to backfill existing leads.

export const SPORT_CODES = [
  'football', 'basketball', 'cricket', 'rugby-union', 'rugby-league', 'tennis',
  'volleyball', 'handball', 'baseball', 'softball', 'ice-hockey', 'field-hockey',
  'american-football', 'futsal', 'beach-soccer', 'beach-volleyball', 'athletics',
  'swimming', 'cycling', 'triathlon', 'golf', 'padel', 'table-tennis', 'badminton',
  'gymnastics', 'boxing', 'martial-arts', 'rowing', 'sailing', 'esports',
  'multi-sport', 'unknown', 'not-applicable',
] as const;
export type SportCode = (typeof SPORT_CODES)[number];
export const SPORT_CODE_SET = new Set<string>(SPORT_CODES);

// Real free-text values found in this app's own production data (verified
// via a 2026-07-28 sample of ~1,968 CogMap leads) that mean the same sport
// as one of the canonical codes above — "football" meaning soccer in most
// of the world is the single largest source. Not exhaustive; extend as more
// aliases are found during migration rather than guessing the full set.
export const SPORT_ALIASES: Record<string, SportCode> = {
  soccer: 'football',
  'association football': 'football',
  football: 'football',
  'football (soccer)': 'football',
  'football(soccer)': 'football',
  gridiron: 'american-football',
  'icehockey': 'ice-hockey',
  'ice hockey': 'ice-hockey',
  'e-sports': 'esports',
  esport: 'esports',
  'track and field': 'athletics',
  'track & field': 'athletics',
  'ping pong': 'table-tennis',
  pingpong: 'table-tennis',
  basketball: 'basketball',
  cricket: 'cricket',
  tennis: 'tennis',
  volleyball: 'volleyball',
  handball: 'handball',
  baseball: 'baseball',
  softball: 'softball',
  rugby: 'rugby-union',
  'rugby union': 'rugby-union',
  'rugby league': 'rugby-league',
};

// Resolves a free-text sport string to a canonical code via the alias
// table, case/whitespace-insensitive. Returns null (never a guess) when no
// confident mapping exists — the caller must fall back to sportCode:
// 'unknown' rather than invent one, per the rulebook's "never guess" rule.
export function resolveSportAlias(freeText: string | undefined | null): SportCode | null {
  if (!freeText) return null;
  const key = freeText.trim().toLowerCase();
  if (!key) return null;
  if ((SPORT_CODE_SET as Set<string>).has(key)) return key as SportCode;
  return SPORT_ALIASES[key] ?? null;
}

// 'entertainment-event' added per issue #143 (2026-08-01): Seyu's own
// fan-engagement/sponsor-activation product genuinely targets non-sport
// recurring public events (music festivals, e.g. Tomorrowland, Glastonbury
// Festival) — an owner-confirmed scope extension, not a guess. Distinct
// from 'event-organiser' (a general org-type fit for any large recurring
// event, sport or not) so a lead can be tagged specifically as
// entertainment-industry rather than only generically "runs events."
export const ORG_TYPE_CODES = [
  'club', 'academy', 'federation', 'association', 'league', 'confederation',
  'tournament', 'event-organiser', 'entertainment-event', 'competition-organiser',
  'training-centre', 'performance-centre', 'sports-school', 'school', 'college',
  'university', 'municipality', 'sports-council', 'government-body',
  'facility-operator', 'stadium', 'arena', 'venue', 'sports-complex',
  'foundation', 'ngo', 'sponsor', 'brand', 'agency', 'broadcaster', 'media',
  'unknown',
] as const;
export type OrgTypeCode = (typeof ORG_TYPE_CODES)[number];
export const ORG_TYPE_CODE_SET = new Set<string>(ORG_TYPE_CODES);

export const BUSINESS_UNIT_CODES = [
  'first-team', 'women', 'men', 'youth', 'youth-academy', 'academy',
  'grassroots', 'community', 'foundation', 'commercial', 'partnerships',
  'sponsorship', 'marketing', 'digital', 'fan-engagement', 'ticketing',
  'merchandise', 'events', 'competition', 'operations', 'performance',
  'medical', 'coaching', 'education', 'development', 'communications',
  'media', 'esports', 'regional-office', 'general',
] as const;
export type BusinessUnitCode = (typeof BUSINESS_UNIT_CODES)[number];
export const BUSINESS_UNIT_CODE_SET = new Set<string>(BUSINESS_UNIT_CODES);

export const GENDER_CODES = ['men', 'women', 'mixed', 'unknown', 'not-applicable'] as const;
export type GenderCode = (typeof GENDER_CODES)[number];
export const GENDER_CODE_SET = new Set<string>(GENDER_CODES);

export const DEMOGRAPHIC_CODES = [
  'children', 'youth', 'adult', 'masters', 'senior', 'mixed-age', 'unknown', 'not-applicable',
] as const;
export type DemographicCode = (typeof DEMOGRAPHIC_CODES)[number];
export const DEMOGRAPHIC_CODE_SET = new Set<string>(DEMOGRAPHIC_CODES);

export const COMPETITION_LEVEL_CODES = [
  'recreational', 'grassroots', 'developmental', 'school', 'amateur',
  'semi-professional', 'professional', 'elite', 'national', 'international',
  'unknown', 'not-applicable',
] as const;
export type CompetitionLevelCode = (typeof COMPETITION_LEVEL_CODES)[number];
export const COMPETITION_LEVEL_CODE_SET = new Set<string>(COMPETITION_LEVEL_CODES);

// Relationship of a business-unit lead to its parent organisation — the
// rulebook's #relationship: namespace. Distinct from parentOrgId itself:
// this records *how* the two are connected, not just *that* they are.
export const RELATIONSHIP_CODES = [
  'owned', 'operated', 'licensed', 'franchise', 'affiliate', 'partner', 'unverified',
] as const;
export type RelationshipCode = (typeof RELATIONSHIP_CODES)[number];
export const RELATIONSHIP_CODE_SET = new Set<string>(RELATIONSHIP_CODES);

// How a single stored data point was established — issue #188. Deliberately
// closed and rejected at the write boundary like every other vocabulary here:
// the whole value of provenance is that "official" means the same thing on
// every record, which free text cannot promise. Extending it is a one-line
// change to this array, not a caller's decision.
//
// Value-for-value identical to the sibling application's own taxonomy, so a
// record moving between the two never has to re-interpret what a method means.
export const VERIFICATION_METHODS = [
  // Sourced from the organisation's own official web presence.
  'official',
  // A social account proved to belong to the organisation (FB, X, Instagram, LinkedIn).
  'official_social',
  // Any other public source; carries an evidence URL.
  'public',
  // An official registry/registration system (company register, league database).
  'registration_system',
  // Confirmed by a phone call.
  'phone',
  // Confirmed by email exchange.
  'email',
  // Set by hand by an application admin.
  'admin',
  // Set through the application by an end user — a sales rep updating contact
  // details, or an organisation claiming its own listing.
  'user',
  // Composed rather than sourced. The one value that says "no evidence exists
  // for this" — which is exactly why it must be recordable rather than omitted.
  'ai_generated',
] as const;
export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];
export const VERIFICATION_METHOD_SET = new Set<string>(VERIFICATION_METHODS);

function isValidCode(set: Set<string>, value: unknown): boolean {
  return typeof value === 'string' && set.has(value);
}

export function isValidSportCode(value: unknown): value is SportCode {
  return isValidCode(SPORT_CODE_SET, value);
}
export function isValidOrgTypeCode(value: unknown): value is OrgTypeCode {
  return isValidCode(ORG_TYPE_CODE_SET, value);
}
export function isValidBusinessUnitCode(value: unknown): value is BusinessUnitCode {
  return isValidCode(BUSINESS_UNIT_CODE_SET, value);
}
export function isValidGenderCode(value: unknown): value is GenderCode {
  return isValidCode(GENDER_CODE_SET, value);
}
export function isValidDemographicCode(value: unknown): value is DemographicCode {
  return isValidCode(DEMOGRAPHIC_CODE_SET, value);
}
export function isValidCompetitionLevelCode(value: unknown): value is CompetitionLevelCode {
  return isValidCode(COMPETITION_LEVEL_CODE_SET, value);
}
export function isValidRelationshipCode(value: unknown): value is RelationshipCode {
  return isValidCode(RELATIONSHIP_CODE_SET, value);
}
export function isValidVerificationMethod(value: unknown): value is VerificationMethod {
  return isValidCode(VERIFICATION_METHOD_SET, value);
}

// Slugifies a free-text city name to the rulebook's #city: tag convention
// (lowercase, ASCII, hyphenated, accents stripped) — e.g. "New York City"
// -> "new-york-city", "München" -> "munchen". The source spelling is never
// discarded: callers must keep the original in cityName and use this only
// for the generated tag/merge-key, matching the rulebook's explicit
// "source name must always be preserved" rule.
export function slugifyForTag(value: string | undefined | null): string {
  if (!value) return '';
  const COMBINING_DIACRITICS = /[̀-ͯ]/g;
  return value
    .normalize('NFKD')
    .replace(COMBINING_DIACRITICS, '') // strip accents after NFKD decomposition
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
