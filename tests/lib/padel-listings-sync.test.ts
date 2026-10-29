import { describe, it, expect } from 'vitest';
import { mapListingToPadelLead, type PadelListing } from '../../lib/padel-listings-sync';
import { validateLeadPayload } from '../../lib/validate-lead';
import { getForbiddenTermsFor } from '../../app/lib/brand';

describe('padel-listings-sync', () => {
  const sampleListing: PadelListing = {
    id: 'l-openclaw-clan7-clan7.club',
    name: 'Clan 7',
    description: 'Accra’s first social leisure club integrating padel, community and holistic wellness.',
    website: 'https://www.thevicompany.com/',
    phone: '+233200000000',
    activityTypes: ['padel-club'],
    lifecycleState: 'PUBLISHED',
    venue: {
      name: 'Clan 7',
      address: {
        line1: 'Clan 7, Accra, Ghana',
        locality: 'Accra',
        region: 'Korle-Klottey Municipal District',
        countryCode: 'GH',
      },
      geo: {
        position: {
          lat: 5.5571096,
          lng: -0.2012376,
        },
      },
    },
    source: {
      sourceName: 'live_discovery',
      sourceUrl: 'https://www.clan7.club/',
      ingestedAt: '2026-10-17T06:58:07.557Z',
    },
    verifiedAt: '2026-10-17T07:03:38.953Z',
    publishedAt: '2026-10-21T02:36:09.111Z',
  };

  it('maps a published directory listing to a compliant SLG lead', () => {
    const lead = mapListingToPadelLead(sampleListing, { nextId: 101 });
    expect(lead.id).toBe(101);
    expect(lead.entity_name).toBe('Clan 7');
    expect(lead.url).toBe('https://www.thevicompany.com/');
    expect(lead.country).toBe('GH');
    expect(lead.region).toBe('Korle-Klottey Municipal District');
    expect(lead.sportCode).toBe('padel');
    expect(lead.sport_or_sector).toBe('Padel Tennis');
    expect(lead.industry).toBe('Sports & Padel Club Operations');
    expect(lead.kanbanColumn).toBe('DISCOVERED');
    expect(lead.externalSource.listingId).toBe('l-openclaw-clan7-clan7.club');
    expect(lead.contacts).toHaveLength(1);
    expect(lead.contacts[0].phone).toBe('+233200000000');
    expect(lead.contacts[0].isDecisionMaker).toBe(true);
    expect(lead.ice.impact).toBeGreaterThanOrEqual(1);
    expect(lead.ice.impact).toBeLessThanOrEqual(10);
    expect(lead.iceScore).toBe(lead.ice.impact * lead.ice.confidence * lead.ice.ease);
    expect(lead.ticketSizeEstimate.currency).toBe('EUR');
  });

  it('generates compliant fallback URL when listing website is absent', () => {
    const listingWithoutUrl: PadelListing = {
      ...sampleListing,
      website: null,
      source: undefined,
    };
    const lead = mapListingToPadelLead(listingWithoutUrl);
    expect(lead.url).toBe('https://padel-africa.doneisbetter.com/listing/l-openclaw-clan7-clan7.club');
  });

  it('passes SLG lead validation rules without forbidden terms for padel-africa', async () => {
    const lead = mapListingToPadelLead(sampleListing, { nextId: 1 });
    const forbiddenTerms = await getForbiddenTermsFor('padel-africa');
    const validation = validateLeadPayload(lead, 'padel-africa', forbiddenTerms);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toHaveLength(0);
  });
});
