import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../../lib/mongodb'
import { resolveBrand, getBrandConfig } from '../../../../lib/brand'
import type { Brand } from '../../../../lib/brand'
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api'
import { resolveSessionFromIdToken } from '../../../../../lib/session'
import { getTenantId, tenantFilter } from '../../../../../lib/tenant'
import { dedupeContacts, contactKey } from '../../../../../lib/contacts'
import {
  ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes, isValidCallDisposition, CALL_DISPOSITIONS,
  truncateBody, mapActivityLogDoc, mapOutreachLogToActivityEntry, mergeActivityTimeline,
  type ActivityLogDocument,
} from '../../../../lib/activity-log-store'

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || 'cogmap';
  return await resolveBrand(brandParam);
}

// Issue #140 — GET /api/leads/[id]/activity: the first genuinely unified
// per-lead activity read surface in this app. Merges the activityLog
// collection (written by issue #141's inbound-email webhook) with the
// pre-existing outreach_logs collection (app/api/outreach-logs/route.ts)
// for the same leadId, at read time. outcomelogs/checklist[]/notes are
// deliberately NOT part of this merge — see issue #140's own Non-Goals:
// each has its own real consumers this must not disturb.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = getTenantId(request);
    const { searchParams } = new URL(request.url);
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '100') || 100));
    const dealId = searchParams.get('dealId')?.trim() || null;
    const includeHistorical = searchParams.get('includeHistorical') === 'true';

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise();
    const db = client.db();
    await ensureActivityLogIndexes(db);

    const baseLeadFilter: Record<string, any> = { leadId: id };
    if (dealId) baseLeadFilter.dealId = dealId;

    // Issue #244: Filter out historical pre-lead correspondence by default unless requested
    const activityFilter: Record<string, any> = { ...baseLeadFilter };
    if (!includeHistorical) {
      activityFilter.isHistorical = { $ne: true };
    }

    const outreachFilter: Record<string, any> = { leadId: id, tenantId, activityLogWritten: { $ne: true } };
    if (dealId) outreachFilter.dealId = dealId;

    const [activityLogDocs, outreachLogDocs, historicalCount] = await Promise.all([
      db.collection(ACTIVITY_LOG_COLLECTION)
        .find(activityFilter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),
      // Issue #205 — a successful manual real-send (lib/outreach-send.ts's
      // sendManualEmail()) writes BOTH this row and its own activityLog
      // entry (source: 'manual'), so it can carry a real Resend
      // externalId/deliveryStatus the outreach_logs->email-outbound mapping
      // below has no field for. Excluding activityLogWritten:true rows here
      // prevents that one send from rendering twice in the merged timeline;
      // a cadence send (never activityLogWritten) and a plain "Log outreach"
      // record-only row (never sets this field at all) are both unaffected.
      db.collection('outreach_logs')
        .find(outreachFilter)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),
      db.collection(ACTIVITY_LOG_COLLECTION).countDocuments({
        ...baseLeadFilter,
        isHistorical: true,
      }),
    ]);

    const activity = mergeActivityTimeline(
      [
        activityLogDocs.map(mapActivityLogDoc),
        outreachLogDocs.map(mapOutreachLogToActivityEntry),
      ],
      limit
    );

    return NextResponse.json({
      activity,
      leadId: id,
      brand,
      tenantId,
      returned: activity.length,
      historicalCount,
    });
  } catch (error: any) {
    console.error('GET /api/leads/[id]/activity Error:', error)
    return NextResponse.json({ error: 'Failed to fetch activity' }, { status: 500 })
  }
}

// Issue #200 — the first manual write path into activityLog (every prior
// write is the inbound-email webhook, #141). Same auth/brand-resolution
// pattern as the sibling GET above; lives in the same file per this repo's
// own one-file-per-route, multiple-method-export convention (e.g.
// app/api/outreach-logs/route.ts).
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const body = await request.json().catch(() => ({} as any));
    const isNote = body.type === 'note';
    const isMessage = body.type === 'whatsapp' || body.type === 'imessage' || body.type === 'sms';

    const config = (await getBrandConfig(brand))!;
    const tenantId = getTenantId(request);
    const client = await getClientPromise();
    const db = client.db();

    const { ObjectId } = await import('mongodb');
    let lead: any = null;
    try {
      lead = await db.collection(config.dbCollection).findOne({ _id: new ObjectId(id), ...tenantFilter(tenantId) });
    } catch {
      lead = null;
    }
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const loggedBy = claims?.email;

    // Optional deal association (predecessor CRM roadmap §CRM line 20)
    const rawDealId = typeof body.dealId === 'string' ? body.dealId.trim() : '';
    let matchedDeal: any = null;
    if (rawDealId) {
      if (Array.isArray(lead.deals)) {
        matchedDeal = lead.deals.find((d: any) => d.id === rawDealId);
      }
      if (!matchedDeal) {
        return NextResponse.json({ error: 'Deal not found on this lead' }, { status: 400 });
      }
    }

    await ensureActivityLogIndexes(db);
    const now = new Date();

    if (isNote) {
      const rawText = typeof body.text === 'string' ? body.text : (typeof body.notes === 'string' ? body.notes : '');
      const noteText = rawText.trim();
      if (!noteText) {
        return NextResponse.json({ error: 'Note text is required' }, { status: 400 });
      }
      if (noteText.length > 10000) {
        return NextResponse.json({ error: 'Note exceeds maximum length of 10,000 characters' }, { status: 400 });
      }

      const noteDoc: ActivityLogDocument = {
        leadId: id,
        tenantId,
        brand,
        type: 'note',
        direction: null,
        matchedContactKey: null,
        bodyExcerpt: truncateBody(noteText, 5000),
        loggedBy,
        dealId: matchedDeal ? matchedDeal.id : undefined,
        dealLabel: matchedDeal ? (matchedDeal.label || undefined) : undefined,
        source: 'manual',
        createdAt: now,
      };
      const insertResult = await db.collection(ACTIVITY_LOG_COLLECTION).insertOne(noteDoc);

      try {
        await db.collection(config.dbCollection).updateOne({ _id: lead._id }, { $set: { updatedAt: now } });
      } catch (err) {
        console.error('[activity POST] lead updatedAt touch failed', err);
      }

      return NextResponse.json({
        id: insertResult.insertedId.toString(),
        leadId: id,
        type: 'note',
        dealId: matchedDeal ? matchedDeal.id : undefined,
        dealLabel: matchedDeal ? (matchedDeal.label || undefined) : undefined,
        createdAt: now.toISOString(),
      }, { status: 201 });
    }

    if (isMessage) {
      const rawText = typeof body.text === 'string' ? body.text : (typeof body.transcript === 'string' ? body.transcript : (typeof body.notes === 'string' ? body.notes : ''));
      const messageText = rawText.trim();
      if (!messageText) {
        return NextResponse.json({ error: 'Conversation text or transcript is required' }, { status: 400 });
      }
      if (messageText.length > 20000) {
        return NextResponse.json({ error: 'Conversation transcript exceeds maximum length of 20,000 characters' }, { status: 400 });
      }

      const contactKeyParam = typeof body.contactKey === 'string' ? body.contactKey.trim() : null;
      const direction = body.direction === 'inbound' || body.direction === 'outbound' ? body.direction : null;

      const messageDoc: ActivityLogDocument = {
        leadId: id,
        tenantId,
        brand,
        type: body.type,
        direction,
        matchedContactKey: contactKeyParam,
        subject: body.subject ? String(body.subject).slice(0, 200) : undefined,
        bodyExcerpt: truncateBody(messageText, 10000),
        loggedBy,
        dealId: matchedDeal ? matchedDeal.id : undefined,
        dealLabel: matchedDeal ? (matchedDeal.label || undefined) : undefined,
        source: 'manual',
        createdAt: now,
      };

      const insertResult = await db.collection(ACTIVITY_LOG_COLLECTION).insertOne(messageDoc);

      try {
        await db.collection(config.dbCollection).updateOne({ _id: lead._id }, { $set: { updatedAt: now } });
      } catch (err) {
        console.error('[activity POST] lead updatedAt touch failed', err);
      }

      return NextResponse.json({
        id: insertResult.insertedId.toString(),
        leadId: id,
        type: body.type,
        direction,
        dealId: matchedDeal ? matchedDeal.id : undefined,
        dealLabel: matchedDeal ? (matchedDeal.label || undefined) : undefined,
        createdAt: now.toISOString(),
      }, { status: 201 });
    }

    const contactKeyParam = typeof body.contactKey === 'string' ? body.contactKey : '';
    const disposition = body.disposition;
    const rawDuration = body.durationMinutes;

    if (!isValidCallDisposition(disposition)) {
      return NextResponse.json({ error: `disposition must be one of: ${CALL_DISPOSITIONS.join(', ')}` }, { status: 400 });
    }
    let durationMinutes: number | undefined;
    if (rawDuration !== undefined && rawDuration !== null && rawDuration !== '') {
      const num = Number(rawDuration);
      if (!Number.isFinite(num) || num <= 0) {
        return NextResponse.json({ error: 'durationMinutes must be a finite number greater than 0' }, { status: 400 });
      }
      durationMinutes = num;
    }
    if (!contactKeyParam) {
      return NextResponse.json({ error: 'contactKey is required' }, { status: 400 });
    }

    // Re-derived server-side from the lead's CURRENT contacts[] — never
    // trusted from a stale client-side snapshot (a contact edited/removed
    // between the form opening and submit must be re-validated here).
    const normalizedContacts = dedupeContacts(lead.contacts);
    const matchedContact = normalizedContacts.find((c) => contactKey(c) === contactKeyParam);
    if (!matchedContact) {
      return NextResponse.json({ error: 'Contact not found on this lead' }, { status: 400 });
    }

    const doc: ActivityLogDocument = {
      leadId: id,
      tenantId,
      brand,
      type: 'call',
      direction: 'outbound',
      matchedContactKey: contactKeyParam,
      bodyExcerpt: truncateBody(typeof body.notes === 'string' ? body.notes : undefined),
      callDisposition: disposition,
      callDurationMinutes: durationMinutes,
      loggedBy,
      dealId: matchedDeal ? matchedDeal.id : undefined,
      dealLabel: matchedDeal ? (matchedDeal.label || undefined) : undefined,
      source: 'manual',
      createdAt: now,
    };
    const insertResult = await db.collection(ACTIVITY_LOG_COLLECTION).insertOne(doc);

    // Non-fatal: the call was genuinely recorded above regardless of this
    // secondary write's outcome — matches ActivityPanel.tsx's own existing
    // tolerance for a non-critical secondary fetch/write failing without
    // sinking the primary content/action.
    try {
      await db.collection(config.dbCollection).updateOne({ _id: lead._id }, { $set: { updatedAt: now } });
    } catch (err) {
      console.error('[activity POST] lead updatedAt touch failed', err);
    }

    return NextResponse.json({
      id: insertResult.insertedId.toString(),
      leadId: id,
      type: 'call',
      disposition,
      dealId: matchedDeal ? matchedDeal.id : undefined,
      dealLabel: matchedDeal ? (matchedDeal.label || undefined) : undefined,
      createdAt: now.toISOString(),
    }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/activity Error:', error)
    return NextResponse.json({ error: 'Failed to log call' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
