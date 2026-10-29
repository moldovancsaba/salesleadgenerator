import { buildFingerprint } from './fingerprint';

export interface PadelListingVenueAddress {
  line1?: string;
  locality?: string;
  region?: string;
  countryCode?: string;
  territory?: {
    continent?: string;
    country?: string;
    region?: string;
    settlement?: string;
  };
}

export interface PadelListingVenue {
  name?: string;
  address?: PadelListingVenueAddress;
  geo?: {
    position?: {
      lat: number;
      lng: number;
    };
    precision?: string;
  };
}

export interface PadelListingSource {
  sourceName?: string;
  sourceUrl?: string;
  ingestedAt?: string;
}

export interface PadelListing {
  _id?: string;
  id: string;
  name: string;
  description?: string;
  website?: string | null;
  phone?: string | null;
  activityTypes?: string[];
  topActivityTypes?: string[];
  lifecycleState?: string;
  venue?: PadelListingVenue;
  source?: PadelListingSource;
  createdAt?: string;
  updatedAt?: string;
  verifiedAt?: string;
  publishedAt?: string;
}

export interface LeadContact {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedin: string;
  role: string;
  isDecisionMaker: boolean;
}

export interface PadelLead {
  id?: number;
  entity_name: string;
  url: string;
  address: string;
  country: string;
  region: string;
  general_contact: string;
  contact_phone: string;
  industry: string;
  sport_or_sector: string;
  sportCode: string;
  level_league: string;
  size: string;
  value_proposition: string;
  kanbanColumn: string;
  qualityStatus: string;
  contacts: LeadContact[];
  notes: string;
  pro_for_organization: string[];
  con_for_organization: string[];
  ice: {
    impact: number;
    confidence: number;
    ease: number;
  };
  iceScore: number;
  fingerprint: string;
  sortOrder: number;
  ticketSizeEstimate: {
    low: number;
    expected: number;
    high: number;
    currency: 'EUR';
    method: string;
    confidence: 'low' | 'medium' | 'high';
    computedAt: string;
    sizeAssumed: boolean;
  };
  classificationTags: string[];
  externalSource: {
    source: 'padel-africa-directory';
    listingId: string;
    sourceName?: string;
    verifiedAt?: string;
    publishedAt?: string;
  };
  createdAt?: string;
  updatedAt: string;
}

/**
 * Maps a published Padel Africa directory listing to a Sales Lead Generator lead document.
 */
export function mapListingToPadelLead(listing: PadelListing, options?: { nextId?: number }): PadelLead {
  const entityName = (listing.name || '').trim();
  const venueAddress = listing.venue?.address;
  const country = (venueAddress?.countryCode || 'ZA').toUpperCase().trim();
  const locality = venueAddress?.locality?.trim() || '';
  const regionName = venueAddress?.region?.trim() || locality || 'Africa';

  // Address line construction
  const addressParts = [
    venueAddress?.line1,
    locality,
    venueAddress?.region,
    country,
  ].filter((p): p is string => Boolean(p && typeof p === 'string' && p.trim()));
  const address = addressParts.join(', ') || `${locality ? locality + ', ' : ''}${country}`;

  // Safe valid URL fallback
  let rawUrl = (listing.website || '').trim();
  if (!rawUrl || !rawUrl.startsWith('http')) {
    if (listing.source?.sourceUrl && listing.source.sourceUrl.startsWith('http')) {
      rawUrl = listing.source.sourceUrl.trim();
    } else {
      rawUrl = `https://padel-africa.doneisbetter.com/listing/${encodeURIComponent(listing.id)}`;
    }
  }

  const phone = (listing.phone || '').trim();
  const generalContact = phone ? `Phone: ${phone}` : 'Directory Listing';

  // Value proposition tailored to Padel Africa offerings
  const desc = (listing.description || '').trim();
  const valueProposition = desc
    ? `${desc} Padel Africa provides end-to-end court booking SaaS, tournament integration, pro shop wholesale supply, and turnkey panoramic court installation.`
    : `${entityName} is a premier padel venue in ${locality ? locality + ', ' : ''}${country}. Padel Africa provides turnkey club management SaaS, WhatsApp player bookings, tournament sanctioning, and equipment supply.`;

  // ICE Scoring based on listing fidelity
  let impact = 6;
  let confidence = 7;
  let ease = 6;

  if (listing.phone) {
    confidence += 1;
    ease += 1;
  }
  if (listing.website && listing.website.startsWith('http') && !listing.website.includes('instagram.com') && !listing.website.includes('facebook.com')) {
    impact += 1;
    confidence += 1;
  }
  if (listing.verifiedAt) {
    confidence += 1;
  }

  impact = Math.min(10, Math.max(1, impact));
  confidence = Math.min(10, Math.max(1, confidence));
  ease = Math.min(10, Math.max(1, ease));
  const iceScore = impact * confidence * ease;

  const now = new Date().toISOString();
  const fingerprint = buildFingerprint(entityName, rawUrl, country);

  const contacts: LeadContact[] = [];
  if (phone) {
    contacts.push({
      name: 'Club Operations / Management',
      title: 'Venue Manager',
      email: '',
      phone,
      linkedin: '',
      role: 'court_operator',
      isDecisionMaker: true,
    });
  }

  return {
    ...(options?.nextId ? { id: options.nextId } : {}),
    entity_name: entityName,
    url: rawUrl,
    address,
    country,
    region: regionName,
    general_contact: generalContact,
    contact_phone: phone,
    industry: 'Sports & Padel Club Operations',
    sport_or_sector: 'Padel Tennis',
    sportCode: 'padel',
    level_league: 'Club & Academy Circuit',
    size: 'Medium',
    value_proposition: valueProposition,
    kanbanColumn: 'DISCOVERED',
    qualityStatus: 'APPROVED',
    contacts,
    notes: `Ingested from Padel Africa Directory listing (${listing.id}). Source: ${listing.source?.sourceName || 'directory'}. Verified: ${listing.verifiedAt || 'N/A'}.`,
    pro_for_organization: [
      'Active padel facility with established local player base and court infrastructure.',
      'Potential customer for turnkey court expansion, club booking SaaS, and tournament circuits.',
      'Direct mobile phone or web booking presence facilitates immediate sales outreach.',
    ],
    con_for_organization: [
      'Independent venue operations may require owner or general manager sign-off for software transitions.',
      'Cross-border hardware shipments subject to local regional import duties.',
    ],
    ice: {
      impact,
      confidence,
      ease,
    },
    iceScore,
    fingerprint,
    sortOrder: iceScore,
    ticketSizeEstimate: {
      low: 5000,
      expected: 18000,
      high: 50000,
      currency: 'EUR',
      method: 'padel_venue_estimate',
      confidence: phone ? 'medium' : 'low',
      computedAt: now,
      sizeAssumed: true,
    },
    classificationTags: ['#sport:padel', `#country:${country.toLowerCase()}`],
    externalSource: {
      source: 'padel-africa-directory',
      listingId: listing.id,
      sourceName: listing.source?.sourceName,
      verifiedAt: listing.verifiedAt,
      publishedAt: listing.publishedAt,
    },
    createdAt: listing.createdAt || now,
    updatedAt: now,
  };
}
