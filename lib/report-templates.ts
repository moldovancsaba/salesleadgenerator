// Report Templates Library (issue #253)
// Curated, industry-standard sales report templates for B2B sports tech / lead generation.
// Pure module without database dependencies (follows lib/report-definitions.ts convention).

import type { ReportDefinition, ReportChartType } from './report-definitions';
import type { ReportMetric, ReportGroupByField, ReportFilter, ReportDateRange } from './report-pipeline';

export type ReportTemplateCategory =
  | 'Pipeline & Funnel'
  | 'Conversion & Win Rate'
  | 'Prioritization & ICE'
  | 'Market & Loss Analysis';

export type ReportTemplate = {
  id: string;
  name: string;
  description: string;
  category: ReportTemplateCategory;
  metric: ReportMetric;
  groupBy: ReportGroupByField[];
  filters: ReportFilter[];
  dateRange: ReportDateRange;
  chartType: ReportChartType;
};

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: 'pipeline-by-stage',
    name: 'Pipeline Funnel by Stage',
    description: 'Visualizes the volume of deals across all pipeline stages (Discovered, Contacted, Meeting, Proposal, Won, Lost) to identify funnel conversion bottlenecks.',
    category: 'Pipeline & Funnel',
    metric: 'lead_count',
    groupBy: ['kanbanColumn'],
    filters: [],
    dateRange: { mode: 'all' },
    chartType: 'bar',
  },
  {
    id: 'leads-by-sport-sector',
    name: 'Leads by Sport & Sector',
    description: 'Breakdown of prospect organizations across target sports (Football, Basketball, Ice Hockey, Handball, etc.) to evaluate vertical market coverage.',
    category: 'Pipeline & Funnel',
    metric: 'lead_count',
    groupBy: ['sport_or_sector'],
    filters: [],
    dateRange: { mode: 'all' },
    chartType: 'bar',
  },
  {
    id: 'win-rate-by-sport-sector',
    name: 'Win Rate by Sport & Sector',
    description: 'Conversion percentage of closed deals across sports and industry sectors, showing where the sales team closes with the highest win percentage.',
    category: 'Conversion & Win Rate',
    metric: 'win_rate',
    groupBy: ['sport_or_sector'],
    filters: [],
    dateRange: { mode: 'all' },
    chartType: 'table',
  },
  {
    id: 'decline-reasons-breakdown',
    name: 'Lost & Decline Reasons Breakdown',
    description: 'Categorizes lost and declined deals by root cause (budget, timing, competitor, authority, lack of fit) to diagnose pipeline friction.',
    category: 'Market & Loss Analysis',
    metric: 'decline_count',
    groupBy: ['declineReason'],
    filters: [],
    dateRange: { mode: 'all' },
    chartType: 'bar',
  },
  {
    id: 'avg-ice-by-stage',
    name: 'Average ICE Score by Pipeline Stage',
    description: 'Measures the average Impact/Confidence/Ease score across pipeline stages to verify that high-conviction opportunities are progressing.',
    category: 'Prioritization & ICE',
    metric: 'avg_ice_score',
    groupBy: ['kanbanColumn'],
    filters: [],
    dateRange: { mode: 'all' },
    chartType: 'bar',
  },
  {
    id: 'leads-by-region',
    name: 'Lead Volume by Geographic Region',
    description: 'Regional spread of accounts across territories (EMEA, DACH, North America, UK & Ireland, domestic) to guide expansion and sales territory assignments.',
    category: 'Market & Loss Analysis',
    metric: 'lead_count',
    groupBy: ['region'],
    filters: [],
    dateRange: { mode: 'all' },
    chartType: 'bar',
  },
];

export function getReportTemplateById(templateId: string): ReportTemplate | null {
  return REPORT_TEMPLATES.find((t) => t.id === templateId) || null;
}

export function instantiateReportTemplate(
  template: ReportTemplate,
  brand: string,
  tenantId: string,
  createdBy = 'system'
): ReportDefinition {
  const now = new Date().toISOString();
  const id = `rep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  return {
    id,
    brand,
    tenantId,
    name: template.name,
    metric: template.metric,
    groupBy: [...template.groupBy],
    filters: template.filters.map((f) => ({ ...f, value: Array.isArray(f.value) ? [...f.value] : f.value })),
    dateRange: { ...template.dateRange },
    chartType: template.chartType,
    schedule: null,
    createdBy,
    createdAt: now,
    updatedAt: now,
  };
}

export function getStarterReportDefinitions(
  brand: string,
  tenantId: string,
  createdBy = 'system'
): ReportDefinition[] {
  return REPORT_TEMPLATES.map((tmpl) => instantiateReportTemplate(tmpl, brand, tenantId, createdBy));
}
