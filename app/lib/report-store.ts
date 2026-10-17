// Ad-hoc report builder (issue #212) — Mongo-aware layer: index management
// and the shared run-a-definition execution path both POST /api/reports/
// [id]/run and the scheduled-delivery tick route call, so the two can
// never compute a different result for the same definition.

import type { Db } from 'mongodb';
import { tenantFilter } from '../../lib/tenant';
import { buildReportPipeline, shapeReportRows, type ReportResultRow } from '../../lib/report-pipeline';
import type { ReportDefinition } from '../../lib/report-definitions';
import { getStarterReportDefinitions, getReportTemplateById, instantiateReportTemplate } from '../../lib/report-templates';

export const REPORT_DEFINITIONS_COLLECTION = 'report_definitions';
// Issue #253: In user-facing ad-hoc reports, groups with at least 1 record compute
// their real average or win rate, rather than being silenced to null.
const MIN_SAMPLE_SIZE = 1;

const reportIndexesEnsured = new Set<string>();
export async function ensureReportIndexes(db: Db): Promise<void> {
  if (reportIndexesEnsured.has('report_definitions')) return;
  try {
    await db.collection(REPORT_DEFINITIONS_COLLECTION).createIndex({ brand: 1, tenantId: 1 });
    await db.collection(REPORT_DEFINITIONS_COLLECTION).createIndex({ 'schedule.enabled': 1, 'schedule.nextRunAt': 1 });
    reportIndexesEnsured.add('report_definitions');
  } catch (error) {
    console.error('[report-store] report_definitions index creation failed', error);
  }
}

export async function seedStarterReportsIfEmpty(
  db: Db, brand: string, tenantId: string, createdBy = 'system'
): Promise<ReportDefinition[]> {
  await ensureReportIndexes(db);
  const existing = await db.collection(REPORT_DEFINITIONS_COLLECTION).findOne({ brand, tenantId });
  if (existing) return [];
  const starters = getStarterReportDefinitions(brand, tenantId, createdBy);
  if (starters.length > 0) {
    await db.collection(REPORT_DEFINITIONS_COLLECTION).insertMany(starters);
  }
  return starters;
}

export async function seedStarterReports(
  db: Db, brand: string, tenantId: string, createdBy = 'system'
): Promise<ReportDefinition[]> {
  await ensureReportIndexes(db);
  const existingDocs = await db.collection(REPORT_DEFINITIONS_COLLECTION).find({ brand, tenantId }).toArray();
  const existingNames = new Set(existingDocs.map((d: any) => d.name.toLowerCase().trim()));
  const starters = getStarterReportDefinitions(brand, tenantId, createdBy).filter(
    (s) => !existingNames.has(s.name.toLowerCase().trim())
  );
  if (starters.length > 0) {
    await db.collection(REPORT_DEFINITIONS_COLLECTION).insertMany(starters);
  }
  return starters;
}

// Per-brand leads collection indexes (issue #212 §16) — this repo had no
// index on any leads collection for tenantId/createdAt/kanbanColumn before
// this issue; every existing /api/metrics/* route already ran as a full
// collection scan, so this is a real, disclosed pre-existing gap this
// issue closes rather than makes worse. Same lazy-ensure convention as
// lib/contacts.ts's ensureContactEmailsIndex() — each brand's leads live
// in its own collection, so each needs its own index call.
const leadReportIndexesEnsured = new Set<string>();
export async function ensureLeadReportIndexes(db: Db, collectionName: string): Promise<void> {
  if (leadReportIndexesEnsured.has(collectionName)) return;
  try {
    await db.collection(collectionName).createIndex({ tenantId: 1, createdAt: -1 });
    await db.collection(collectionName).createIndex({ tenantId: 1, kanbanColumn: 1 });
    leadReportIndexesEnsured.add(collectionName);
  } catch (error) {
    console.error('[report-store] lead report index creation failed', { collectionName, error });
  }
}

// Shared execution path (issue #212 §8's own architecture diagram — the
// run route and the tick route must never compute a different result for
// the same stored definition).
export async function runReportDefinition(db: Db, leadsCollectionName: string, definition: ReportDefinition): Promise<ReportResultRow[]> {
  await ensureLeadReportIndexes(db, leadsCollectionName);
  const pipeline = buildReportPipeline(
    { metric: definition.metric, groupBy: definition.groupBy, filters: definition.filters, dateRange: definition.dateRange },
    tenantFilter(definition.tenantId)
  );
  const rawRows = await db.collection(leadsCollectionName).aggregate(pipeline).toArray();
  return shapeReportRows(definition.metric, definition.groupBy, rawRows, MIN_SAMPLE_SIZE);
}

export function reportDocToDefinition(doc: any): ReportDefinition {
  return {
    id: doc.id,
    brand: doc.brand,
    tenantId: doc.tenantId,
    name: doc.name,
    metric: doc.metric,
    groupBy: doc.groupBy || [],
    filters: doc.filters || [],
    dateRange: doc.dateRange,
    chartType: doc.chartType,
    schedule: doc.schedule ?? null,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    lastRunAt: doc.lastRunAt,
    lastRunStatus: doc.lastRunStatus,
    lastRunError: doc.lastRunError,
  };
}
