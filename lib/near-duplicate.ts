// Issue #73 — near-duplicate review queue. Dedup today (lib/fingerprint.ts)
// is exact-hash-only; this adds fuzzy candidate-pair detection for a human
// to dismiss, flag, or merge (issues #128-130 built the merge engine and UI
// directly on top of the candidate pairs this file produces).

import { resolveSportAlias, SPORT_CODE_SET } from './lead-taxonomy';

// Issue #137, found while investigating why real production duplicates
// (case-only and diacritic-only name variants) weren't being caught: this
// codebase already has exactly this diacritic-folding technique in
// lib/lead-taxonomy.ts's slugifyForTag() (NFKD decompose, strip combining
// marks) — reused here rather than a second implementation.
const COMBINING_DIACRITICS = /[̀-ͯ]/g;
function foldDiacritics(value: string): string {
  return value.normalize('NFKD').replace(COMBINING_DIACRITICS, '');
}

export function normalizeForMatch(name: string, url: string): { name: string; domain: string } {
  const normalizedName = foldDiacritics((name || '').toLowerCase().trim().replace(/\s+/g, ' '));

  let domain = (url || '').toLowerCase().trim();
  domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

  return { name: normalizedName, domain };
}

// Issue #137's own root-cause finding: real duplicate pairs whose names
// differ only by spacing/punctuation ("La Liga" vs "LaLiga", "U.S. Soccer
// Federation" vs "US Soccer Federation") score below the bigram threshold
// even after diacritic folding, since the bigram sets themselves differ
// (a space or period shifts every neighboring bigram). Stripping to
// alphanumeric-only collapses these to an identical key — used as an
// additional exact-match fast path below, not a replacement for bigram
// similarity (which still handles genuinely different names, e.g. "Acme
// Corp" vs "Acme Corporation", where a tight key would legitimately differ).
function tightKey(normalizedName: string): string {
  return normalizedName.replace(/[^a-z0-9]+/g, '');
}

function bigrams(value: string): Set<string> {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length < 2) return new Set(clean ? [clean] : []);
  const result = new Set<string>();
  for (let i = 0; i < clean.length - 1; i++) {
    result.add(clean.slice(i, i + 2));
  }
  return result;
}

// Extracted so findCandidatePairs() can pass precomputed bigram sets (issue
// found 2026-07-28: a full-database scan at ~2189 leads timed out — this
// function was being recomputed on every single pairwise comparison inside
// findCandidatePairs()'s O(n^2) loop, i.e. O(n^2) bigram-set constructions
// instead of O(n), the actual bottleneck at that scale).
function diceCoefficient(bigramsA: Set<string>, bigramsB: Set<string>): number {
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;
  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

// Dice's coefficient over character bigrams — cheap, no new dependency,
// tolerant of word-order/suffix noise ("Acme Corp" vs "Corp Acme").
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  return diceCoefficient(bigrams(a), bigrams(b));
}

export type CandidateLead = {
  _id: string;
  entity_name: string;
  url?: string;
  // Owner requirement, 2026-07-28: a real duplicate is the same
  // organization doing the same activity, not just a similar name/domain —
  // a club's soccer section and its handball section are two genuinely
  // different leads even if they share a name, and must never be
  // considered duplicate candidates. Optional to match Lead.sport_or_sector
  // itself, but functionally required for a match: missing on either side
  // means "unknown activity," never treated as "same activity."
  sport_or_sector?: string;
  // Controlled taxonomy code (lib/lead-taxonomy.ts), preferred over
  // sport_or_sector when present — added 2026-07-28 alongside the rulebook
  // rollout. Also fixes a real gap the free-text-only gate above had: real
  // production data stores the same sport as "Soccer", "Football", and
  // "Football (Soccer)" interchangeably (verified via a live CogMap
  // sample), which an exact-string gate treats as three different sports,
  // wrongly splitting genuine duplicate candidates apart. Both this and
  // sport_or_sector are resolved through the same alias table below, so a
  // lead with only the free-text field still benefits from that
  // normalization even before it's been backfilled with sportCode.
  sportCode?: string;
};

export type CandidatePair = {
  leadIdA: string;
  leadIdB: string;
  score: number;
  matchedOn: 'name' | 'domain' | 'both';
};

const DEFAULT_THRESHOLD = 0.82;

export function findCandidatePairs(leads: CandidateLead[], threshold: number = DEFAULT_THRESHOLD): CandidatePair[] {
  // Each lead's bigram set is computed exactly once here (O(n)), not once
  // per pairwise comparison (O(n^2)) — see diceCoefficient()'s comment.
  // Mirrors similarity()'s own a===b/empty-set branches exactly below, so
  // scores are identical to calling similarity(a.name, b.name) per pair;
  // only the redundant repeat work is eliminated, not the matching logic.
  const normalized = leads.map((lead) => {
    const { name, domain } = normalizeForMatch(lead.entity_name, lead.url || '');
    // Prefer the controlled sportCode when it's a real, valid code; fall
    // back to resolving the free-text sport_or_sector through the same
    // alias table lib/lead-taxonomy.ts uses elsewhere — so "Soccer" and
    // "Football" resolve to the same canonical value instead of being
    // treated as different sports.
    const sportCandidate = lead.sportCode && SPORT_CODE_SET.has(lead.sportCode)
      ? lead.sportCode
      : resolveSportAlias(lead.sport_or_sector);
    const sport = sportCandidate || '';
    return { ...lead, name, domain, sport, nameBigrams: bigrams(name), tightKey: tightKey(name) };
  });

  const pairs: CandidatePair[] = [];

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];

      // Hard gate, checked first and cheaply: different (or unknown)
      // activity means never a duplicate candidate, regardless of how
      // similar the names or domains look. A blank sport_or_sector on
      // either side is "unknown," not "same" — never assumed to match.
      if (!a.sport || !b.sport || a.sport !== b.sport) continue;

      // Issue #137: a spacing/punctuation-only-different tight-key match
      // ("la liga" vs "laliga") is treated as certain (score 1) even when
      // the bigram sets themselves differ enough to fall under threshold —
      // checked before the bigram fallback, not instead of it, since two
      // genuinely different short names could coincidentally share bigrams
      // without sharing a tight key.
      const nameScore = a.name === b.name || (a.tightKey && a.tightKey === b.tightKey)
        ? 1
        : diceCoefficient(a.nameBigrams, b.nameBigrams);
      if (nameScore < threshold) continue;

      // Domain match is recorded as a corroborating signal only, never an
      // independent path to candidacy — a single real organization can
      // legitimately be recorded under more than one domain (owner
      // requirement, 2026-07-28: "One lead can have multiple domains"), so
      // domain equality alone doesn't establish sameness, and this app has
      // separately observed unrelated organizations sharing a domain (e.g.
      // a shared venue/booking page). Organization identity is judged by
      // name + activity; domain match is just extra context for whoever
      // reviews the pair.
      const domainMatch = Boolean(a.domain && b.domain && a.domain === b.domain);
      const matchedOn: CandidatePair['matchedOn'] = domainMatch ? 'both' : 'name';

      // Sorted lexicographically so a pair's identity is stable regardless
      // of the input array's iteration order — Mongo's find() gives no
      // ordering guarantee, and a re-scan producing (B, A) instead of
      // (A, B) must still be recognized as the same pair already reviewed.
      const [leadIdA, leadIdB] = [a._id, b._id].sort();

      pairs.push({ leadIdA, leadIdB, score: nameScore, matchedOn });
    }
  }

  return pairs;
}
