// Issue #73 — near-duplicate review queue. Dedup today (lib/fingerprint.ts)
// is exact-hash-only; this adds fuzzy candidate-pair detection for a human
// to dismiss, flag, or merge (issues #128-130 built the merge engine and UI
// directly on top of the candidate pairs this file produces).

export function normalizeForMatch(name: string, url: string): { name: string; domain: string } {
  const normalizedName = (name || '').toLowerCase().trim().replace(/\s+/g, ' ');

  let domain = (url || '').toLowerCase().trim();
  domain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];

  return { name: normalizedName, domain };
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
    return { ...lead, name, domain, nameBigrams: bigrams(name) };
  });

  const pairs: CandidatePair[] = [];

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];

      const nameScore = a.name === b.name ? 1 : diceCoefficient(a.nameBigrams, b.nameBigrams);
      const domainMatch = Boolean(a.domain && b.domain && a.domain === b.domain);

      if (!domainMatch && nameScore < threshold) continue;

      const matchedOn: CandidatePair['matchedOn'] =
        domainMatch && nameScore >= threshold ? 'both' : domainMatch ? 'domain' : 'name';

      // Sorted lexicographically so a pair's identity is stable regardless
      // of the input array's iteration order — Mongo's find() gives no
      // ordering guarantee, and a re-scan producing (B, A) instead of
      // (A, B) must still be recognized as the same pair already reviewed.
      const [leadIdA, leadIdB] = [a._id, b._id].sort();

      pairs.push({
        leadIdA,
        leadIdB,
        score: domainMatch ? Math.max(nameScore, threshold) : nameScore,
        matchedOn,
      });
    }
  }

  return pairs;
}
