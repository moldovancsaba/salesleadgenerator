import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SPORT_CODES, ORG_TYPE_CODES, BUSINESS_UNIT_CODES, GENDER_CODES,
  DEMOGRAPHIC_CODES, COMPETITION_LEVEL_CODES, RELATIONSHIP_CODES,
} from '../../lib/lead-taxonomy';

// Guards the real, previously-disclosed tradeoff from 2.4.110: the
// enrichment prompt (docs/LEAD_ENRICHMENT_GUIDE.md §5 step 7) inlines a
// verbatim reference copy of every controlled vocabulary for an agent
// runtime with no repo access — GET /api/lead-taxonomy is now the
// authoritative live source the prompt tells the agent to prefer, but the
// inlined copy still exists as a fallback and human-readable reference, so
// it must never be allowed to silently drift from lib/lead-taxonomy.ts
// (the actual source of truth both this file and the API route read from).
// If someone extends a vocabulary in lib/lead-taxonomy.ts without updating
// the prompt's reference copy, this test fails the quality gate instead of
// the drift going unnoticed until an agent picks a code that's stale on one
// side or the other.
const GUIDE_PATH = join(__dirname, '../../docs/LEAD_ENRICHMENT_GUIDE.md');
const guideText = readFileSync(GUIDE_PATH, 'utf-8');

// Extracts the backtick-wrapped tokens between a unique label substring and
// the next ".\n" (end of that field's list) — matches this doc's own
// established "`field` — one of: `a`, `b`, ... `z`.\n" convention.
function extractInlinedList(label: string): string[] {
  const startIdx = guideText.indexOf(label);
  if (startIdx === -1) {
    throw new Error(`Label not found in docs/LEAD_ENRICHMENT_GUIDE.md: ${label}`);
  }
  const afterLabel = guideText.slice(startIdx + label.length);
  const endIdx = afterLabel.indexOf('.\n');
  if (endIdx === -1) {
    throw new Error(`No terminating ".\\n" found after label: ${label}`);
  }
  const listText = afterLabel.slice(0, endIdx);
  return [...listText.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);
}

describe('docs/LEAD_ENRICHMENT_GUIDE.md — inlined vocabulary lists stay in sync with lib/lead-taxonomy.ts', () => {
  it('sportCode reference list matches SPORT_CODES exactly, in order', () => {
    expect(extractInlinedList('`sportCode` — one of:')).toEqual([...SPORT_CODES]);
  });

  it('orgTypeCode reference list matches ORG_TYPE_CODES exactly, in order', () => {
    expect(extractInlinedList('`orgTypeCode` — one of:')).toEqual([...ORG_TYPE_CODES]);
  });

  it('businessUnitCode reference list matches BUSINESS_UNIT_CODES exactly, in order', () => {
    expect(extractInlinedList('`businessUnitCode` — one of:')).toEqual([...BUSINESS_UNIT_CODES]);
  });

  it('genderCode reference list matches GENDER_CODES exactly, in order', () => {
    expect(extractInlinedList('`genderCode` — one of:')).toEqual([...GENDER_CODES]);
  });

  it('demographicCodes reference list matches DEMOGRAPHIC_CODES exactly, in order', () => {
    expect(extractInlinedList('`demographicCodes` (array')).toEqual([...DEMOGRAPHIC_CODES]);
  });

  it('competitionLevelCode reference list matches COMPETITION_LEVEL_CODES exactly, in order', () => {
    expect(extractInlinedList('`competitionLevelCode` — one of:')).toEqual([...COMPETITION_LEVEL_CODES]);
  });

  it('relationshipToParent reference list matches RELATIONSHIP_CODES exactly, in order', () => {
    expect(extractInlinedList('`relationshipToParent` — one of:')).toEqual([...RELATIONSHIP_CODES]);
  });
});
