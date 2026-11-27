import { describe, it, expect } from 'vitest';
import {
  validateInboundFormSubmission,
  buildInboundLeadRecord,
  buildRepeatSubmissionUpdate,
} from '@/lib/inbound-lead-form';
import { normalizeLead } from '@/app/lib/normalize-lead';
import { aggregateContactsAcrossLeads } from '@/lib/contacts';
import {
  exportLeadsToCsv,
  exportLeadsToGoogleSheetsTsv,
  parseCsvOrTsv,
  parseCrmImport,
} from '@/lib/crm-lead-exchange';
import {
  buildConsentLedger,
  formatConsentsSummary,
  resolveConsentsByPerson,
  resolveLeadConsents,
} from '@/lib/lead-consents';

describe('Pipeline stage & landing page consents across lead data and CSV exports (issue 361)', () => {
  it('persists structured consents on both lead and contact for initial and repeat landing submissions', () => {
    const initial = validateInboundFormSubmission({
      firstName: 'Emma',
      lastName: 'Rivers',
      contactEmail: 'emma@tennis.example.co.uk',
      contactPhone: '+44 7700 900123',
      country: 'GB',
      campaign: 'vip-fan-pass',
      consents: [
        { key: 'c_marketing', label: 'Receive marketing and promotional offers?', value: 'Yes' },
        { key: 'c_age', label: 'Confirm you are aged 18+', value: true },
      ],
    });
    expect(initial.ok).toBe(true);
    if (!initial.ok) return;

    const lead = buildInboundLeadRecord({
      submission: initial.data,
      tenantId: 'default',
      fingerprint: 'fp-emma-1',
      sortOrder: 0,
      now: new Date('2026-11-27T12:00:00Z'),
    });

    expect(lead.kanbanColumn).toBe('ENGAGED');
    expect(lead.consents).toEqual([
      { key: 'c_marketing', label: 'Receive marketing and promotional offers?', value: 'Yes' },
      { key: 'c_age', label: 'Confirm you are aged 18+', value: true },
    ]);
    expect(lead.contacts[0].consents).toEqual(lead.consents);

    // Repeat submission updates an existing consent choice and adds a new campaign consent
    const repeat = validateInboundFormSubmission({
      firstName: 'Emma',
      lastName: 'Rivers',
      contactEmail: 'emma@tennis.example.co.uk',
      campaign: 'winter-invitational',
      consents: [
        { key: 'c_marketing', label: 'Receive marketing and promotional offers?', value: 'No' },
        { key: 'c_partner', label: 'Partner sponsor updates', value: true },
      ],
    });
    expect(repeat.ok).toBe(true);
    if (!repeat.ok) return;

    const repeatPatch = buildRepeatSubmissionUpdate({
      existing: lead,
      submission: repeat.data,
      now: new Date('2026-11-27T13:00:00Z'),
    });

    expect(repeatPatch.consents).toEqual([
      { key: 'c_marketing', label: 'Receive marketing and promotional offers?', value: 'No' },
      { key: 'c_age', label: 'Confirm you are aged 18+', value: true },
      { key: 'c_partner', label: 'Partner sponsor updates', value: true },
    ]);
    expect(repeatPatch.contacts[0].consents).toEqual([
      { key: 'c_marketing', label: 'Receive marketing and promotional offers?', value: 'No' },
      { key: 'c_age', label: 'Confirm you are aged 18+', value: true },
      { key: 'c_partner', label: 'Partner sponsor updates', value: true },
    ]);
  });

  it('normalizes legacy stored landing-page leads into top-level lead.consents automatically', () => {
    const legacyLead = normalizeLead({
      _id: 'legacy-vegas-1',
      entity_name: 'Jo Sample (Individual)',
      country: 'GB',
      region: 'UKI',
      kanbanColumn: 'ENGAGED',
      extraFields: {
        consentMrVegas: true,
        consentPdc: false,
      },
      contacts: [{ name: 'Jo Sample', email: 'jo@example.co.uk' }],
    });

    expect(legacyLead.consents).toEqual([
      { key: 'consentPdc', label: 'PDC Email Opt-in', value: false },
      { key: 'consentMrVegas', label: 'Mr Vegas Promo Opt-in', value: true },
    ]);
    expect(formatConsentsSummary(resolveLeadConsents(legacyLead))).toBe(
      'PDC Email Opt-in: No; Mr Vegas Promo Opt-in: Yes'
    );
  });

  it('includes Pipeline Stage, Consents summary, and per-consent columns across all CRM CSV/TSV exports and round-trips Consent columns on import', () => {
    const leads = [
      {
        _id: 'lead-101',
        entity_name: 'Carlos Alba Academy',
        url: 'https://alba.example.es',
        country: 'ES',
        cityName: 'Murcia',
        region: 'EMEA',
        sport_or_sector: 'Tennis',
        kanbanColumn: 'ENGAGED' as const,
        contacts: [
          {
            name: 'Carlos Alba',
            firstName: 'Carlos',
            lastName: 'Alba',
            email: 'carlos@alba.example.es',
            phone: '+34 600 123 456',
            title: 'Founder',
            consents: [
              { key: 'c_promo', label: 'Marketing & Promo Offers', value: true },
              { key: 'c_terms', label: 'Event Terms Accepted', value: 'Yes' },
            ],
          },
        ],
        consents: [
          { key: 'c_promo', label: 'Marketing & Promo Offers', value: true },
          { key: 'c_terms', label: 'Event Terms Accepted', value: 'Yes' },
        ],
      },
      {
        _id: 'lead-102',
        entity_name: 'Baseline Club',
        url: 'https://baseline.example.com',
        country: 'US',
        kanbanColumn: 'QUALIFIED' as const,
        contacts: [{ name: 'Sam Coach', email: 'sam@baseline.example.com' }],
      },
    ];

    for (const preset of ['google_sheets', 'universal', 'hubspot', 'salesforce', 'pipedrive', 'apollo'] as const) {
      const csv = exportLeadsToCsv(leads, preset);
      const { headers, rows } = parseCsvOrTsv(csv);

      const stageIdx = headers.indexOf('Pipeline Stage');
      const summaryIdx = headers.indexOf('Consents');
      const promoColIdx = headers.indexOf('Consent: Marketing & Promo Offers');
      const termsColIdx = headers.indexOf('Consent: Event Terms Accepted');

      expect(stageIdx).toBeGreaterThanOrEqual(0);
      expect(summaryIdx).toBeGreaterThanOrEqual(0);
      expect(promoColIdx).toBeGreaterThanOrEqual(0);
      expect(termsColIdx).toBeGreaterThanOrEqual(0);

      expect(rows[0][stageIdx]).toBe('ENGAGED');
      expect(rows[0][summaryIdx]).toBe('Marketing & Promo Offers: Yes; Event Terms Accepted: Yes');
      expect(rows[0][promoColIdx]).toBe('Yes');
      expect(rows[0][termsColIdx]).toBe('Yes');

      expect(rows[1][stageIdx]).toBe('QUALIFIED');
      expect(rows[1][summaryIdx]).toBe('');
      expect(rows[1][promoColIdx]).toBe('');
    }

    const tsv = exportLeadsToGoogleSheetsTsv(leads);
    const parsedTsv = parseCsvOrTsv(tsv);
    expect(parsedTsv.headers).toContain('Pipeline Stage');
    expect(parsedTsv.headers).toContain('Consents');
    expect(parsedTsv.headers).toContain('Consent: Marketing & Promo Offers');
    expect(parsedTsv.rows[0][parsedTsv.headers.indexOf('Pipeline Stage')]).toBe('ENGAGED');
    expect(parsedTsv.rows[0][parsedTsv.headers.indexOf('Consent: Marketing & Promo Offers')]).toBe('Yes');

    // Round-trip import preserves both Pipeline Stage and Consent: columns
    const reimported = parseCrmImport(exportLeadsToCsv(leads, 'google_sheets'));
    expect(reimported.validLeads[0].kanbanColumn).toBe('ENGAGED');
    expect(reimported.validLeads[0].consents).toEqual([
      { key: 'marketing_promo_offers', label: 'Marketing & Promo Offers', value: true },
      { key: 'event_terms_accepted', label: 'Event Terms Accepted', value: true },
    ]);
  });

  it('aggregates pipeline stage and consents onto ContactDirectoryEntry for Contacts UI and CSV export', () => {
    const dir = aggregateContactsAcrossLeads([
      {
        _id: 'l1',
        entity_name: 'Club One',
        kanbanColumn: 'DISCOVERED',
        contacts: [{ name: 'Alex Taylor', email: 'alex@club.example.com' }],
      },
      {
        _id: 'l2',
        entity_name: 'Landing Entry Alex',
        kanbanColumn: 'ENGAGED',
        submissionHistory: [
          {
            submittedAt: '2026-11-27T10:00:00.000Z',
            contactName: 'Alex Taylor',
            contactEmail: 'alex@club.example.com',
            consents: [{ key: 'opt_in', label: 'Newsletter Opt-in', value: true }],
          },
        ],
        contacts: [{ name: 'Alex Taylor', email: 'alex@club.example.com' }],
      },
    ]);

    expect(dir).toHaveLength(1);
    expect(dir[0].pipelineStage).toBe('ENGAGED');
    expect(dir[0].leads).toEqual([
      { leadId: 'l1', entity_name: 'Club One', kanbanColumn: 'DISCOVERED' },
      { leadId: 'l2', entity_name: 'Landing Entry Alex', kanbanColumn: 'ENGAGED' },
    ]);
    expect(dir[0].consents).toEqual([
      { key: 'opt_in', label: 'Newsletter Opt-in', value: true },
    ]);
  });
});

describe('a consent answer stays with the person who gave it (issue 361)', () => {
  const MARKETING = { key: 'f_1', label: 'Marketing offers', value: 'No' };

  function form(first: string, email: string, consents: unknown[], extra: Record<string, unknown> = {}) {
    const result = validateInboundFormSubmission({
      firstName: first,
      lastName: 'Example',
      contactEmail: email,
      entityName: 'Example Club',
      websiteUrl: 'https://example.com',
      campaign: 'spring',
      consents,
      ...extra,
    });
    if (!result.ok) throw new Error(result.error);
    return result.data;
  }

  /** Anna refuses marketing, Ben (same club) accepts it and a partner question, Carol never fills in the form. */
  function sharedLead() {
    const lead: any = buildInboundLeadRecord({
      submission: form('Anna', 'anna@example.com', [MARKETING]),
      tenantId: 'default',
      fingerprint: 'fp-club',
      sortOrder: 0,
      now: new Date('2026-11-20T10:00:00Z'),
    });
    const patch: any = buildRepeatSubmissionUpdate({
      existing: lead,
      submission: form('Ben', 'ben@example.com', [
        { ...MARKETING, value: 'Yes' },
        { key: 'f_2', label: 'Partner offers', value: 'Yes' },
      ]),
      now: new Date('2026-11-21T10:00:00Z'),
    });
    const merged: any = { ...lead, ...patch, _id: 'lead-club' };
    merged.contacts = [...merged.contacts, { name: 'Carol Researched', email: 'carol@example.com' }];
    return merged;
  }

  /** The same record as saved before this change: no per-contact answers, one blended list on the lead. */
  function savedBeforeThisChange() {
    const { consents: _blend, ...lead } = sharedLead();
    return { ...lead, contacts: lead.contacts.map(({ consents: _own, ...c }: any) => c) };
  }

  const answers = (entries: Array<{ label: string; value: unknown }> | undefined) =>
    (entries ?? []).map((e) => `${e.label}=${e.value}`);

  it.each([
    ['new records', sharedLead],
    ['records saved before this change', savedBeforeThisChange],
  ])('gives each contact only their own answers (%s)', (_name, build) => {
    const lead = build();
    const directory = aggregateContactsAcrossLeads([{ ...lead, consents: resolveLeadConsents(lead) } as any]);
    const byEmail = Object.fromEntries(directory.map((e) => [e.email, answers(e.consents)]));

    expect(byEmail['anna@example.com']).toEqual(['Marketing offers=No']);
    expect(byEmail['ben@example.com']).toEqual(['Marketing offers=Yes', 'Partner offers=Yes']);
    expect(byEmail['carol@example.com']).toEqual([]);
  });

  it('puts only the named person\'s answers on a lead export row', () => {
    const { headers, rows } = parseCsvOrTsv(exportLeadsToCsv([sharedLead()], 'google_sheets'));
    expect(rows[0][headers.indexOf('Primary Contact Email')]).toBe('anna@example.com');
    expect(rows[0][headers.indexOf('Consents')]).toBe('Marketing offers: No');
    expect(headers).not.toContain('Consent: Partner offers');
  });

  it('groups answers by person for lead details', () => {
    const { people, unattributed } = resolveConsentsByPerson(sharedLead());
    expect(people.map((p) => [p.name, p.email, answers(p.consents)])).toEqual([
      ['Anna Example', 'anna@example.com', ['Marketing offers=No']],
      ['Ben Example', 'ben@example.com', ['Marketing offers=Yes', 'Partner offers=Yes']],
    ]);
    expect(unattributed).toEqual([]);
  });

  it.each([
    ['the second form leaves the phone out', { contactPhone: '+44 7700 900123' }, {}],
    ['the second form adds a phone', {}, { contactPhone: '+44 7700 900123' }],
  ])('keeps one contact with the newest answer when %s', (_name, firstExtra, secondExtra) => {
    const lead: any = buildInboundLeadRecord({
      submission: form('Anna', 'anna@example.com', [{ ...MARKETING, value: 'Yes' }], firstExtra),
      tenantId: 'default',
      fingerprint: 'fp-anna',
      sortOrder: 0,
      now: new Date('2026-11-20T10:00:00Z'),
    });
    const patch: any = buildRepeatSubmissionUpdate({
      existing: lead,
      submission: form('Anna', 'anna@example.com', [MARKETING], secondExtra),
      now: new Date('2026-11-21T10:00:00Z'),
    });

    expect(patch.contacts).toHaveLength(1);
    expect(patch.contacts[0].phone).toBeTruthy();
    expect(answers(patch.contacts[0].consents)).toEqual(['Marketing offers=No']);
    const directory = aggregateContactsAcrossLeads([{ ...lead, ...patch, _id: 'lead-anna' }]);
    expect(directory.map((e) => answers(e.consents))).toEqual([['Marketing offers=No']]);
  });

  it('lets a later "No" replace an earlier "Yes" in the older yes/no fields', () => {
    const lead = {
      submissionHistory: [
        { submittedAt: '2026-11-12T10:00:00Z', contactEmail: 'fan@example.com', consentMrVegas: true },
        { submittedAt: '2026-11-16T10:00:00Z', contactEmail: 'fan@example.com', consentMrVegas: false },
      ],
      extraFields: { consentMrVegas: false },
    };
    expect(answers(resolveLeadConsents(lead))).toEqual(['Mr Vegas Promo Opt-in=false']);
    expect(answers(buildConsentLedger([lead]).get('fan@example.com'))).toEqual(['Mr Vegas Promo Opt-in=false']);
  });

  it('credits a record without form history to its first contact only while the stored form address matches', () => {
    const base = {
      _id: 'old-1',
      entity_name: 'Old Entry',
      extraFields: { consentPdc: true },
      contacts: [{ name: 'First Person', email: 'first@example.com' }, { name: 'Added Later', email: 'later@example.com' }],
    };
    const known = aggregateContactsAcrossLeads([{ ...base, general_contact: 'first@example.com' } as any]);
    expect(Object.fromEntries(known.map((e) => [e.email, answers(e.consents)]))).toEqual({
      'first@example.com': ['PDC Email Opt-in=true'],
      'later@example.com': [],
    });

    const unsure = { ...base, general_contact: 'office@example.com' };
    expect(aggregateContactsAcrossLeads([unsure as any]).every((e) => !e.consents)).toBe(true);
    expect(resolveConsentsByPerson(unsure).people).toEqual([]);
    expect(answers(resolveConsentsByPerson(unsure).unattributed)).toEqual(['PDC Email Opt-in=true']);
  });

  it('never shows an answer under another question that happens to share a field id', () => {
    const person = (email: string, label: string) => ({
      entity_name: email,
      contacts: [{ name: email, email, consents: [{ key: 'f_same', label, value: true }] }],
    });
    const { headers, rows } = parseCsvOrTsv(
      exportLeadsToCsv([person('a@example.com', 'Marketing offers'), person('b@example.com', 'Aged 18 or over')], 'google_sheets')
    );
    const marketing = headers.indexOf('Consent: Marketing offers');
    const adult = headers.indexOf('Consent: Aged 18 or over');
    expect([rows[0][marketing], rows[0][adult]]).toEqual(['Yes', '']);
    expect([rows[1][marketing], rows[1][adult]]).toEqual(['', 'Yes']);
  });

  it('treats edited wording of the same field on the same campaign as the same question', () => {
    const snap = (submittedAt: string, label: string, value: string) => ({
      submittedAt,
      contactEmail: 'fan@example.com',
      campaign: 'spring',
      consents: [{ key: 'f_1', label, value }],
    });
    const ledger = buildConsentLedger([
      { submissionHistory: [snap('2026-11-01T10:00:00Z', 'Marketing ofers', 'Yes'), snap('2026-11-02T10:00:00Z', 'Marketing offers', 'No')] },
    ]);
    expect(answers(ledger.get('fan@example.com'))).toEqual(['Marketing offers=No']);
  });

  it('keeps a stored refusal, for example from a spreadsheet import, over an earlier form "Yes"', () => {
    const lead = {
      submissionHistory: [
        { submittedAt: '2026-11-01T10:00:00Z', contactEmail: 'fan@example.com', consents: [{ ...MARKETING, value: 'Yes' }] },
      ],
      contacts: [{ name: 'Fan', email: 'FAN@example.com', consents: [MARKETING] }],
    };
    expect(answers(buildConsentLedger([lead]).get('fan@example.com'))).toEqual(['Marketing offers=No']);
  });
});
