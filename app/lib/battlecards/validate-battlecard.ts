import { findForbiddenBrandTerms } from '../../../lib/validate-lead';
import type { BattlecardObjection } from './default-battlecards';

export type BattlecardInput = {
  competitorName?: unknown;
  positioningSummary?: unknown;
  proofPoints?: unknown;
  objections?: unknown;
  tags?: unknown;
};

export function normalizeProofPoints(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    .map((p) => p.trim());
}

export function normalizeObjections(input: unknown): BattlecardObjection[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((o) => o && typeof o === 'object')
    .map((o: any) => ({ objection: String(o.objection || '').trim(), response: String(o.response || '').trim() }))
    .filter((o) => o.objection || o.response);
}

// Extends the same CogMap/Seyu forbidden-terms precedent lib/validate-lead.ts
// already enforces on Lead.value_proposition (issue #65's own Dependencies
// section) — checks positioningSummary, every proofPoints[] entry, and every
// objections[].response (the response text is this brand's own words; the
// objection text itself is what a prospect said and may legitimately
// reference anything, so it's intentionally not checked).
export function validateBattlecardPayload(body: BattlecardInput, brand: string): string[] {
  const errors: string[] = [];

  const competitorName = typeof body.competitorName === 'string' ? body.competitorName.trim() : '';
  const positioningSummary = typeof body.positioningSummary === 'string' ? body.positioningSummary.trim() : '';

  if (!competitorName) errors.push('competitorName is required');
  if (!positioningSummary) errors.push('positioningSummary is required');

  for (const term of findForbiddenBrandTerms(positioningSummary, brand)) {
    errors.push(`positioningSummary contains forbidden ${brand} content: ${term}`);
  }

  normalizeProofPoints(body.proofPoints).forEach((point, i) => {
    for (const term of findForbiddenBrandTerms(point, brand)) {
      errors.push(`proofPoints[${i}] contains forbidden ${brand} content: ${term}`);
    }
  });

  normalizeObjections(body.objections).forEach((entry, i) => {
    for (const term of findForbiddenBrandTerms(entry.response, brand)) {
      errors.push(`objections[${i}].response contains forbidden ${brand} content: ${term}`);
    }
  });

  return errors;
}
