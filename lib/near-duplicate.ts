// Issue #73 — near-duplicate review queue. Dedup today (lib/fingerprint.ts)
// is exact-hash-only; this adds fuzzy candidate-pair detection for a human
// to dismiss or flag. Never merges — that's explicitly out of scope.

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

// Dice's coefficient over character bigrams — cheap, no new dependency,
// tolerant of word-order/suffix noise ("Acme Corp" vs "Corp Acme").
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const bigramsA = bigrams(a);
  const bigramsB = bigrams(b);
  if (bigramsA.size === 0 || bigramsB.size === 0) return 0;

  let intersection = 0;
  for (const bg of bigramsA) {
    if (bigramsB.has(bg)) intersection++;
  }
  return (2 * intersection) / (bigramsA.size + bigramsB.size);
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
  const normalized = leads.map((lead) => ({
    ...lead,
    ...normalizeForMatch(lead.entity_name, lead.url || ''),
  }));

  const pairs: CandidatePair[] = [];

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      const a = normalized[i];
      const b = normalized[j];

      const nameScore = similarity(a.name, b.name);
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
