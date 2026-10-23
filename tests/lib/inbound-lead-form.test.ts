import { describe, it, expect } from 'vitest';
import {
  normalizeWebsiteUrl,
  inferIsoCountryFromUrlOrEmail,
  inferRegionFromCountry,
  validateInboundFormSubmission,
  buildInboundLeadRecord,
} from '../../lib/inbound-lead-form';

describe('inbound-lead-form (issue 284)', () => {
  it('normalizes website URL or derives it from corporate email domain', () => {
    expect(normalizeWebsiteUrl('fcbarcelona.com')).toBe('https://fcbarcelona.com');
    expect(normalizeWebsiteUrl('https://realmadrid.com')).toBe('https://realmadrid.com');
    expect(normalizeWebsiteUrl('', 'director@arsenal.co.uk')).toBe('https://arsenal.co.uk');
    expect(normalizeWebsiteUrl('', 'person@gmail.com')).toBe('https://inbound-lead.local');
  });

  it('infers ISO country code from explicit input, website ccTLD, or email ccTLD', () => {
    expect(inferIsoCountryFromUrlOrEmail('https://example.com', 'a@example.com', 'hu')).toBe('HU');
    expect(inferIsoCountryFromUrlOrEmail('https://club.de', 'a@club.com')).toBe('DE');
    expect(inferIsoCountryFromUrlOrEmail('https://club.com', 'a@club.co.uk')).toBe('GB');
    expect(inferIsoCountryFromUrlOrEmail('https://club.com', 'a@club.com')).toBe('US');
  });

  it('maps country to sales region', () => {
    expect(inferRegionFromCountry('HU')).toBe('CEE');
    expect(inferRegionFromCountry('DE')).toBe('DACH');
    expect(inferRegionFromCountry('GB')).toBe('UKI');
    expect(inferRegionFromCountry('US')).toBe('US');
  });

  it('validates required fields and detects honeypot triggers', () => {
    const missingOrg = validateInboundFormSubmission({
      entityName: '  ',
      contactName: 'Alex Rivera',
      contactEmail: 'alex@club.es',
    });
    expect(missingOrg.ok).toBe(false);

    const badEmail = validateInboundFormSubmission({
      entityName: 'Valencia CF',
      contactName: 'Alex Rivera',
      contactEmail: 'not-an-email',
    });
    expect(badEmail.ok).toBe(false);

    const valid = validateInboundFormSubmission({
      entityName: 'Valencia CF',
      websiteUrl: 'valenciacf.es',
      contactName: 'Alex Rivera',
      contactTitle: 'Commercial Director',
      contactEmail: 'alex@valenciacf.es',
      organizationSize: 'Large',
      message: 'Interested in fan engagement suite',
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.data.country).toBe('ES');
      expect(valid.data.websiteUrl).toBe('https://valenciacf.es');
      expect(valid.data.organizationSize).toBe('Large');
      expect(valid.data.honeypotTriggered).toBe(false);
    }

    const honeypot = validateInboundFormSubmission({
      entityName: 'Bot Org',
      contactName: 'Spam Bot',
      contactEmail: 'bot@spam.com',
      companyFaxHoneypot: '123456',
    });
    expect(honeypot.ok).toBe(true);
    if (honeypot.ok) {
      expect(honeypot.data.honeypotTriggered).toBe(true);
    }
  });

  it('builds a DISCOVERED lead record with source="inbound" and champion contact', () => {
    const valid = validateInboundFormSubmission({
      entityName: 'Debreceni VSC',
      websiteUrl: 'dvsc.hu',
      contactName: 'Gábor Szabó',
      contactTitle: 'Marketing Head',
      contactEmail: 'gabor@dvsc.hu',
      contactPhone: '+36 30 555 0199',
      organizationSize: 'Medium',
      message: 'Looking for matchday activations',
    });
    expect(valid.ok).toBe(true);
    if (!valid.ok) return;

    const now = new Date('2026-10-23T12:00:00.000Z');
    const record = buildInboundLeadRecord({
      submission: valid.data,
      tenantId: 'default',
      fingerprint: 'fp_dvsc',
      sortOrder: 300,
      assignedTo: 'user_123',
      now,
    });

    expect(record.kanbanColumn).toBe('DISCOVERED');
    expect(record.source).toBe('inbound');
    expect(record.country).toBe('HU');
    expect(record.region).toBe('CEE');
    expect(record.assignedTo).toBe('user_123');
    expect(record.contacts).toHaveLength(1);
    expect(record.contacts[0].email).toBe('gabor@dvsc.hu');
    expect(record.contacts[0].buyingRole).toBe('champion');
    expect(record.ice.impact).toBe(7);
    expect(record.ice.confidence).toBe(8);
    expect(record.ice.ease).toBe(8);
    expect(record.iceScore).toBe(448);
  });
});
