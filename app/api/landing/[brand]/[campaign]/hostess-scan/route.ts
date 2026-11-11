import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { parseVCardString, isAttendeeBadge, checkInAdvancesColumn } from '@/lib/hostess-scan';
import {
  accessCodeLockedOut,
  accessCodeMatches,
  clearAccessCodeFailures,
  recordAccessCodeFailure,
  scannerAccessCode,
} from '@/lib/hostess-scan-server';
import { normalizeScannerConfig } from '@/lib/landing-page-schema';
import { getLandingPageBySlug } from '@/lib/landing-page-store';
import { inferIsoCountryFromUrlOrEmail, inferRegionFromCountry, normalizeWebsiteUrl } from '@/lib/inbound-lead-form';
import { buildFingerprint } from '@/lib/fingerprint';
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes } from '@/app/lib/activity-log-store';
import { executeLeadAction } from '@/app/lib/lead-actions';

export const dynamic = 'force-dynamic';

/**
 * Check-in scan for any landing page that has its scanner turned on.
 * The page's scanner config decides everything that differs between campaigns: the access code, the column a
 * scan moves the lead to, the tags added, whether a walk-in creates a lead, and the result screen's wording.
 */
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

    const page = await getLandingPageBySlug(brand, campaignParam);
    const scanner = page?.scanner ? normalizeScannerConfig(page.scanner) : null;
    if (!page || !scanner?.enabled) {
      return NextResponse.json(
        { error: 'The check-in scanner is not turned on for this page', code: 'SCANNER_DISABLED' },
        { status: 404 }
      );
    }

    const expectedCode = scannerAccessCode(scanner.accessCode);
    if (!expectedCode) {
      return NextResponse.json(
        { error: 'No access code is set for this scanner', code: 'ACCESS_CODE_NOT_SET' },
        { status: 503 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { password, qrContent, hostessNote, verifyOnly } = body;

    const caller = (request.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim();
    const attemptKey = `${brand}:${campaignParam}:${caller}`;
    if (accessCodeLockedOut(attemptKey)) {
      return NextResponse.json(
        { error: 'Too many wrong codes. Wait a few minutes and try again.', code: 'TOO_MANY_ATTEMPTS' },
        { status: 429 }
      );
    }
    if (!accessCodeMatches(expectedCode, password)) {
      recordAccessCodeFailure(attemptKey);
      return NextResponse.json({ error: 'Invalid access code' }, { status: 401 });
    }
    clearAccessCodeFailures(attemptKey);

    if (verifyOnly === true) {
      return NextResponse.json({ ok: true });
    }

    if (!qrContent || typeof qrContent !== 'string' || !qrContent.trim()) {
      return NextResponse.json({ error: 'Missing QR code content' }, { status: 400 });
    }

    const parsed = parseVCardString(qrContent);
    const email = parsed.email?.trim().toLowerCase();
    const phone = parsed.phone?.trim();
    const name = parsed.name?.trim() || 'Event Attendee';

    if (!isAttendeeBadge(parsed)) {
      return NextResponse.json({ error: 'This QR code is not an attendee badge', code: 'NOT_AN_ATTENDEE_BADGE' }, { status: 422 });
    }

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

    if (!existingLead && !scanner.createUnknownLeads) {
      return NextResponse.json(
        { error: 'No attendee matches this badge', code: 'ATTENDEE_NOT_FOUND' },
        { status: 404 }
      );
    }

    const checkInTimestamp = `[Check-in ${nowIso.replace('T', ' ').slice(0, 19)}] Scanned at ${campaignParam}.`;
    const fullNote = hostessNote ? `${checkInTimestamp} Note: ${hostessNote}` : checkInTimestamp;

    let leadRecord: any = null;
    const alreadyCheckedIn = Boolean(existingLead?.hostessContacted);
    let movedTo: string = scanner.targetColumn;

    if (existingLead) {
      const currentTags: string[] = Array.isArray(existingLead.tags) ? existingLead.tags : [];
      const updatedTags = Array.from(new Set([...currentTags, ...scanner.tags]));

      const currentNotes = typeof existingLead.notes === 'string' ? existingLead.notes : '';
      const updatedNotes = currentNotes ? `${currentNotes}\n${fullNote}` : fullNote;

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

      // Move forward through executeLeadAction so outcome logs and hooks fire; a lead already further along stays put.
      if (checkInAdvancesColumn(existingLead.kanbanColumn, scanner.targetColumn)) {
        const actionResult = await executeLeadAction({
          brand,
          tenantId,
          leadId: String(existingLead._id),
          action: 'COLUMN_MOVE',
          payload: { kanbanColumn: scanner.targetColumn, sortOrder: Date.now() },
          actorId: 'hostess-app',
          actorEmail: 'hostess@sales.haho.ai',
        });
        leadRecord = actionResult.lead || (await collection.findOne({ _id: existingLead._id })) || existingLead;
      } else {
        movedTo = existingLead.kanbanColumn;
        leadRecord = (await collection.findOne({ _id: existingLead._id })) || existingLead;
      }
    } else {
      // Walk-in: create the lead directly in the page's target column
      const url = normalizeWebsiteUrl('', email || '');
      const country = inferIsoCountryFromUrlOrEmail(url, email || '', '');
      const fingerprint = buildFingerprint(name, url, country);
      const count = await collection.countDocuments({ kanbanColumn: scanner.targetColumn, tenantId });

      const newLead = {
        id: now.getTime(),
        tenantId,
        region: inferRegionFromCountry(country),
        country,
        entity_name: name,
        url,
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
        sport_or_sector: '',
        level_league: '',
        pros: [`Checked in at ${campaignParam}`],
        cons: [],
        value_proposition: `Checked in at ${campaignParam}.`,
        recommended_tier: '',
        estimated_participants: 0,
        estimated_annual_revenue_usd: 0,
        revenue_model: '',
        product_fit_notes: `Scanned on site at ${campaignParam}`,
        pricingByCompany: {},
        status: 'new',
        kanbanColumn: scanner.targetColumn,
        sortOrder: count * 100,
        fingerprint,
        notes: fullNote,
        tags: Array.from(new Set([campaignParam, ...scanner.tags])),
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
          movedTo,
        },
        timestamp: now,
      });
    } catch {
      // Non-fatal
    }

    return NextResponse.json({
      success: true,
      message: `Attendee ${name} checked in (${movedTo}).`,
      alreadyCheckedIn,
      movedTo,
      lead: {
        id: leadRecord._id,
        name,
        email,
        phone,
        kanbanColumn: movedTo,
        tags: leadRecord.tags,
      },
    });
  } catch (err: any) {
    console.error('[Hostess Scan API Error]:', err);
    return NextResponse.json({ error: err.message || 'Failed to process the scan' }, { status: 500 });
  }
}
