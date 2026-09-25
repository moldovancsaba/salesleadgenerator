import { NextResponse, type NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import clientPromise, { isMongoConfigured } from '../../../../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../../../../lib/require-brand-access-api';
import { resolveBrand, getBrandConfig } from '../../../../../lib/brand';
import { getTenantId, tenantFilter } from '../../../../../../lib/tenant';
import { normalizeContact, dedupeContacts, contactKey } from '../../../../../../lib/contacts';
import { getGoogleContact } from '../../../../../lib/google-contacts-store';
import { executeLeadAction } from '../../../../../lib/lead-actions';

// Issue #216 Algorithm B — a rep-initiated, one-way (Google -> this app)
// contact import. Idempotent: re-posting the same resourceName for the
// same lead after it was already added returns 'already-exists', never a
// duplicate write.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { searchParams } = new URL(request.url);
  const brand = await resolveBrand(searchParams.get('brand') || undefined);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  const authResponse = await requireBrandAccessApi(request, brand);
  if (authResponse) return authResponse;

  const body = await request.json().catch(() => ({}));
  const resourceName = typeof body.resourceName === 'string' ? body.resourceName.trim() : '';
  if (!resourceName) return NextResponse.json({ error: 'resourceName is required' }, { status: 400 });

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  if (!ObjectId.isValid(id)) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  const tenantId = getTenantId(request);
  const config = (await getBrandConfig(brand))!;
  const client = await clientPromise;
  const db = client.db();

  const existingLead = await db.collection(config.dbCollection).findOne(
    { _id: new ObjectId(id), ...tenantFilter(tenantId) },
    { projection: { contacts: 1 } }
  );
  if (!existingLead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

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

  const existingContacts = dedupeContacts(existingLead.contacts || []);
  const alreadyExists = existingContacts.find((c) => contactKey(c) === key);
  if (alreadyExists) {
    return NextResponse.json({ status: 'already-exists', contact: alreadyExists });
  }

  const mergedContacts = [...existingContacts, candidate];
  const result = await executeLeadAction({
    brand, tenantId, leadId: id, action: 'MODIFY', payload: { contacts: mergedContacts },
  });
  if (!result.success) {
    return NextResponse.json({ error: result.error || 'Failed to import contact' }, { status: result.status || 400 });
  }

  return NextResponse.json({ status: 'added', contact: candidate });
}

export const dynamic = 'force-dynamic';
