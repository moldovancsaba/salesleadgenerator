import { describe, it, expect } from 'vitest';
import { validateReportInput, buildReportPipeline, shapeReportRows } from '../../lib/report-pipeline';

const TENANT_FILTER = { tenantId: 'default' };

describe('validateReportInput (issue 212)', () => {
  it('accepts a minimal valid input (no groupBy, no filters, all-time)', () => {
    const result = validateReportInput({ metric: 'lead_count', groupBy: [], filters: [], dateRange: { mode: 'all' } });
    expect(result.valid).toBe(true);
  });

  it('rejects an unknown metric', () => {
    const result = validateReportInput({ metric: 'made_up_metric', groupBy: [], filters: [], dateRange: { mode: 'all' } });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.some((e) => e.includes('unknown metric'))).toBe(true);
  });

  it('accepts exactly 2 groupBy dimensions, rejects 3', () => {
    const twoOk = validateReportInput({ metric: 'lead_count', groupBy: ['industry', 'region'], filters: [], dateRange: { mode: 'all' } });
    expect(twoOk.valid).toBe(true);
    const threeRejected = validateReportInput({ metric: 'lead_count', groupBy: ['industry', 'region', 'source'], filters: [], dateRange: { mode: 'all' } });
    expect(threeRejected.valid).toBe(false);
  });

  it('rejects an unknown groupBy field', () => {
    const result = validateReportInput({ metric: 'lead_count', groupBy: ['not_a_real_field'], filters: [], dateRange: { mode: 'all' } });
    expect(result.valid).toBe(false);
  });

  it('rejects a duplicate groupBy field', () => {
    const result = validateReportInput({ metric: 'lead_count', groupBy: ['industry', 'industry'], filters: [], dateRange: { mode: 'all' } });
    expect(result.valid).toBe(false);
  });

  it('accepts exactly 5 filters, rejects 6', () => {
    const filter = { field: 'industry', op: 'eq', value: 'Sports' };
    const fiveOk = validateReportInput({ metric: 'lead_count', groupBy: [], filters: Array(5).fill(filter), dateRange: { mode: 'all' } });
    expect(fiveOk.valid).toBe(true);
    const sixRejected = validateReportInput({ metric: 'lead_count', groupBy: [], filters: Array(6).fill(filter), dateRange: { mode: 'all' } });
    expect(sixRejected.valid).toBe(false);
  });

  it('rejects an unknown filter field or op', () => {
    const badField = validateReportInput({ metric: 'lead_count', groupBy: [], filters: [{ field: 'not_real', op: 'eq', value: 'x' }], dateRange: { mode: 'all' } });
    expect(badField.valid).toBe(false);
    const badOp = validateReportInput({ metric: 'lead_count', groupBy: [], filters: [{ field: 'industry', op: 'regex', value: 'x' }], dateRange: { mode: 'all' } });
    expect(badOp.valid).toBe(false);
  });

  it('rejects an invalid filter value (empty string, non-array for "in")', () => {
    const emptyEq = validateReportInput({ metric: 'lead_count', groupBy: [], filters: [{ field: 'industry', op: 'eq', value: '   ' }], dateRange: { mode: 'all' } });
    expect(emptyEq.valid).toBe(false);
    const nonArrayIn = validateReportInput({ metric: 'lead_count', groupBy: [], filters: [{ field: 'industry', op: 'in', value: 'Sports' }], dateRange: { mode: 'all' } });
    expect(nonArrayIn.valid).toBe(false);
  });

  it('accepts a valid relative dateRange, rejects an out-of-bounds one', () => {
    expect(validateReportInput({ metric: 'lead_count', groupBy: [], filters: [], dateRange: { mode: 'relative', days: 30 } }).valid).toBe(true);
    expect(validateReportInput({ metric: 'lead_count', groupBy: [], filters: [], dateRange: { mode: 'relative', days: 0 } }).valid).toBe(false);
    expect(validateReportInput({ metric: 'lead_count', groupBy: [], filters: [], dateRange: { mode: 'relative', days: 400 } }).valid).toBe(false);
  });

  it('accepts a valid fixed dateRange, rejects from > to', () => {
    expect(validateReportInput({ metric: 'lead_count', groupBy: [], filters: [], dateRange: { mode: 'fixed', from: '2026-01-01', to: '2026-02-01' } }).valid).toBe(true);
    expect(validateReportInput({ metric: 'lead_count', groupBy: [], filters: [], dateRange: { mode: 'fixed', from: '2026-02-01', to: '2026-01-01' } }).valid).toBe(false);
  });

  it('strips "none" out of a returned groupBy', () => {
    const result = validateReportInput({ metric: 'lead_count', groupBy: ['none'], filters: [], dateRange: { mode: 'all' } });
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.groupBy).toEqual([]);
  });
});

describe('buildReportPipeline (issue 212)', () => {
  it('never spreads tenantFilter alongside another $or — always combines via $and', () => {
    const pipeline = buildReportPipeline({ metric: 'lead_count', groupBy: [], filters: [], dateRange: { mode: 'all' } }, TENANT_FILTER);
    expect(pipeline[0].$match.$and).toContainEqual(TENANT_FILTER);
  });

  it('builds a plain count $group for lead_count with no groupBy', () => {
    const pipeline = buildReportPipeline({ metric: 'lead_count', groupBy: [], filters: [], dateRange: { mode: 'all' } }, TENANT_FILTER);
    const groupStage = pipeline.find((s) => '$group' in s);
    expect(groupStage!.$group).toEqual({ _id: null, count: { $sum: 1 } });
  });

  it('builds a compound _id for a 2-dimension groupBy', () => {
    const pipeline = buildReportPipeline({ metric: 'lead_count', groupBy: ['industry', 'region'], filters: [], dateRange: { mode: 'all' } }, TENANT_FILTER);
    const groupStage = pipeline.find((s) => '$group' in s);
    expect(groupStage!.$group._id).toEqual({ industry: '$industry', region: '$region' });
  });

  it('decline_count implicitly requires declineReason to exist', () => {
    const pipeline = buildReportPipeline({ metric: 'decline_count', groupBy: [], filters: [], dateRange: { mode: 'all' } }, TENANT_FILTER);
    const extraMatch = pipeline[0].$match.$and[1];
    expect(extraMatch.declineReason).toEqual({ $exists: true, $ne: '' });
  });

  it('avg_ice_score adds an $addFields + $match(_iceScore > 0) before grouping', () => {
    const pipeline = buildReportPipeline({ metric: 'avg_ice_score', groupBy: [], filters: [], dateRange: { mode: 'all' } }, TENANT_FILTER);
    expect(pipeline[1].$addFields._iceScore).toEqual({ $multiply: ['$ice.impact', '$ice.confidence', '$ice.ease'] });
    expect(pipeline[2].$match._iceScore).toEqual({ $gt: 0 });
    const groupStage = pipeline.find((s) => '$group' in s);
    expect(groupStage!.$group.avg).toEqual({ $avg: '$_iceScore' });
  });

  it('win_rate groups won/lost counts via $cond', () => {
    const pipeline = buildReportPipeline({ metric: 'win_rate', groupBy: [], filters: [], dateRange: { mode: 'all' } }, TENANT_FILTER);
    const groupStage = pipeline.find((s) => '$group' in s);
    expect(groupStage!.$group.won).toEqual({ $sum: { $cond: [{ $eq: ['$kanbanColumn', 'WON'] }, 1, 0] } });
    expect(groupStage!.$group.lost).toEqual({ $sum: { $cond: [{ $eq: ['$kanbanColumn', 'LOST'] }, 1, 0] } });
  });

  it('an "eq" filter becomes a literal field match, an "in" filter becomes $in', () => {
    const pipeline = buildReportPipeline({ metric: 'lead_count', groupBy: [], filters: [{ field: 'region', op: 'eq', value: 'US' }], dateRange: { mode: 'all' } }, TENANT_FILTER);
    expect(pipeline[0].$match.$and[1].region).toBe('US');

    const pipelineIn = buildReportPipeline({ metric: 'lead_count', groupBy: [], filters: [{ field: 'region', op: 'in', value: ['US', 'CA'] }], dateRange: { mode: 'all' } }, TENANT_FILTER);
    expect(pipelineIn[0].$match.$and[1].region).toEqual({ $in: ['US', 'CA'] });
  });

  it('a relative dateRange adds a createdAt $gte constraint', () => {
    const now = new Date('2026-06-15T00:00:00.000Z');
    const pipeline = buildReportPipeline({ metric: 'lead_count', groupBy: [], filters: [], dateRange: { mode: 'relative', days: 30 } }, TENANT_FILTER, now);
    const extraMatch = pipeline[0].$match.$and[1];
    expect(extraMatch.createdAt.$gte).toBe(new Date('2026-05-16T00:00:00.000Z').toISOString());
  });
});

describe('shapeReportRows (issue 212)', () => {
  it('shapes a lead_count group correctly, with a null groupKey for a missing dimension', () => {
    const rows = shapeReportRows('lead_count', ['industry'], [{ _id: { industry: 'Sports' }, count: 5 }, { _id: { industry: null }, count: 2 }]);
    expect(rows).toEqual([
      { groupKey: { industry: 'Sports' }, value: 5 },
      { groupKey: { industry: null }, value: 2 },
    ]);
  });

  it('win_rate below minSampleSize renders null, never a fabricated rate', () => {
    const rows = shapeReportRows('win_rate', [], [{ _id: null, won: 3, lost: 2 }], 10);
    expect(rows[0].value).toBeNull();
    expect(rows[0].sampleSize).toBe(5);
  });

  it('win_rate at/above minSampleSize computes a real ratio', () => {
    const rows = shapeReportRows('win_rate', [], [{ _id: null, won: 7, lost: 3 }], 10);
    expect(rows[0].value).toBe(0.7);
  });

  it('avg_ice_score below minSampleSize renders null', () => {
    const rows = shapeReportRows('avg_ice_score', [], [{ _id: null, avg: 42, sampleSize: 3 }], 10);
    expect(rows[0].value).toBeNull();
  });
});
