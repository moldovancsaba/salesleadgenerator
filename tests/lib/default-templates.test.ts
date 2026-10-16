import { describe, it, expect } from 'vitest';
import {
  DEFAULT_OUTREACH_TEMPLATES,
  getDefaultOutreachTemplates,
  interpolate,
} from '../../app/lib/outreach/default-templates';

describe('default-templates', () => {
  it('defines default outreach templates for all core brands', () => {
    expect(DEFAULT_OUTREACH_TEMPLATES.length).toBeGreaterThanOrEqual(11);

    for (const t of DEFAULT_OUTREACH_TEMPLATES) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.channel).toMatch(/^(email|linkedin)$/);
      expect(t.body).toBeTruthy();
      expect(Array.isArray(t.variables)).toBe(true);
    }
  });

  it('isolates CogMap default templates strictly to cogmap', () => {
    const cogmapTemplates = getDefaultOutreachTemplates('cogmap');
    expect(cogmapTemplates.length).toBeGreaterThan(0);
    for (const t of cogmapTemplates) {
      expect(t.brand).toBe('cogmap');
      expect(t.body).not.toContain('Seyu');
      expect(t.body).not.toContain('DVSC');
      expect(t.body).not.toContain('selfies');
    }
  });

  it('isolates Seyu default templates strictly to seyu', () => {
    const seyuTemplates = getDefaultOutreachTemplates('seyu');
    expect(seyuTemplates.length).toBeGreaterThan(0);
    for (const t of seyuTemplates) {
      expect(t.brand).toBe('seyu');
      expect(t.body).not.toContain('cognitive skills');
      expect(t.body).not.toContain('working memory');
      expect(t.body).not.toContain('DVSC');
    }
    const names = seyuTemplates.map((t) => t.name);
    expect(names).toContain('Club — Matchday Fan Engagement');
    expect(names).toContain('Arena & Club — Sponsored Fan Moments');
    expect(names).toContain('Club & Federation — LinkedIn Connect');
  });

  it('isolates DVSC default templates strictly to dvsc', () => {
    const dvscTemplates = getDefaultOutreachTemplates('dvsc');
    expect(dvscTemplates.length).toBeGreaterThan(0);
    for (const t of dvscTemplates) {
      expect(t.brand).toBe('dvsc');
      expect(t.body).not.toContain('cognitive skills');
      expect(t.body).not.toContain('working memory');
      expect(t.body).not.toContain('Seyu');
      expect(t.body).not.toContain('selfies');
    }
    const names = dvscTemplates.map((t) => t.name);
    expect(names).toContain('Sponsorship — Commercial Partnership Intro');
    expect(names).toContain('Hospitality — VIP Matchday Experience');
    expect(names).toContain('Corporate — LinkedIn Connect');
  });

  it('returns all templates when no brand is provided', () => {
    const all = getDefaultOutreachTemplates();
    expect(all.length).toBe(DEFAULT_OUTREACH_TEMPLATES.length);
  });

  it('interpolates tokens correctly for leads', () => {
    const rawTemplate = 'Hi {contact_name}, explore {entity_name} sponsorship.';
    const lead = {
      entity_name: 'D.C. United',
      contacts: [{ name: 'Alex Smith', isDecisionMaker: true }],
    };
    const rendered = interpolate(rawTemplate, lead);
    expect(rendered).toBe('Hi Alex Smith, explore D.C. United sponsorship.');
  });
});
