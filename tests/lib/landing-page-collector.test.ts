import { describe, it, expect } from 'vitest';
import { validateInboundFormSubmission, buildInboundLeadRecord } from '@/lib/inbound-lead-form';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';

describe('Landing Page Lead Collector & Vegas Client', () => {
  it('resolves brand "vegas" and its aliases', async () => {
    expect(await resolveBrand('vegas')).toBe('vegas');
    expect(await resolveBrand('mrvegas')).toBe('vegas');
    expect(await resolveBrand('mr-vegas')).toBe('vegas');
    expect(await resolveBrand('vegassales')).toBe('vegas');
    expect(await resolveBrand('VEGAS')).toBe('vegas');

    const config = await getBrandConfig('vegas');
    expect(config?.label).toBe('Vegas');
    expect(config?.currency).toBe('EUR');
    expect(config?.dbCollection).toBe('vegas_leads');
  });

  it('leaves the PDC opt-in out entirely when the form does not ask for it', () => {
    const res = validateInboundFormSubmission({
      firstName: 'Luke',
      lastName: 'Humphries',
      contactEmail: 'luke@darts-champ.co.uk',
      country: 'GB',
      postCode: 'WV6 9NW',
      dateOfBirth: '1995-02-11',
      campaign: 'grand-slam-of-darts',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.consentPdc).toBeUndefined();
  });

  it('validates landing campaign submission with tournament giveaway fields', () => {
    const input = {
      firstName: 'Luke',
      lastName: 'Humphries',
      contactEmail: 'luke@darts-champ.co.uk',
      contactPhone: '+44 7911 123456',
      country: 'GB',
      postCode: 'WV6 9NW',
      dateOfBirth: '1995-02-11',
      consentPdc: true,
      consentMrVegas: true,
      campaign: 'grand-slam-of-darts',
      message: 'Entering for GA ticket giveaway at Aldersley',
    };

    const res = validateInboundFormSubmission(input);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.data.contactName).toBe('Luke Humphries');
    expect(res.data.entityName).toBe('Luke Humphries (Individual)');
    expect(res.data.contactEmail).toBe('luke@darts-champ.co.uk');
    expect(res.data.country).toBe('GB');
    expect(res.data.region).toBe('UKI');
    expect(res.data.postCode).toBe('WV6 9NW');
    expect(res.data.dateOfBirth).toBe('1995-02-11');
    expect(res.data.consentPdc).toBe(true);
    expect(res.data.consentMrVegas).toBe(true);
    expect(res.data.campaign).toBe('grand-slam-of-darts');
    expect(res.data.honeypotTriggered).toBe(false);
  });

  it('detects honeypot bot trap on landing page forms', () => {
    const botInput = {
      firstName: 'Spam',
      lastName: 'Bot',
      contactEmail: 'bot@spam.com',
      companyFaxHoneypot: '555-SPAM-NOW',
    };

    const res = validateInboundFormSubmission(botInput);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.honeypotTriggered).toBe(true);
    }
  });

  it('builds a lead record for the Vegas pipeline with tags and metadata', () => {
    const submission = {
      entityName: 'Luke Humphries (Individual)',
      websiteUrl: 'https://darts-champ.co.uk',
      country: 'GB',
      region: 'UKI',
      contactName: 'Luke Humphries',
      firstName: 'Luke',
      lastName: 'Humphries',
      contactTitle: 'Event Participant',
      contactEmail: 'luke@darts-champ.co.uk',
      contactPhone: '+44 7911 123456',
      postCode: 'WV6 9NW',
      dateOfBirth: '1995-02-11',
      consentPdc: true,
      consentMrVegas: true,
      sportOrSector: 'Darts & Sports Entertainment',
      organizationSize: '' as const,
      message: 'GA ticket giveaway entry',
      campaign: 'grand-slam-of-darts',
      honeypotTriggered: false,
    };

    const lead = buildInboundLeadRecord({
      submission,
      tenantId: 'default',
      fingerprint: 'fp-vegas-123',
      sortOrder: 0,
      now: new Date('2026-11-06T12:00:00Z'),
    });

    expect(lead.entity_name).toBe('Luke Humphries (Individual)');
    expect(lead.kanbanColumn).toBe('DISCOVERED');
    expect(lead.source).toBe('landing_grand-slam-of-darts');
    expect(lead.campaign).toBe('grand-slam-of-darts');
    expect(lead.tags).toContain('grand-slam-of-darts');
    expect(lead.address).toBe('WV6 9NW');
    expect(lead.extraFields?.dateOfBirth).toBe('1995-02-11');
    expect(lead.extraFields?.consentMrVegas).toBe(true);
    expect(lead.contacts[0].email).toBe('luke@darts-champ.co.uk');
  });
});
