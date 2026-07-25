import { describe, it, expect } from 'vitest';
import { buildDeclineMatchStage, shapeGroupedRows, shapeTotalsByReason } from '../../app/lib/decline-reason-rollup';

describe('buildDeclineMatchStage', () => {
  it('always requires a non-empty declineReason, merged with the tenant filter', () => {
    const stage = buildDeclineMatchStage({ tenantId: 'default' });
    expect(stage).toEqual({ tenantId: 'default', declineReason: { $exists: true, $ne: '' } });
  });

  it('adds an inclusive $gte/$lte declinedAt range when from/to are given', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const to = new Date('2026-01-31T23:59:59.999Z');
    const stage = buildDeclineMatchStage({}, from, to);
    expect(stage.declinedAt).toEqual({ $gte: from, $lte: to });
  });

  it('adds only $gte when only from is given', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    const stage = buildDeclineMatchStage({}, from);
    expect(stage.declinedAt).toEqual({ $gte: from });
  });

  it('omits declinedAt entirely when neither from nor to is given', () => {
    const stage = buildDeclineMatchStage({});
    expect(stage.declinedAt).toBeUndefined();
  });
});

describe('shapeGroupedRows', () => {
  it('sums correctly for the same reason+dimension pair (passthrough of pre-grouped Mongo output)', () => {
    const { rows } = shapeGroupedRows([
      { _id: { reason: 'WRONG_INDUSTRY', dim: 'Fintech' }, count: 7 },
    ]);
    expect(rows).toEqual([{ declineReason: 'WRONG_INDUSTRY', dimensionValue: 'Fintech', count: 7 }]);
  });

  it('excludes a null dimension from rows and counts it in missingDimensionCount', () => {
    const { rows, missingDimensionCount } = shapeGroupedRows([
      { _id: { reason: 'OTHER', dim: null }, count: 3 },
    ]);
    expect(rows).toEqual([]);
    expect(missingDimensionCount).toBe(3);
  });

  it('excludes an empty-string dimension the same as null', () => {
    const { rows, missingDimensionCount } = shapeGroupedRows([
      { _id: { reason: 'OTHER', dim: '' }, count: 2 },
    ]);
    expect(rows).toEqual([]);
    expect(missingDimensionCount).toBe(2);
  });

  it('never coerces a missing dimension into a fake "UNKNOWN" bucket', () => {
    const { rows } = shapeGroupedRows([{ _id: { reason: 'OTHER', dim: undefined }, count: 1 }]);
    expect(rows.some((r) => r.dimensionValue === 'UNKNOWN')).toBe(false);
  });

  it('returns empty rows and zero missingDimensionCount for zero input rows', () => {
    const result = shapeGroupedRows([]);
    expect(result).toEqual({ rows: [], missingDimensionCount: 0 });
  });

  it('normalizes a missing reason to OTHER', () => {
    const { rows } = shapeGroupedRows([{ _id: { reason: null, dim: 'US' }, count: 4 }]);
    expect(rows[0].declineReason).toBe('OTHER');
  });

  it('accumulates missingDimensionCount across multiple missing-dimension rows', () => {
    const { missingDimensionCount } = shapeGroupedRows([
      { _id: { reason: 'A', dim: null }, count: 2 },
      { _id: { reason: 'B', dim: '' }, count: 5 },
    ]);
    expect(missingDimensionCount).toBe(7);
  });
});

describe('shapeTotalsByReason', () => {
  it('matches the existing sortedDeclineReasons shape exactly (groupBy=none parity)', () => {
    const result = shapeTotalsByReason([
      { _id: 'NO_DECISION_MAKER', count: 10 },
      { _id: 'TOO_SMALL', count: 4 },
    ]);
    expect(result).toEqual([['NO_DECISION_MAKER', 10], ['TOO_SMALL', 4]]);
  });

  it('normalizes a missing reason to OTHER', () => {
    expect(shapeTotalsByReason([{ _id: null, count: 1 }])).toEqual([['OTHER', 1]]);
  });

  it('returns an empty array for zero declines', () => {
    expect(shapeTotalsByReason([])).toEqual([]);
  });
});
