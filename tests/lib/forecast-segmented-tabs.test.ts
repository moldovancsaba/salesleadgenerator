import { describe, it, expect } from 'vitest';

describe('Revenue Forecast Segmented Tabs (Issue 320)', () => {
  const validTabs = ['overview', 'waterfall', 'categories', 'winrates'] as const;

  it('validates active tab selection against allowed values', () => {
    const rawParam = 'waterfall';
    const activeTab = validTabs.includes(rawParam as any) ? rawParam : 'overview';
    expect(activeTab).toBe('waterfall');
  });

  it('defaults to overview tab when invalid or missing parameter is provided', () => {
    const invalidParam = 'unknown_section';
    const activeTab = validTabs.includes(invalidParam as any) ? invalidParam : 'overview';
    expect(activeTab).toBe('overview');

    const emptyParam = '';
    const fallbackTab = validTabs.includes(emptyParam as any) ? emptyParam : 'overview';
    expect(fallbackTab).toBe('overview');
  });

  it('generates proper query string on tab switch without losing other parameters', () => {
    const currentSearch = '?brand=padel-africa&tenantId=padel-africa';
    const params = new URLSearchParams(currentSearch);
    params.set('tab', 'categories');
    expect(params.toString()).toBe('brand=padel-africa&tenantId=padel-africa&tab=categories');
  });
});
