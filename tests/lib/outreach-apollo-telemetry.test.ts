import { describe, it, expect, vi } from 'vitest';
import {
  normalizeContact,
  mergeEnrichedContacts,
  aggregateContactsAcrossLeads,
  resolveOutreachTargetContact,
} from '../../lib/contacts';
import { queryContactsDirectory } from '../../lib/contacts-directory';
import { buildPersonalizationContext, interpolateTemplate } from '../../lib/template-personalization';
import { evaluateOutreachRouting } from '../../app/lib/outreach/routing-rules';
import { detectCrmPreset, parseCrmImport } from '../../lib/crm-lead-exchange';
import {
  checkApolloEntitlements,
  mapApolloPersonToLead,
  searchApolloContacts,
} from '../../lib/apollo-import';
import {
  getWorkspaceResearchTelemetry,
  recordResearchTelemetryRun,
  resolveLeadLastResearchedAt,
} from '../../lib/research-telemetry';

describe('person and organization outreach fields (issue 359 / backlog 09)', () => {
  it('exposes all 13 person and company outreach fields across normalization, directory, and personalization', () => {
    const contact = normalizeContact({
      firstName: 'claire',
      lastName: 'dubois',
      country: 'fr',
      title: 'Partnership Lead',
      departmentOverride: 'Marketing',
      email: 'Claire@LigueClub.fr',
      phone: '+33 1 42 68 55 00',
      linkedin: 'https://www.linkedin.com/in/claire-dubois',
      buyingRole: 'champion',
    });

    expect(contact.name).toBe('Claire Dubois');
    expect(contact.firstName).toBe('Claire');
    expect(contact.lastName).toBe('Dubois');
    expect(contact.country).toBe('FR');
    expect(contact.department).toBe('Marketing');
    expect(contact.email).toBe('claire@ligueclub.fr');
    expect(contact.phone).toBe('+33142685500');

    const directory = aggregateContactsAcrossLeads([
      {
        _id: 'lead-fr-1',
        entity_name: 'Ligue Club Paris',
        country: 'FR',
        industry: 'Sports & Entertainment',
        url: 'https://ligueclub.fr',
        companyLinkedin: 'https://www.linkedin.com/company/ligue-club-paris',
        companyPhone: '+33199887766',
        source: 'discovery-cron',
        lastResearchedAt: '2026-11-25T10:00:00.000Z',
        contacts: [contact],
      },
    ]);

    expect(directory).toHaveLength(1);
    expect(directory[0]).toMatchObject({
      firstName: 'Claire',
      lastName: 'Dubois',
      country: 'FR',
      company: 'Ligue Club Paris',
      title: 'Partnership Lead',
      department: 'Marketing',
      industry: 'Sports & Entertainment',
      email: 'claire@ligueclub.fr',
      phone: '+33142685500',
      linkedin: 'https://www.linkedin.com/in/claire-dubois',
      companyWebsite: 'https://ligueclub.fr',
      companyLinkedin: 'https://www.linkedin.com/company/ligue-club-paris',
      companyPhone: '+33199887766',
    });

    const filtered = queryContactsDirectory(directory, {
      department: 'Marketing',
      country: 'FR',
      emailOnly: true,
    });
    expect(filtered.filteredCount).toBe(1);

    const ctx = buildPersonalizationContext({
      lead: {
        entity_name: 'Ligue Club Paris',
        url: 'https://ligueclub.fr',
        companyLinkedin: 'https://www.linkedin.com/company/ligue-club-paris',
        companyPhone: '+33199887766',
        country: 'FR',
        industry: 'Sports & Entertainment',
      },
      contact,
    });

    const msg = interpolateTemplate(
      'Hi {first_name} {last_name} ({department}, {country}) at {company_name} ({company_website} / {company_linkedin} / {company_phone})',
      ctx
    );
    expect(msg).toBe(
      'Hi Claire Dubois (Marketing, FR) at Ligue Club Paris (https://ligueclub.fr / https://www.linkedin.com/company/ligue-club-paris / +33199887766)'
    );
  });

  it('allows selecting a non-decision-maker contact on a lead for outreach without bypassing stored-contact validation', () => {
    const lead = {
      url: 'https://acme.example.com',
      contacts: [
        { name: 'Alex Exec', email: '', isDecisionMaker: true },
        { name: 'Sam Champion', email: 'sam@acme.example.com', isDecisionMaker: false },
      ],
    };

    // Default automated cadence check still blocks because DM lacks email
    expect(evaluateOutreachRouting('email', lead, 'Hello').allowed).toBe(false);

    // Explicit contact selection resolves Sam Champion and permits outreach
    const selected = resolveOutreachTargetContact(lead.contacts, { email: 'sam@acme.example.com' });
    expect(selected?.name).toBe('Sam Champion');
    expect(evaluateOutreachRouting('email', lead, 'Hello', { selectedContact: selected }).allowed).toBe(true);

    // Unknown external email never resolves
    expect(resolveOutreachTargetContact(lead.contacts, { email: 'stranger@other.com' })).toBeNull();
  });
});

describe('unattended discovery and enrichment contact merge & telemetry (issue 359 / backlog 11)', () => {
  it('enriches an existing discovered contact with phone, LinkedIn, and upgraded role without duplicating', () => {
    const discovered = [
      {
        name: 'Elena Kovács',
        title: 'Commercial Manager',
        email: 'elena@Ferencvaros.example.hu',
        buyingRole: 'unknown' as const,
        lastVerifiedAt: '2026-11-25T08:00:00.000Z',
      },
    ];

    const enrichedPass = [
      {
        name: 'Elena Kovács',
        email: 'elena@ferencvaros.example.hu',
        phone: '+36 30 555 1234',
        linkedin: 'https://www.linkedin.com/in/elena-kovacs',
        departmentOverride: 'Sales' as const,
        buyingRole: 'decision_maker' as const,
      },
    ];

    const merged = mergeEnrichedContacts(discovered, enrichedPass, {
      verify: true,
      now: new Date('2026-11-25T09:00:00.000Z'),
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      name: 'Elena Kovács',
      firstName: 'Elena',
      lastName: 'Kovács',
      email: 'elena@ferencvaros.example.hu',
      phone: '+36305551234',
      linkedin: 'https://www.linkedin.com/in/elena-kovacs',
      department: 'Sales',
      buyingRole: 'decision_maker',
      isDecisionMaker: true,
      lastVerifiedAt: '2026-11-25T09:00:00.000Z',
    });
  });

  it('records and reads unattended discovery & enrichment run telemetry and operating intervals', async () => {
    const store: Record<string, any>[] = [];
    const mockDb: any = {
      collection: () => ({
        updateOne: vi.fn(async (filter: any, update: any) => {
          const idx = store.findIndex(
            (d) =>
              d.brand === filter.brand &&
              d.tenantId === filter.tenantId &&
              d.operation === filter.operation
          );
          if (idx === -1) {
            const doc: Record<string, any> = {
              ...(update.$setOnInsert || {}),
              ...(update.$set || {}),
            };
            if (update.$inc) {
              for (const [k, v] of Object.entries(update.$inc)) doc[k] = Number(v);
            }
            store.push(doc);
          } else {
            Object.assign(store[idx], update.$set || {});
            if (update.$inc) {
              for (const [k, v] of Object.entries(update.$inc)) {
                store[idx][k] = (store[idx][k] || 0) + Number(v);
              }
            }
          }
        }),
        find: vi.fn((query: any) => ({
          toArray: async () => store.filter((d) => d.brand === query.brand),
        })),
      }),
    };

    const runTime = new Date('2026-11-25T10:30:00.000Z');
    await recordResearchTelemetryRun(mockDb, {
      brand: 'seyu',
      tenantId: 'seyu',
      operation: 'discovery',
      status: 'succeeded',
      leadId: 'lead-101',
      entityName: 'Valencia Basket',
      intervalMinutes: 45,
      now: runTime,
    });
    await recordResearchTelemetryRun(mockDb, {
      brand: 'seyu',
      tenantId: 'seyu',
      operation: 'enrichment',
      status: 'succeeded',
      leadId: 'lead-101',
      entityName: 'Valencia Basket',
      intervalMinutes: 20,
      now: new Date('2026-11-25T10:50:00.000Z'),
    });

    const telemetry = await getWorkspaceResearchTelemetry(mockDb, 'seyu', 'seyu');
    expect(telemetry.discovery.lastRunStatus).toBe('succeeded');
    expect(telemetry.discovery.intervalMinutes).toBe(45);
    expect(telemetry.discovery.lastEntityName).toBe('Valencia Basket');
    expect(telemetry.enrichment.lastRunStatus).toBe('succeeded');
    expect(telemetry.enrichment.intervalMinutes).toBe(20);

    expect(
      resolveLeadLastResearchedAt({
        source: 'discovery-cron',
        lastResearchedAt: '2026-11-25T10:50:00.000Z',
      })
    ).toBe('2026-11-25T10:50:00.000Z');
  });
});

describe('Apollo-to-Haho entitlement verification & capture mapping (issue 359 / backlog 12)', () => {
  it('distinguishes saved-contacts-only plan entitlement from full global prospect search', async () => {
    const mockFetch = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/auth/health')) {
        return new Response(JSON.stringify({ healthy: true, is_logged_in: true }), { status: 200 });
      }
      if (u.endsWith('/contacts/search')) {
        return new Response(JSON.stringify({ contacts: [], pagination: { total_entries: 0 } }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ error: 'api/v1/mixed_people/search is not accessible with this api_key' }),
        { status: 403 }
      );
    }) as unknown as typeof fetch;

    const check = await checkApolloEntitlements('apollo-test-key', mockFetch);
    expect(check.healthy).toBe(true);
    expect(check.savedContactsAllowed).toBe(true);
    expect(check.globalSearchAllowed).toBe(false);
    expect(check.goDecision).toBe('go_saved_contacts_only');
  });

  it('maps an Apollo person record to Lead + Contact with source: apollo and identifies missing fields', async () => {
    const person = {
      id: 'apollo-p-1',
      first_name: 'Marcus',
      last_name: 'Lindqvist',
      title: 'Head of Sponsorships',
      departments: ['Sales'],
      email: 'marcus@nordicsport.se',
      linkedin_url: 'http://www.linkedin.com/in/marcus-lindqvist',
      country: 'Sweden',
      organization: {
        name: 'Nordic Sport Arena',
        website_url: 'https://nordicsport.se',
        linkedin_url: 'https://www.linkedin.com/company/nordic-sport-arena',
        industry: 'Spectator Sports',
      },
    };

    const mapped = mapApolloPersonToLead(person);
    expect(mapped.firstName).toBe('Marcus');
    expect(mapped.lastName).toBe('Lindqvist');
    expect(mapped.country).toBe('SE');
    expect(mapped.department).toBe('Sales');
    expect(mapped.leadPayload.source).toBe('apollo');
    expect(mapped.leadPayload.companyLinkedin).toBe('https://www.linkedin.com/company/nordic-sport-arena');
    // Phone and companyPhone were omitted on the fixture -> explicitly surfaced as missing
    expect(mapped.missingFields).toContain('phone');
    expect(mapped.missingFields).toContain('companyPhone');

    const mockSearchFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          contacts: [person],
          pagination: { page: 1, per_page: 25, total_entries: 1, total_pages: 1 },
        }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;

    const searchRes = await searchApolloContacts(
      'apollo-test-key',
      { mode: 'saved_contacts', query: 'Marcus' },
      mockSearchFetch
    );
    expect(searchRes.ok).toBe(true);
    expect(searchRes.candidates).toHaveLength(1);
    expect(searchRes.candidates[0].leadPayload.source).toBe('apollo');
  });

  it('auto-detects and parses Apollo CSV exports with source: apollo and all outreach fields', () => {
    const csv = [
      'First Name,Last Name,Title,Company,Email,Work Direct Phone,Corporate Phone,Person Linkedin Url,Company Linkedin Url,Website,Industry,Departments,Country',
      'Hannah,Meyer,Brand Partnerships Director,Rhein Arena GmbH,hannah@rheinarena.de,+49 221 555 100,+49 221 555 000,https://www.linkedin.com/in/hannah-meyer,https://www.linkedin.com/company/rhein-arena,rheinarena.de,Sports,Marketing,Germany',
    ].join('\n');

    expect(detectCrmPreset(csv.split('\n')[0].split(','))).toBe('apollo');
    const parsed = parseCrmImport(csv);
    expect(parsed.preset).toBe('apollo');
    expect(parsed.validLeads).toHaveLength(1);
    const lead = parsed.validLeads[0];
    expect(lead.source).toBe('apollo');
    expect(lead.country).toBe('DE');
    expect(lead.url).toBe('https://rheinarena.de');
    expect(lead.companyLinkedin).toBe('https://www.linkedin.com/company/rhein-arena');
    expect(lead.companyPhone).toBe('+49 221 555 000');
    expect(lead.contacts?.[0]).toMatchObject({
      name: 'Hannah Meyer',
      firstName: 'Hannah',
      lastName: 'Meyer',
      country: 'DE',
      departmentOverride: 'Marketing',
      email: 'hannah@rheinarena.de',
      linkedin: 'https://www.linkedin.com/in/hannah-meyer',
    });
  });
});
