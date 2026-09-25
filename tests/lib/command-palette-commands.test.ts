import { describe, it, expect } from 'vitest';
import { buildSalesBoardCommandDescriptors, LEAD_COMMAND_CAP } from '../../lib/command-palette-commands';

const BASE_INPUT = {
  accessibleBrands: ['cogmap'],
  brandLabels: { cogmap: 'CogMap' },
  currentBrand: 'cogmap',
  loadedLeads: [] as Array<{ _id: string; entity_name: string; industry?: string; sport_or_sector?: string }>,
};

describe('buildSalesBoardCommandDescriptors (issue 213)', () => {
  it('always includes add-lead and toggle-select-mode, in that order, first', () => {
    const descriptors = buildSalesBoardCommandDescriptors(BASE_INPUT);
    expect(descriptors[0]).toEqual({ kind: 'add-lead' });
    expect(descriptors[1]).toEqual({ kind: 'toggle-select-mode' });
  });

  it('registers no brand-switch commands for a user with only 1 accessible brand', () => {
    const descriptors = buildSalesBoardCommandDescriptors(BASE_INPUT);
    expect(descriptors.some((d) => d.kind === 'switch-brand')).toBe(false);
  });

  it('registers a switch-brand command for every OTHER accessible brand once the user has 2+', () => {
    const descriptors = buildSalesBoardCommandDescriptors({
      ...BASE_INPUT,
      accessibleBrands: ['cogmap', 'seyu', 'dvsc'],
      brandLabels: { cogmap: 'CogMap', seyu: 'Seyu', dvsc: 'DVSC' },
      currentBrand: 'cogmap',
    });
    const switchCommands = descriptors.filter((d) => d.kind === 'switch-brand');
    expect(switchCommands).toHaveLength(2);
    expect(switchCommands.map((d: any) => d.brand).sort()).toEqual(['dvsc', 'seyu']);
  });

  it('never includes a switch-brand command for the currently active brand', () => {
    const descriptors = buildSalesBoardCommandDescriptors({
      ...BASE_INPUT,
      accessibleBrands: ['cogmap', 'seyu'],
      brandLabels: { cogmap: 'CogMap', seyu: 'Seyu' },
      currentBrand: 'cogmap',
    });
    expect(descriptors.some((d: any) => d.kind === 'switch-brand' && d.brand === 'cogmap')).toBe(false);
  });

  it('maps each loaded lead to a jump-to-lead descriptor with industry/sector as keywords', () => {
    const descriptors = buildSalesBoardCommandDescriptors({
      ...BASE_INPUT,
      loadedLeads: [{ _id: 'lead-1', entity_name: 'Acme FC', industry: 'Sports', sport_or_sector: 'Football' }],
    });
    const leadCommand = descriptors.find((d) => d.kind === 'jump-to-lead') as any;
    expect(leadCommand).toEqual({ kind: 'jump-to-lead', leadId: 'lead-1', label: 'Acme FC', keywords: ['Sports', 'Football'] });
  });

  it('caps the number of lead commands at LEAD_COMMAND_CAP', () => {
    const loadedLeads = Array.from({ length: LEAD_COMMAND_CAP + 50 }, (_, i) => ({ _id: `lead-${i}`, entity_name: `Lead ${i}` }));
    const descriptors = buildSalesBoardCommandDescriptors({ ...BASE_INPUT, loadedLeads });
    const leadCommands = descriptors.filter((d) => d.kind === 'jump-to-lead');
    expect(leadCommands).toHaveLength(LEAD_COMMAND_CAP);
  });

  it('lead commands come after the static + brand-switch commands, matching GDS\'s empty-query registration-order display', () => {
    const descriptors = buildSalesBoardCommandDescriptors({
      ...BASE_INPUT,
      accessibleBrands: ['cogmap', 'seyu'],
      brandLabels: { cogmap: 'CogMap', seyu: 'Seyu' },
      loadedLeads: [{ _id: 'lead-1', entity_name: 'Acme FC' }],
    });
    const leadIndex = descriptors.findIndex((d) => d.kind === 'jump-to-lead');
    const switchIndex = descriptors.findIndex((d) => d.kind === 'switch-brand');
    expect(leadIndex).toBeGreaterThan(switchIndex);
    expect(switchIndex).toBeGreaterThan(1); // after add-lead (0) and toggle-select-mode (1)
  });
});
