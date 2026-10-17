import { NextResponse, type NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { resolveBrand, getBrandConfig } from '../../../lib/brand';
import { getTenantId, tenantFilter } from '../../../../lib/tenant';
import { normalizeContact, dedupeContacts, contactKey, deriveContactEmails } from '../../../../lib/contacts';
import { getGoogleContact } from '../../../lib/google-contacts-store';
import { executeLeadAction } from '../../../lib/lead-actions';
import { buildFingerprint } from '../../../../lib/fingerprint';
import { escapeRegExp } from '../../../lib/search/tagged-content-filter';
import { computeTicketSizeForLead } from '../../../lib/ticket-size-store';

// Issue 251 — workspace-level Google Contacts import endpoint.
// Can import into an existing lead (if leadId passed or company name matched),
// or create a new lead in DISCOVERED stage with this contact.
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const brand = await resolveBrand(searchParams.get('brand') || undefined);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  const authResponse = await requireBrandAccessApi(request, brand);
  if (authResponse) return authResponse;

  const body = await request.json().catch(() => ({}));
  const resourceName = typeof body.resourceName === 'string' ? body.resourceName.trim() : '';
  if (!resourceName) return NextResponse.json({ error: 'resourceName is required' }, { status: 400 });

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const tenantId = getTenantId(request);
  const config = (await getBrandConfig(brand))!;
  const client = await clientPromise;
  const db = client.db();

  const contactResult = await getGoogleContact(db, brand, tenantId, resourceName);
  if (!contactResult.ok) return NextResponse.json({ error: contactResult.error }, { status: contactResult.status });

  const candidate = normalizeContact({
    name: contactResult.contact!.name,
    title: contactResult.contact!.organization,
    email: contactResult.contact!.email,
    phone: contactResult.contact!.phone,
  });
  const key = contactKey(candidate);
  if (!key) return NextResponse.json({ error: 'Contact needs at least a name' }, { status: 400 });

  const leadId = typeof body.leadId === 'string' && body.leadId.trim() ? body.leadId.trim() : undefined;
  const customEntityName = typeof body.entityName === 'string' && body.entityName.trim() ? body.entityName.trim() : undefined;

  let targetLead: any = null;

  if (leadId) {
    if (!ObjectId.isValid(leadId)) return NextResponse.json({ error: 'Invalid leadId' }, { status: 400 });
    targetLead = await db.collection(config.dbCollection).findOne({
      _id: new ObjectId(leadId),
      ...tenantFilter(tenantId),
    });
    if (!targetLead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
  } else {
    // If no leadId is provided, try to match by company name / organization or customEntityName
    const entityNameCandidate = customEntityName || contactResult.contact!.organization;
    if (entityNameCandidate) {
      targetLead = await db.collection(config.dbCollection).findOne({
        entity_name: { $regex: new RegExp(`^${escapeRegExp(entityNameCandidate)}$`, 'i') },
        ...tenantFilter(tenantId),
      });
    }
  }

  // If an existing lead was targeted or matched by organization name:
  if (targetLead) {
    const existingContacts = dedupeContacts(targetLead.contacts || []);
    const alreadyExists = existingContacts.find((c) => contactKey(c) === key);
    if (alreadyExists) {
      return NextResponse.json({
        status: 'already-exists',
        contact: alreadyExists,
        leadId: targetLead._id.toString(),
        leadName: targetLead.entity_name,
      });
    }

    const mergedContacts = [...existingContacts, candidate];
    const result = await executeLeadAction({
      brand,
      tenantId,
      leadId: targetLead._id.toString(),
      action: 'MODIFY',
      payload: { contacts: mergedContacts },
    });
    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Failed to import contact' }, { status: result.status || 400 });
    }

    return NextResponse.json({
      status: 'added',
      contact: candidate,
      leadId: targetLead._id.toString(),
      leadName: targetLead.entity_name,
      matched: !leadId,
    });
  }

  // Otherwise, create a new lead in DISCOVERED with this contact
  const entityName = customEntityName || contactResult.contact!.organization || `${contactResult.contact!.name} (Lead)`;
  const fingerprint = buildFingerprint(entityName, '', 'US');

  const ticketSizeEstimate = await computeTicketSizeForLead(db, brand, tenantId, {
    region: 'US',
  });

  const count = await db.collection(config.dbCollection).countDocuments({ kanbanColumn: 'DISCOVERED', tenantId });

  const newLead = {
    id: Date.now(),
    entity_name: entityName,
    region: 'US',
    country: 'United States',
    url: '',
    contacts: [candidate],
    contactEmails: deriveContactEmails([candidate]),
    address: '',
    general_contact: candidate.email || candidate.phone || '',
    size: '',
    industry: '',
    sport_or_sector: '',
    level_league: '',
    value_proposition: '',
    recommended_tier: '',
    estimated_participants: 0,
    estimated_annual_revenue_usd: 0,
    revenue_model: '',
    product_fit_notes: 'Created via Google Contacts workspace import',
    pricingByCompany: {},
    ticketSizeEstimate,
    status: 'new',
    notes: 'Imported from Google Contacts',
    tags: ['google-contacts-import'],
    deals: [],
    checklist: [],
    source: 'google-contacts',
    fieldVerifications: [],
    kanbanColumn: 'DISCOVERED',
    sortOrder: count * 100,
    fingerprint,
    tenantId,
    ice: { impact: 5, confidence: 5, ease: 5 },
    scoreProfile: { qualityScore: 50, reasons: ['Imported from Google Contacts'] },
    normalizationWarnings: [],
    feedbackScore: 0,
    declineCount: 0,
    acceptanceCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const insertResult = await db.collection(config.dbCollection).insertOne(newLead);

  await db.collection('outcomelogs').insertOne({
    leadId: insertResult.insertedId.toString(),
    action: 'CREATE',
    outcomeType: 'CREATE',
    outcomeValue: 'Created DISCOVERED (Google Contacts)',
    actorType: 'USER',
    actedBy: 'webapp-user',
    beforeState: {},
    afterState: { entity_name: newLead.entity_name },
    tenantId,
    timestamp: new Date(),
  });

  return NextResponse.json({
    status: 'created',
    contact: candidate,
    leadId: insertResult.insertedId.toString(),
    leadName: newLead.entity_name,
  });
}

export const dynamic = 'force-dynamic';
