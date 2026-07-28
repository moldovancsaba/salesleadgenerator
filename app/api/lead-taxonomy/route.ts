import { NextResponse } from 'next/server';
import {
  SPORT_CODES, ORG_TYPE_CODES, BUSINESS_UNIT_CODES, GENDER_CODES,
  DEMOGRAPHIC_CODES, COMPETITION_LEVEL_CODES, RELATIONSHIP_CODES, SPORT_ALIASES,
} from '@/lib/lead-taxonomy';

// Rulebook v1.0 (2026-07-28) taxonomy, read-only, always-current source of
// truth for docs/LEAD_ENRICHMENT_GUIDE.md's prompt — the prompt inlines a
// copy of these lists for an agent runtime with no repo access, but a
// pasted-text copy can drift out of sync with lib/lead-taxonomy.ts whenever
// a vocabulary is extended. The enrichment prompt instructs the agent to
// fetch this endpoint at the start of a classification pass and prefer it
// over the inlined reference lists, so a real agent run is never stuck
// working from a stale copy.
//
// Unauthenticated by design, matching GET /api/health: this is static
// controlled-vocabulary metadata, not lead/business data — nothing here is
// sensitive, and requiring SLG_API_KEY for it would only complicate the one
// use case (an agent that already has web-fetch access) this exists for.
export async function GET() {
  return NextResponse.json({
    sportCodes: SPORT_CODES,
    orgTypeCodes: ORG_TYPE_CODES,
    businessUnitCodes: BUSINESS_UNIT_CODES,
    genderCodes: GENDER_CODES,
    demographicCodes: DEMOGRAPHIC_CODES,
    competitionLevelCodes: COMPETITION_LEVEL_CODES,
    relationshipCodes: RELATIONSHIP_CODES,
    sportAliases: SPORT_ALIASES,
  });
}
