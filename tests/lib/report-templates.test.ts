import { describe, it, expect } from 'vitest';
import {
  REPORT_TEMPLATES,
  getReportTemplateById,
  instantiateReportTemplate,
  getStarterReportDefinitions,
} from '../../lib/report-templates';
import { validateReportDefinitionInput } from '../../lib/report-definitions';

describe('Report Templates Catalog (issue 253)', () => {
  it('contains the curated 6 starter report templates', () => {
    expect(REPORT_TEMPLATES).toHaveLength(6);

    const ids = REPORT_TEMPLATES.map((t) => t.id);
    expect(ids).toContain('pipeline-by-stage');
    expect(ids).toContain('leads-by-sport-sector');
    expect(ids).toContain('win-rate-by-sport-sector');
    expect(ids).toContain('decline-reasons-breakdown');
    expect(ids).toContain('avg-ice-by-stage');
    expect(ids).toContain('leads-by-region');
  });

  it('covers all standard reporting categories', () => {
    const categories = new Set(REPORT_TEMPLATES.map((t) => t.category));
    expect(categories.has('Pipeline & Funnel')).toBe(true);
    expect(categories.has('Conversion & Win Rate')).toBe(true);
    expect(categories.has('Prioritization & ICE')).toBe(true);
    expect(categories.has('Market & Loss Analysis')).toBe(true);
  });

  it('retrieves templates by ID correctly', () => {
    const tmpl = getReportTemplateById('avg-ice-by-stage');
    expect(tmpl).not.toBeNull();
    expect(tmpl?.metric).toBe('avg_ice_score');
    expect(tmpl?.groupBy).toEqual(['kanbanColumn']);

    expect(getReportTemplateById('non-existent-template')).toBeNull();
  });

  it('instantiates a template into a valid ReportDefinition', () => {
    const tmpl = REPORT_TEMPLATES[0];
    const def = instantiateReportTemplate(tmpl, 'seyu', 'tenant-123', 'admin@example.com');

    expect(def.brand).toBe('seyu');
    expect(def.tenantId).toBe('tenant-123');
    expect(def.name).toBe(tmpl.name);
    expect(def.metric).toBe(tmpl.metric);
    expect(def.groupBy).toEqual(tmpl.groupBy);
    expect(def.createdBy).toBe('admin@example.com');
    expect(def.id).toMatch(/^rep_/);
    expect(def.schedule).toBeNull();
    expect(def.createdAt).toBeDefined();
    expect(def.updatedAt).toBeDefined();
  });

  it('instantiates all templates and validates them against validateReportDefinitionInput', () => {
    const starterReports = getStarterReportDefinitions('seyu', 'default');
    expect(starterReports).toHaveLength(6);

    for (const report of starterReports) {
      const validation = validateReportDefinitionInput({
        name: report.name,
        metric: report.metric,
        groupBy: report.groupBy,
        filters: report.filters,
        dateRange: report.dateRange,
        chartType: report.chartType,
      });

      expect(validation.valid).toBe(true);
      if (!validation.valid) {
        expect(validation.errors).toEqual([]);
      }
    }
  });

  it('deep clones filter arrays when instantiating so mutations do not leak', () => {
    const tmpl = REPORT_TEMPLATES[0];
    const def1 = instantiateReportTemplate(tmpl, 'seyu', 'default');
    const def2 = instantiateReportTemplate(tmpl, 'seyu', 'default');

    expect(def1.id).not.toBe(def2.id);
    expect(def1.groupBy).not.toBe(def2.groupBy);
    expect(def1.filters).not.toBe(def2.filters);
  });
});
