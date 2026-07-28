import { describe, it, expect } from 'vitest';
import { GET } from '../../app/api/lead-taxonomy/route';
import {
  SPORT_CODES, ORG_TYPE_CODES, BUSINESS_UNIT_CODES, GENDER_CODES,
  DEMOGRAPHIC_CODES, COMPETITION_LEVEL_CODES, RELATIONSHIP_CODES, SPORT_ALIASES,
} from '../../lib/lead-taxonomy';

// This route has no DB/request dependency, unlike every other API route in
// this repo's integration suite — a plain unit test is enough and keeps the
// check in the fast, always-run `vitest run` gate rather than the slower
// mongodb-memory-server-backed integration suite.
describe('GET /api/lead-taxonomy', () => {
  it('serves the exact same arrays lib/lead-taxonomy.ts exports, unauthenticated', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sportCodes).toEqual(SPORT_CODES);
    expect(body.orgTypeCodes).toEqual(ORG_TYPE_CODES);
    expect(body.businessUnitCodes).toEqual(BUSINESS_UNIT_CODES);
    expect(body.genderCodes).toEqual(GENDER_CODES);
    expect(body.demographicCodes).toEqual(DEMOGRAPHIC_CODES);
    expect(body.competitionLevelCodes).toEqual(COMPETITION_LEVEL_CODES);
    expect(body.relationshipCodes).toEqual(RELATIONSHIP_CODES);
    expect(body.sportAliases).toEqual(SPORT_ALIASES);
  });
});
