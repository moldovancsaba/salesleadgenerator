// Ad-hoc report builder (issue #212) — pure pipeline-builder module, no
// Mongo driver import, mirroring lib/decline-reason-rollup.ts's/
// lib/outcome-correlation.ts's own pure-helper shape: the tricky decisions
// (allowlist validation, missing-dimension handling, minimum-sample-size
// gating) are unit-testable without a live database. The route layer
// supplies real Mongo results into shapeReportRows() below.
//
// No user-supplied string ever reaches a Mongo query unvalidated: metric,
// every groupBy entry, and every filter.field/op are checked against
// closed, hard-coded Sets before any pipeline object is built; filter
// values are always literal, type-checked string/string[] operands, never
// interpolated into a query shape or used as an object key.

export type ReportMetric = 'lead_count' | 'avg_ice_score' | 'win_rate' | 'decline_count';

export type ReportGroupByField =
  | 'none' | 'industry' | 'sport_or_sector' | 'region' | 'source'
  | 'kanbanColumn' | 'declineReason' | 'qualityStatus';

export type ReportFilterField = Exclude<ReportGroupByField, 'none'>;

export type ReportFilterOp = 'eq' | 'in';

export type ReportFilter = {
  field: ReportFilterField;
  op: ReportFilterOp;
  value: string | string[];
};

export type ReportDateRange =
  | { mode: 'all' }
  | { mode: 'relative'; days: number }
  | { mode: 'fixed'; from: string; to: string };

export type ReportInput = {
  metric: ReportMetric;
  groupBy: ReportGroupByField[];
  filters: ReportFilter[];
  dateRange: ReportDateRange;
};

export const METRIC_OPTIONS: { value: ReportMetric; label: string }[] = [
  { value: 'lead_count', label: 'Lead count' },
  { value: 'avg_ice_score', label: 'Average ICE score' },
  { value: 'win_rate', label: 'Win rate' },
  { value: 'decline_count', label: 'Decline count' },
];

export const GROUP_BY_OPTIONS: { value: ReportGroupByField; label: string }[] = [
  { value: 'none', label: 'No grouping' },
  { value: 'industry', label: 'Industry' },
  { value: 'sport_or_sector', label: 'Sport / sector' },
  { value: 'region', label: 'Region' },
  { value: 'source', label: 'Source' },
  { value: 'kanbanColumn', label: 'Pipeline stage' },
  { value: 'declineReason', label: 'Decline reason' },
  { value: 'qualityStatus', label: 'Quality status' },
];

const METRIC_ALLOWLIST = new Set<string>(METRIC_OPTIONS.map((o) => o.value));
const GROUP_BY_ALLOWLIST = new Set<string>(GROUP_BY_OPTIONS.map((o) => o.value));
export const FILTER_FIELD_OPTIONS = GROUP_BY_OPTIONS.filter((o) => o.value !== 'none') as { value: ReportFilterField; label: string }[];
const FILTER_FIELD_ALLOWLIST = new Set<string>(FILTER_FIELD_OPTIONS.map((o) => o.value));
const FILTER_OP_ALLOWLIST = new Set<string>(['eq', 'in']);

// Static, hand-maintained map — every real key is one of a fixed set of
// known Lead field names (never a computed/user-suppled property access).
const FIELD_TO_MONGO_PATH: Record<ReportFilterField, string> = {
  industry: 'industry',
  sport_or_sector: 'sport_or_sector',
  region: 'region',
  source: 'source',
  kanbanColumn: 'kanbanColumn',
  declineReason: 'declineReason',
  qualityStatus: 'qualityStatus',
};

const MAX_GROUP_BY = 2;
const MAX_FILTERS = 5;
const MAX_FILTER_VALUE_LENGTH = 200;
const MAX_IN_VALUES = 20;

export type ReportValidationResult = { valid: true; value: ReportInput } | { valid: false; errors: string[] };

function isValidFilterValue(op: ReportFilterOp, value: unknown): value is string | string[] {
  const isCleanString = (v: unknown): v is string =>
    typeof v === 'string' && v.trim().length > 0 && v.trim().length <= MAX_FILTER_VALUE_LENGTH;

  if (op === 'eq') return isCleanString(value);
  if (op === 'in') return Array.isArray(value) && value.length > 0 && value.length <= MAX_IN_VALUES && value.every(isCleanString);
  return false;
}

function isValidDateRange(range: unknown): range is ReportDateRange {
  if (!range || typeof range !== 'object') return false;
  const r = range as any;
  if (r.mode === 'all') return true;
  if (r.mode === 'relative') return Number.isInteger(r.days) && r.days >= 1 && r.days <= 365;
  if (r.mode === 'fixed') {
    if (typeof r.from !== 'string' || typeof r.to !== 'string') return false;
    const from = new Date(r.from);
    const to = new Date(r.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return false;
    return from.getTime() <= to.getTime();
  }
  return false;
}

export function validateReportInput(input: any): ReportValidationResult {
  const errors: string[] = [];

  if (!input || typeof input !== 'object') return { valid: false, errors: ['input must be an object'] };

  if (!METRIC_ALLOWLIST.has(input.metric)) errors.push(`unknown metric: ${input.metric}`);

  const groupBy: ReportGroupByField[] = Array.isArray(input.groupBy) ? input.groupBy : [];
  if (groupBy.length > MAX_GROUP_BY) errors.push(`too many groupBy dimensions (max ${MAX_GROUP_BY})`);
  for (const g of groupBy) {
    if (!GROUP_BY_ALLOWLIST.has(g)) errors.push(`unknown groupBy field: ${g}`);
  }
  if (new Set(groupBy).size !== groupBy.length) errors.push('duplicate groupBy field');

  const filters: ReportFilter[] = Array.isArray(input.filters) ? input.filters : [];
  if (filters.length > MAX_FILTERS) errors.push(`too many filters (max ${MAX_FILTERS})`);
  for (const f of filters) {
    if (!f || typeof f !== 'object') { errors.push('invalid filter'); continue; }
    if (!FILTER_FIELD_ALLOWLIST.has(f.field)) errors.push(`unknown filter field: ${f.field}`);
    if (!FILTER_OP_ALLOWLIST.has(f.op)) errors.push(`unknown filter op: ${f.op}`);
    if (!isValidFilterValue(f.op, f.value)) errors.push(`invalid filter value for field ${f.field}`);
  }

  if (!isValidDateRange(input.dateRange)) errors.push('invalid dateRange');

  if (errors.length > 0) return { valid: false, errors };

  const cleanGroupBy = groupBy.filter((g) => g !== 'none');
  return {
    valid: true,
    value: {
      metric: input.metric,
      groupBy: cleanGroupBy,
      filters: filters.map((f) => ({ field: f.field, op: f.op, value: f.value })),
      dateRange: input.dateRange,
    },
  };
}

export function resolveDateRange(range: ReportDateRange, now: Date = new Date()): { from?: Date; to?: Date } {
  if (range.mode === 'all') return {};
  if (range.mode === 'relative') {
    return { from: new Date(now.getTime() - range.days * 86_400_000) };
  }
  return { from: new Date(range.from), to: new Date(range.to) };
}

// Builds a real, storable Mongo aggregation pipeline. `tenantFilterStage`
// is whatever lib/tenant.ts's tenantFilter(tenantId) returned — merged in
// directly, never spread alongside another $or (issue #212 §7/§16 — same
// bug class CLAUDE.md's own LESSONS_LEARNED §1 documents).
export function buildReportPipeline(input: ReportInput, tenantFilterStage: Record<string, any>, now: Date = new Date()): Record<string, any>[] {
  const match: Record<string, any> = { $and: [tenantFilterStage] };
  const extraMatch: Record<string, any> = {};

  for (const f of input.filters) {
    const mongoField = FIELD_TO_MONGO_PATH[f.field];
    extraMatch[mongoField] = f.op === 'eq' ? f.value : { $in: f.value };
  }

  const { from, to } = resolveDateRange(input.dateRange, now);
  if (from || to) {
    extraMatch.createdAt = { ...(from ? { $gte: from.toISOString() } : {}), ...(to ? { $lte: to.toISOString() } : {}) };
  }

  // decline_count implicitly requires declineReason to exist — same
  // convention as app/lib/decline-reason-rollup.ts's buildDeclineMatchStage().
  if (input.metric === 'decline_count') {
    extraMatch.declineReason = { ...(extraMatch.declineReason || {}), $exists: true, $ne: '' };
  }

  if (Object.keys(extraMatch).length > 0) match.$and.push(extraMatch);

  const groupId = input.groupBy.length === 0
    ? null
    : Object.fromEntries(input.groupBy.map((g) => [g, `$${FIELD_TO_MONGO_PATH[g as ReportFilterField]}`]));

  const pipeline: Record<string, any>[] = [{ $match: match }];

  if (input.metric === 'avg_ice_score') {
    pipeline.push({ $addFields: { _iceScore: { $multiply: ['$ice.impact', '$ice.confidence', '$ice.ease'] } } });
    pipeline.push({ $match: { _iceScore: { $gt: 0 } } });
    pipeline.push({ $group: { _id: groupId, avg: { $avg: '$_iceScore' }, sampleSize: { $sum: 1 } } });
  } else if (input.metric === 'win_rate') {
    pipeline.push({
      $group: {
        _id: groupId,
        won: { $sum: { $cond: [{ $eq: ['$kanbanColumn', 'WON'] }, 1, 0] } },
        lost: { $sum: { $cond: [{ $eq: ['$kanbanColumn', 'LOST'] }, 1, 0] } },
      },
    });
  } else {
    // lead_count / decline_count — a plain document count per group.
    pipeline.push({ $group: { _id: groupId, count: { $sum: 1 } } });
  }

  pipeline.push({ $sort: { _id: 1 } });
  return pipeline;
}

export type ReportResultRow = {
  groupKey: Record<string, string | null>;
  value: number | null; // null = insufficient sample size, never a fabricated rate
  sampleSize?: number;
};

// Shapes raw aggregate() output into a display-ready row list. minSampleSize
// gating (win_rate/avg_ice_score) mirrors lib/outcome-correlation.ts's own
// correlateOutcomes() convention exactly — never a rate/average computed
// from fewer than minSampleSize documents.
export function shapeReportRows(metric: ReportMetric, groupBy: ReportGroupByField[], rawRows: any[], minSampleSize = 10): ReportResultRow[] {
  return rawRows.map((row) => {
    const groupKey: Record<string, string | null> = {};
    for (const g of groupBy) {
      const raw = row._id?.[g];
      groupKey[g] = typeof raw === 'string' && raw !== '' ? raw : null;
    }

    if (metric === 'win_rate') {
      const sampleSize = (row.won || 0) + (row.lost || 0);
      return { groupKey, sampleSize, value: sampleSize >= minSampleSize ? row.won / sampleSize : null };
    }
    if (metric === 'avg_ice_score') {
      const sampleSize = row.sampleSize || 0;
      return { groupKey, sampleSize, value: sampleSize >= minSampleSize ? row.avg : null };
    }
    return { groupKey, value: typeof row.count === 'number' ? row.count : 0 };
  });
}
