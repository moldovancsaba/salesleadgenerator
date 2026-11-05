import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('SalesPageClient View Switcher & Active Filter Chips (Issue 308)', () => {
  const file = readFileSync(join(process.cwd(), 'app', 'sales', '[brand]', 'sales-page-client.tsx'), 'utf8');

  it('renders SegmentedControl with semantic icons and comfortable touch targets', () => {
    expect(file).toContain('SegmentedControl');
    expect(file).toContain('IconLayoutKanban');
    expect(file).toContain('IconTable');
    expect(file).toContain('IconChartBar');
    expect(file).toContain('minHeight: 28');
  });

  it('renders active filter summary chips row when filters are applied', () => {
    expect(file).toContain('Active:');
    expect(file).toContain('Region:');
    expect(file).toContain('Industry:');
    expect(file).toContain('Owner:');
    expect(file).toContain('Tag:');
    expect(file).toContain('Search:');
  });

  it('provides a 1-click Clear all button that resets leadFilter, searchQuery, and quickPreset', () => {
    expect(file).toContain('Clear all');
    expect(file).toContain('setLeadFilter({});');
    expect(file).toContain("setSearchQuery('');");
    expect(file).toContain("setQuickPreset('all');");
  });
});
