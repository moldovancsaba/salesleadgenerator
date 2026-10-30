import { NextRequest, NextResponse } from 'next/server';
import { getClientPromise, isMongoConfigured } from '@/lib/mongodb';
import { mapListingToPadelLead, type PadelListing } from '@/lib/padel-listings-sync';

const WEBHOOK_SECRET = process.env.MANAGEMENT_WEBHOOK_SECRET || process.env.SLG_API_KEY || '';

/**
 * Incoming Webhook from `management` engine (Issue #302).
 * Fired whenever a listing is published, updated, or modified in Padel Africa.
 * Expected payload:
 * {
 *   event: 'listing.published' | 'listing.updated' | 'listing.quarantined',
 *   vertical: 'padel-africa',
 *   listing: PadelListing
 * }
 */
export async function POST(req: NextRequest) {
  // Signature / Key verification
  const authHeader = req.headers.get('authorization') || '';
  const apiKey = req.headers.get('x-api-key') || '';

  if (WEBHOOK_SECRET) {
    const isBearerValid = authHeader === `Bearer ${WEBHOOK_SECRET}`;
    const isKeyValid = apiKey === WEBHOOK_SECRET;
    if (!isBearerValid && !isKeyValid) {
      return NextResponse.json({ error: 'Unauthorized webhook request' }, { status: 401 });
    }
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
  }

  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.listing || !body.listing.id) {
      return NextResponse.json({ error: 'Invalid payload: missing listing.id' }, { status: 400 });
    }

    const { event, vertical, listing } = body as {
      event?: string;
      vertical?: string;
      listing: PadelListing;
    };

    if (vertical && vertical !== 'padel-africa') {
      return NextResponse.json({ ok: true, ignored: true, reason: `Ignored vertical: ${vertical}` });
    }

    const client = await getClientPromise();
    const db = client.db();
    const leadsColl = db.collection('padel_africa_leads');

    const listingId = listing.id;
    const existing = await leadsColl.findOne({ 'externalSource.listingId': listingId });

    if (event === 'listing.quarantined' || listing.lifecycleState === 'QUARANTINED') {
      if (existing) {
        await leadsColl.updateOne(
          { _id: existing._id },
          { $set: { kanbanColumn: 'BACKLOG', notes: `${existing.notes || ''}\n[Listing quarantined in management engine]` } }
        );
      }
      return NextResponse.json({ ok: true, action: 'quarantined', listingId });
    }

    // Map listing
    const maxDoc = await leadsColl.find().sort({ id: -1 }).limit(1).toArray();
    const nextId = (maxDoc[0]?.id || 0) + 1;
    const leadData = mapListingToPadelLead(listing, { nextId });

    if (!existing) {
      await leadsColl.insertOne({
        ...leadData,
        id: nextId,
        createdAt: new Date().toISOString(),
      });
      return NextResponse.json({ ok: true, action: 'inserted', listingId });
    } else {
      await leadsColl.updateOne(
        { _id: existing._id },
        {
          $set: {
            entity_name: leadData.entity_name,
            url: leadData.url,
            address: leadData.address,
            country: leadData.country,
            region: leadData.region,
            general_contact: leadData.general_contact,
            contact_phone: leadData.contact_phone,
            sportCode: leadData.sportCode,
            value_proposition: leadData.value_proposition,
            ticketSizeEstimate: leadData.ticketSizeEstimate,
            'externalSource.verifiedAt': listing.verifiedAt,
            'externalSource.publishedAt': listing.publishedAt,
            updatedAt: new Date().toISOString(),
          },
        }
      );
      return NextResponse.json({ ok: true, action: 'updated', listingId });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Webhook processing failed' }, { status: 500 });
  }
}
