import { describe, expect, it } from 'vitest';
import {
  buildInboundLeadRecord,
  buildRepeatSubmissionUpdate,
  hasMarketingPromoOptIn,
  resolveInboundKanbanColumn,
  type ValidatedInboundFormSubmission,
} from '../../lib/inbound-lead-form';

function makeSubmission(overrides: Partial<ValidatedInboundFormSubmission> = {}): ValidatedInboundFormSubmission {
  return {
    entityName: 'Alex Example',
    websiteUrl: 'https://example.com',
    country: 'GB',
    region: 'Europe',
    contactName: 'Alex Example',
    contactTitle: 'Lead Contact',
    contactEmail: 'alex@example.com',
    contactPhone: '+44 7700 900123',
    postCode: 'WV6 9NW',
    city: 'Wolverhampton',
    dateOfBirth: '1990-05-01',
    consentMrVegas: true,
    sportOrSector: 'Darts',
    organizationSize: 'Medium',
    message: 'Initial fan zone entry',
    campaign: 'grand-slam-of-darts',
    dynamicFields: { seatSection: 'North' },
    honeypotTriggered: false,
    ...overrides,
  };
}

describe('inbound form repeat-submission enrichment & history preservation', () => {
  it('initializes submissionHistory on first lead creation', () => {
    const first = makeSubmission();
    const record = buildInboundLeadRecord({
      submission: first,
      tenantId: 'default',
      fingerprint: 'fp-1',
      sortOrder: 0,
      now: new Date('2026-11-14T18:00:00.000Z'),
    });

    expect(record.submissionHistory).toHaveLength(1);
    expect(record.submissionHistory[0]).toMatchObject({
      submittedAt: '2026-11-14T18:00:00.000Z',
      contactEmail: 'alex@example.com',
      postCode: 'WV6 9NW',
      consentMrVegas: true,
      campaign: 'grand-slam-of-darts',
    });
  });

  it('preserves legacy historic submission data while enriching/updating the existing lead on repeat submit', () => {
    const legacyExisting = {
      _id: { toString: () => 'lead-legacy-1' },
      entity_name: 'Acme Sports',
      country: '',
      address: '',
      cityName: '',
      size: '',
      contacts: [{ name: 'Alex Old', email: 'alex@example.com', isDecisionMaker: true }],
      contactEmails: ['alex@example.com'],
      notes: '[Inbound Form 2026-11-09] Initial entry',
      tags: ['early-bird'],
      campaign: 'early-bird',
      extraFields: {
        postCode: 'SW1A 1AA',
        consentMrVegas: false,
        dynamicFields: { ticketTier: 'VIP' },
      },
      createdAt: new Date('2026-11-09T12:00:00.000Z'),
    };

    const repeat = makeSubmission({
      entityName: 'Acme Sports Updated',
      country: 'GB',
      region: 'Europe',
      postCode: 'WV6 9NW',
      city: 'Wolverhampton',
      organizationSize: 'Enterprise',
      consentMrVegas: true,
      campaign: 'grand-slam-of-darts',
      message: 'Second submission at fan zone',
      dynamicFields: { booth: 'Main Stage' },
    });

    const patch = buildRepeatSubmissionUpdate({
      existing: legacyExisting,
      submission: repeat,
      now: new Date('2026-11-16T19:00:00.000Z'),
      nowIso: '2026-11-16T19:00:00.000Z',
    });

    // Preserves both historic and new submissions cleanly in history + notes
    expect(patch.submissionHistory).toHaveLength(2);
    expect(patch.submissionHistory[0]).toMatchObject({
      submittedAt: '2026-11-09T12:00:00.000Z',
      postCode: 'SW1A 1AA',
      consentMrVegas: false,
      campaign: 'early-bird',
      dynamicFields: { ticketTier: 'VIP' },
    });
    expect(patch.submissionHistory[1]).toMatchObject({
      submittedAt: '2026-11-16T19:00:00.000Z',
      postCode: 'WV6 9NW',
      consentMrVegas: true,
      campaign: 'grand-slam-of-darts',
      dynamicFields: { booth: 'Main Stage' },
    });

    expect(patch.notes).toContain('[Inbound Form 2026-11-09] Initial entry');
    expect(patch.notes).toContain('[Inbound Form 2026-11-16]');
    expect(patch.tags).toEqual(['early-bird', 'grand-slam-of-darts']);
    expect(patch.extraFields.dynamicFields).toEqual({ ticketTier: 'VIP', booth: 'Main Stage' });
    // Enriches previously blank fields, keeps original primary campaign intact
    expect(patch.country).toBe('GB');
    expect(patch.cityName).toBe('Wolverhampton');
    expect(patch.size).toBe('Enterprise');
    expect(patch.campaign).toBeUndefined();
  });

  it('merges page-defined consents by field key across repeat submissions', () => {
    const existing = {
      contacts: [{ name: 'Alex', email: 'alex@example.com' }],
      extraFields: {
        consents: [
          { key: 'f_news', label: 'Newsletter Opt-in', value: false },
          { key: 'f_partner', label: 'Partner Offers', value: 'Yes' },
        ],
      },
      createdAt: new Date('2026-11-10T10:00:00Z'),
    };
    const repeat = makeSubmission({
      consentMrVegas: undefined,
      consents: [
        { key: 'f_news', label: 'Newsletter Opt-in', value: true },
        { key: 'f_vip', label: 'VIP Invite', value: true },
      ],
    });

    const patch = buildRepeatSubmissionUpdate({ existing, submission: repeat });
    expect(patch.extraFields.consents).toEqual([
      { key: 'f_news', label: 'Newsletter Opt-in', value: true },
      { key: 'f_partner', label: 'Partner Offers', value: 'Yes' },
      { key: 'f_vip', label: 'VIP Invite', value: true },
    ]);
  });

  it('places new leads into ENGAGED only when opting in ("Yes"/true) to marketing or promotional offers', () => {
    const vegasYes = makeSubmission({
      consentMrVegas: undefined,
      consents: [
        {
          key: 'f_vegas_consent',
          label: 'Can Mr Vegas contact you with marketing and promotional offers?',
          value: 'Yes',
        },
      ],
    });
    expect(hasMarketingPromoOptIn(vegasYes)).toBe(true);
    expect(resolveInboundKanbanColumn(vegasYes)).toBe('ENGAGED');
    const engagedLead = buildInboundLeadRecord({
      submission: vegasYes,
      tenantId: 'default',
      fingerprint: 'fp-engaged',
      sortOrder: 0,
    });
    expect(engagedLead.kanbanColumn).toBe('ENGAGED');
    expect(engagedLead.manualLaneFloorColumn).toBe('ENGAGED');

    const vegasNo = makeSubmission({
      consentMrVegas: undefined,
      consents: [
        {
          key: 'f_vegas_consent',
          label: 'Can Mr Vegas contact you with marketing and promotional offers?',
          value: 'no',
        },
      ],
    });
    expect(hasMarketingPromoOptIn(vegasNo)).toBe(false);
    expect(resolveInboundKanbanColumn(vegasNo)).toBe('DISCOVERED');

    const legalOnly = makeSubmission({
      consentMrVegas: undefined,
      consents: [
        {
          key: 'f_terms',
          label: 'I agree to the Terms & Conditions and Privacy Policy',
          value: true,
        },
      ],
    });
    expect(hasMarketingPromoOptIn(legalOnly)).toBe(false);
    expect(resolveInboundKanbanColumn(legalOnly)).toBe('DISCOVERED');
  });
});
