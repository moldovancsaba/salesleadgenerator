import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { parseVCardString } from '@/lib/hostess-scan';
import { buildFingerprint } from '@/lib/fingerprint';
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes } from '@/app/lib/activity-log-store';
import { executeLeadAction } from '@/app/lib/lead-actions';

export const dynamic = 'force-dynamic';

export const DEFAULT_HOSTESS_PASSWORD = 'iamthevegashostess2026';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ brand: string; campaign: string }> }
) {
  try {
    const { brand: brandParam, campaign: campaignParam } = await params;
    const brand = await resolveBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    const config = await getBrandConfig(brand);
    if (!config) {
      return NextResponse.json({ error: 'Brand configuration not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const { password, qrContent, hostessNote } = body;

    const expectedPassword = process.env.HOSTESS_SCAN_PASSWORD || DEFAULT_HOSTESS_PASSWORD;
    if (!password || password !== expectedPassword) {
      return NextResponse.json({ error: 'Invalid hostess password' }, { status: 401 });
    }

    if (!qrContent || typeof qrContent !== 'string' || !qrContent.trim()) {
      return NextResponse.json({ error: 'Missing QR code content' }, { status: 400 });
    }

    const parsed = parseVCardString(qrContent);
    const email = parsed.email?.trim().toLowerCase();
    const phone = parsed.phone?.trim();
    const name = parsed.name?.trim() || 'Event Attendee';

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database unavailable' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db();
    const tenantId = 'default';
    const collection = db.collection(config.dbCollection);

    const now = new Date();
    const nowIso = now.toISOString();

    // 1. Search for existing lead by email, phone, or contact name
    const queryConditions: any[] = [];
    if (email) {
      queryConditions.push({ contactEmails: email });
      queryConditions.push({ 'contacts.email': email });
      queryConditions.push({ general_contact: email });
    }
    if (phone) {
      queryConditions.push({ 'contacts.phone': phone });
    }
    if (name && name !== 'Event Attendee' && name !== 'Guest') {
      queryConditions.push({ 'contacts.name': name });
      queryConditions.push({ entity_name: name });
    }

    let existingLead: any = null;
    if (queryConditions.length > 0) {
      existingLead = await collection.findOne({
        $and: [
          { $or: [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: 'default' }] },
          { $or: queryConditions },
        ],
      });
    }

    const hostessTimestamp = `[Hostess Scanned ${nowIso.replace('T', ' ').slice(0, 19)}] Accepted card at event.`;
    const fullHostessNote = hostessNote ? `${hostessTimestamp} Note: ${hostessNote}` : hostessTimestamp;

    let leadRecord: any = null;

    if (existingLead) {
      const currentTags: string[] = Array.isArray(existingLead.tags) ? existingLead.tags : [];
      const updatedTags = Array.from(new Set([...currentTags, 'hostess-contacted', 'card-accepted']));

      const currentNotes = typeof existingLead.notes === 'string' ? existingLead.notes : '';
      const updatedNotes = currentNotes ? `${currentNotes}\n${fullHostessNote}` : fullHostessNote;

      // Update lead properties & tags
      await collection.updateOne(
        { _id: existingLead._id },
        {
          $set: {
            tags: updatedTags,
            notes: updatedNotes,
            hostessContacted: true,
            hostessContactedAt: nowIso,
            updatedAt: now,
          },
        }
      );

      // Advance lead to ENGAGED column via executeLeadAction to ensure outcomelogs and hooks fire
      const actionResult = await executeLeadAction({
        brand,
        tenantId,
        leadId: String(existingLead._id),
        action: 'COLUMN_MOVE',
        payload: { kanbanColumn: 'ENGAGED', sortOrder: Date.now() },
        actorId: 'hostess-app',
        actorEmail: 'hostess@sales.haho.ai',
      });

      leadRecord = actionResult.lead || (await collection.findOne({ _id: existingLead._id }));
    } else {
      // Create new lead directly in ENGAGED column
      const fingerprint = buildFingerprint(name, email ? `https://${email.split('@')[1]}` : 'https://event.local', 'UK');
      const count = await collection.countDocuments({ kanbanColumn: 'ENGAGED', tenantId });

      const newLead = {
        id: now.getTime(),
        tenantId,
        region: 'UK',
        country: 'GB',
        entity_name: name,
        url: email ? `https://${email.split('@')[1]}` : 'https://mrvegas.event',
        contacts: [
          {
            name,
            title: parsed.title || 'Event Attendee',
            email: email || '',
            ...(phone ? { phone } : {}),
            isDecisionMaker: true,
            buyingRole: 'champion',
            lastVerifiedAt: nowIso,
          },
        ],
        contactEmails: email ? [email] : [],
        address: parsed.address || '',
        cityName: '',
        general_contact: email || '',
        size: 'Small',
        industry: `Campaign: ${campaignParam}`,
        sport_or_sector: 'Darts & Sports Entertainment',
        level_league: '',
        pros: ['Scanned and engaged by hostess at event'],
        cons: [],
        value_proposition: `Attended ${campaignParam} event. Handed contact card to hostess.`,
        recommended_tier: '',
        estimated_participants: 0,
        estimated_annual_revenue_usd: 0,
        revenue_model: '',
        product_fit_notes: `Scanned on-site during ${campaignParam}`,
        pricingByCompany: {},
        status: 'new',
        kanbanColumn: 'ENGAGED',
        sortOrder: count * 100,
        fingerprint,
        notes: fullHostessNote,
        tags: [campaignParam, 'hostess-contacted', 'card-accepted'],
        deals: [],
        checklist: [],
        source: `hostess_scan_${campaignParam}`,
        campaign: campaignParam,
        hostessContacted: true,
        hostessContactedAt: nowIso,
        createdAt: now,
        updatedAt: now,
      };

      const insertResult = await collection.insertOne(newLead);
      leadRecord = { ...newLead, _id: insertResult.insertedId };
    }

    // Record activity audit log
    try {
      await ensureActivityLogIndexes(db);
      await db.collection(ACTIVITY_LOG_COLLECTION).insertOne({
        brand,
        tenantId,
        leadId: String(leadRecord._id),
        actorId: 'hostess-app',
        actorEmail: 'hostess@sales.haho.ai',
        action: 'HOSTESS_CARD_ACCEPTED',
        details: {
          campaign: campaignParam,
          attendeeName: name,
          attendeeEmail: email,
          attendeePhone: phone,
          movedTo: 'ENGAGED',
        },
        timestamp: now,
      });
    } catch {
      // Non-fatal
    }

    return NextResponse.json({
      success: true,
      message: `Attendee ${name} accepted and moved to ENGAGED.`,
      lead: {
        id: leadRecord._id,
        name,
        email,
        phone,
        kanbanColumn: 'ENGAGED',
        tags: leadRecord.tags,
      },
    });
  } catch (err: any) {
    console.error('[Hostess Scan API Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to process hostess scan' }, { status: 500 });
  }
}
