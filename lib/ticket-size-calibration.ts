// Closed-won calibration for the ticket-size estimation engine (issue #83)
// — the same closed-loop pattern lib/win-rate-calibration.ts already
// implements for win-rate-by-stage forecasting (issue #56), applied here to
// deal-size accuracy: compare what estimateTicketSize() predicted against
// the real, human-entered contract value once a lead actually closes WON.
// Pure math — no React/Mongo/internal Date.now() — mirroring
// lib/win-rate-calibration.ts's shape exactly.

export type WonLeadForCalibration = {
  size?: string;
  ticketSizeEstimate?: { method?: string; expected?: number } | null;
  actualDealValueUsd?: number;
};

export type CalibrationGroupStat = {
  // The lead's CURRENT size tier at calibration time, not necessarily the
  // tier the original estimate was computed against if `size` changed
  // between estimation and win — a known, accepted v1 imprecision (a lead
  // whose size changes goes through issue #82's change-triggered recompute,
  // which keeps the *estimate* current, but this module has no historical
  // record of what tier a since-superseded estimate used).
  tier: string;
  method: 'tier_band' | 'per_unit';
  sampleSize: number;
  meanAbsoluteError: number;
  medianAbsoluteError: number;
  // Signed: positive = the model underestimated (actual > expected),
  // negative = the model overestimated. Never absolute — the sign is the
  // actionable part (which direction to correct dealSize/pricing in).
  meanPercentError: number;
  medianPercentError: number;
  confidence: 'ok' | 'insufficient';
};

export type TicketSizeCalibrationResult = {
  groups: CalibrationGroupStat[];
  // WON leads whose estimate was 'unconfigured' (or otherwise unusable) at
  // win time — nothing to compare against, but still worth surfacing so an
  // operator can see how much of the closed pipeline this affects.
  wonWithoutEstimate: number;
  // WON leads with a real estimate but no actualDealValueUsd ever captured.
  wonWithoutActual: number;
};

export const DEFAULT_MIN_SAMPLE_SIZE = 5;

const VALID_TIERS = new Set(['Small', 'Medium', 'Large', 'Enterprise']);
// Deliberately excludes 'manual_override' (issue #86) — a human's own
// judgment call is not a "the model was right/wrong" data point, and would
// pollute this calibration if graded. Falls into wonWithoutEstimate below,
// same as 'unconfigured' — grouped there by construction (this is an
// allow-list, not a special case), not because it's literally estimate-less.
const VALID_METHODS = new Set(['tier_band', 'per_unit']);

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeTicketSizeCalibration(
  wonLeads: WonLeadForCalibration[],
  minSampleSize: number = DEFAULT_MIN_SAMPLE_SIZE
): TicketSizeCalibrationResult {
  type Bucket = { tier: string; method: 'tier_band' | 'per_unit'; errors: number[]; pctErrors: number[] };
  const buckets = new Map<string, Bucket>();

  let wonWithoutEstimate = 0;
  let wonWithoutActual = 0;

  for (const lead of wonLeads) {
    if (!lead) continue;
    const method = lead.ticketSizeEstimate?.method;
    const expected = lead.ticketSizeEstimate?.expected;
    const hasUsableEstimate = !!method && VALID_METHODS.has(method) && typeof expected === 'number' && expected > 0;

    if (!hasUsableEstimate) {
      wonWithoutEstimate++;
      continue;
    }
    if (typeof lead.actualDealValueUsd !== 'number') {
      wonWithoutActual++;
      continue;
    }

    const tier = VALID_TIERS.has(lead.size || '') ? (lead.size as string) : 'Unknown';
    const key = `${tier}:${method}`;
    if (!buckets.has(key)) buckets.set(key, { tier, method: method as 'tier_band' | 'per_unit', errors: [], pctErrors: [] });
    const bucket = buckets.get(key)!;

    const error = lead.actualDealValueUsd - (expected as number);
    bucket.errors.push(error);
    bucket.pctErrors.push((error / (expected as number)) * 100);
  }

  const groups: CalibrationGroupStat[] = Array.from(buckets.values()).map((bucket) => {
    const n = bucket.errors.length;
    const absErrors = bucket.errors.map(Math.abs);
    return {
      tier: bucket.tier,
      method: bucket.method,
      sampleSize: n,
      meanAbsoluteError: Math.round(absErrors.reduce((a, b) => a + b, 0) / n),
      medianAbsoluteError: Math.round(median(absErrors)),
      meanPercentError: Math.round((bucket.pctErrors.reduce((a, b) => a + b, 0) / n) * 10) / 10,
      medianPercentError: Math.round(median(bucket.pctErrors) * 10) / 10,
      confidence: n >= minSampleSize ? 'ok' : 'insufficient',
    };
  });

  groups.sort((a, b) => a.tier.localeCompare(b.tier) || a.method.localeCompare(b.method));

  return { groups, wonWithoutEstimate, wonWithoutActual };
}
