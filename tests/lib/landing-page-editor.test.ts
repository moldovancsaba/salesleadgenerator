import { describe, it, expect, vi } from 'vitest';
import { EVENT_PASS_COLORS } from '@/lib/theme/event-pass-colors';
import {
  SLG_LEAD_PROPERTIES,
  THEME_PRESETS,
  DEFAULT_VEGAS_CAMPAIGN,
} from '@/lib/landing-page-schema';
import { validateInboundFormSubmission, buildInboundLeadRecord } from '@/lib/inbound-lead-form';

describe('Landing Page Editor & SLG Lead Property Alignment', () => {
  it('covers core SLG Lead properties with schema definitions', () => {
    const keys = SLG_LEAD_PROPERTIES.map((p) => p.key);
    expect(keys).toContain('contact_first_name');
    expect(keys).toContain('contact_last_name');
    expect(keys).toContain('contact_email');
    expect(keys).toContain('contact_phone');
    expect(keys).toContain('entity_name');
    expect(keys).toContain('country');
    expect(keys).toContain('post_code');
    expect(keys).toContain('city');
    expect(keys).toContain('size');
    expect(keys).toContain('sport_or_sector');
    expect(keys).toContain('industry');
    expect(keys).toContain('message');
  });

  it('provides verified design presets', () => {
    expect(THEME_PRESETS.dark_emerald).toBeDefined();
    expect(THEME_PRESETS.gold_luxury).toBeDefined();
    expect(THEME_PRESETS.indigo_tech).toBeDefined();
    expect(THEME_PRESETS.dark_emerald.primaryColor).toBe(EVENT_PASS_COLORS.primary);
  });

  it('validates submission with customized dynamic lead properties', () => {
    const res = validateInboundFormSubmission({
      firstName: 'Samantha',
      lastName: 'Fox',
      contactEmail: 'samantha@foxsports.com',
      contactPhone: '+44 7911 123456',
      entityName: 'Fox Sports Venue Group',
      country: 'GB',
      city: 'Wolverhampton',
      postCode: 'WV6 9NW',
      organizationSize: 'Enterprise',
      sportOrSector: 'Darts / Venue Hospitality',
      campaign: 'vip-giveaway-2026',
      dynamicFields: {
        'Preferred Session': 'Evening Finals',
        'VIP Hospitality': 'Yes',
      },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.contactName).toBe('Samantha Fox');
    expect(res.data.city).toBe('Wolverhampton');
    expect(res.data.organizationSize).toBe('Enterprise');
    expect(res.data.dynamicFields?.['Preferred Session']).toBe('Evening Finals');

    const lead = buildInboundLeadRecord({
      submission: res.data,
      tenantId: 'default',
      fingerprint: 'test-fp',
      sortOrder: 100,
    });

    expect(lead.entity_name).toBe('Fox Sports Venue Group');
    expect(lead.cityName).toBe('Wolverhampton');
    expect(lead.address).toBe('WV6 9NW');
    expect(lead.size).toBe('Enterprise');
    expect(lead.source).toBe('landing_vip-giveaway-2026');
    expect(lead.extraFields.dynamicFields?.['Preferred Session']).toBe('Evening Finals');
    expect(lead.notes).toContain('Preferred Session: Evening Finals');
  });

  it('ships default Vegas campaign record with verified fields', () => {
    expect(DEFAULT_VEGAS_CAMPAIGN.brand).toBe('vegas');
    expect(DEFAULT_VEGAS_CAMPAIGN.slug).toBe('grand-slam-of-darts');
    expect(DEFAULT_VEGAS_CAMPAIGN.fields.length).toBeGreaterThanOrEqual(7);
  });
});
