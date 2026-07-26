// Issue #74 — "what worked" outcome-learning report. Read-only correlation
// over data this app already writes (outcomelogs, searchlearnings) but never
// previously read back. Pure and unit-testable; the route layer supplies the
// real Mongo-backed inputs.

export type OutcomeLogForCorrelation = {
  leadId: string;
  afterState?: { kanbanColumn?: string };
  teachingWeight?: number;
};

export type SearchQueryRecord = {
  query: string;
  accepted?: number;
  declined?: number;
};

export type IndustryCorrelation = {
  industry: string;
  sampleSize: number;
  weightedWonRate: number | null;
};

export type SearchQueryCorrelation = {
  query: string;
  sampleSize: number;
  acceptRate: number | null;
};

export type OutcomeCorrelationResult = {
  byIndustry: IndustryCorrelation[];
  bySearchQuery: SearchQueryCorrelation[];
};

const UNKNOWN_INDUSTRY = 'Unknown';

export function correlateOutcomes(
  outcomeLogs: OutcomeLogForCorrelation[],
  leadIndustryById: Map<string, string | undefined>,
  searchQueries: SearchQueryRecord[] | null,
  minSampleSize = 10
): OutcomeCorrelationResult {
  const byIndustryTotals = new Map<string, { wonWeight: number; totalWeight: number; sampleSize: number }>();

  for (const log of outcomeLogs) {
    const column = log.afterState?.kanbanColumn;
    if (column !== 'WON' && column !== 'LOST') continue;

    const industry = leadIndustryById.get(log.leadId)?.trim() || UNKNOWN_INDUSTRY;
    const weight = typeof log.teachingWeight === 'number' && log.teachingWeight > 0 ? log.teachingWeight : 1;

    let entry = byIndustryTotals.get(industry);
    if (!entry) {
      entry = { wonWeight: 0, totalWeight: 0, sampleSize: 0 };
      byIndustryTotals.set(industry, entry);
    }
    entry.totalWeight += weight;
    entry.sampleSize += 1;
    if (column === 'WON') entry.wonWeight += weight;
  }

  const byIndustry: IndustryCorrelation[] = Array.from(byIndustryTotals.entries())
    .map(([industry, entry]) => ({
      industry,
      sampleSize: entry.sampleSize,
      weightedWonRate: entry.sampleSize >= minSampleSize ? entry.wonWeight / entry.totalWeight : null,
    }))
    .sort((a, b) => b.sampleSize - a.sampleSize);

  const bySearchQuery: SearchQueryCorrelation[] = (searchQueries || [])
    .map((q) => {
      const accepted = q.accepted || 0;
      const declined = q.declined || 0;
      const sampleSize = accepted + declined;
      return {
        query: q.query,
        sampleSize,
        acceptRate: sampleSize >= minSampleSize ? accepted / sampleSize : null,
      };
    })
    .sort((a, b) => b.sampleSize - a.sampleSize);

  return { byIndustry, bySearchQuery };
}
