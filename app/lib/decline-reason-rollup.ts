// Pure helpers for the decline-reason rollup (issue #63): building the
// shared Mongo $match stage and shaping raw aggregation output into the
// endpoint's response shape. No Mongo driver import — these take/return
// plain objects so the tricky decisions (missing-dimension handling, reason
// normalization) are unit-testable without a live database.

export type GroupedAggRow = {
  _id: { reason: string | null; dim: string | null | undefined };
  count: number;
};

export type TotalsAggRow = {
  _id: string | null;
  count: number;
};

export type DeclineReasonRow = {
  declineReason: string;
  dimensionValue: string;
  count: number;
};

export function buildDeclineMatchStage(
  tenantFilter: Record<string, any>,
  from?: Date,
  to?: Date
): Record<string, any> {
  const matchStage: Record<string, any> = {
    ...tenantFilter,
    declineReason: { $exists: true, $ne: '' },
  };

  if (from || to) {
    matchStage.declinedAt = {};
    if (from) matchStage.declinedAt.$gte = from;
    if (to) matchStage.declinedAt.$lte = to;
  }

  return matchStage;
}

// A dimension value that is null, missing, or an empty string is "unknown"
// — counted in missingDimensionCount rather than coerced into a misleading
// "UNKNOWN" bucket that would look like real, meaningful data.
export function shapeGroupedRows(rawRows: GroupedAggRow[]): { rows: DeclineReasonRow[]; missingDimensionCount: number } {
  const rows: DeclineReasonRow[] = [];
  let missingDimensionCount = 0;

  for (const item of rawRows) {
    const reason = item._id.reason || 'OTHER';
    const dim = item._id.dim;
    if (dim === null || dim === undefined || dim === '') {
      missingDimensionCount += item.count;
      continue;
    }
    rows.push({ declineReason: reason, dimensionValue: dim, count: item.count });
  }

  return { rows, missingDimensionCount };
}

export function shapeTotalsByReason(rawTotals: TotalsAggRow[]): [string, number][] {
  return rawTotals.map((item) => [item._id || 'OTHER', item.count] as [string, number]);
}
