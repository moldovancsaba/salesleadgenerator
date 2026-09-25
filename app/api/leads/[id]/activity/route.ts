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

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise();
    const db = client.db();
    await ensureActivityLogIndexes(db);

    const [activityLogDocs, outreachLogDocs] = await Promise.all([
      db.collection(ACTIVITY_LOG_COLLECTION)
        .find({ leadId: id })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),
      db.collection('outreach_logs')
        .find({ leadId: id, tenantId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray(),
    ]);

    const activity = mergeActivityTimeline(
      [
        activityLogDocs.map(mapActivityLogDoc),
        outreachLogDocs.map(mapOutreachLogToActivityEntry),
      ],
      limit
    );

    return NextResponse.json({ activity, leadId: id, brand, tenantId, returned: activity.length });
  } catch (error: any) {
    console.error('GET /api/leads/[id]/activity Error:', error)
    return NextResponse.json({ error: 'Failed to fetch activity', details: error.message }, { status: 500 })
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

    // Re-derived server-side from the lead's CURRENT contacts[] — never
    // trusted from a stale client-side snapshot (a contact edited/removed
    // between the form opening and submit must be re-validated here).
    const normalizedContacts = dedupeContacts(lead.contacts);
    const matchedContact = normalizedContacts.find((c) => contactKey(c) === contactKeyParam);
    if (!matchedContact) {
      return NextResponse.json({ error: 'Contact not found on this lead' }, { status: 400 });
    }

    // loggedBy is derived server-side from the verified session claim only
    // — never accepted as client input (prevents logging a call under
    // another rep's name) and omitted (not guessed) for the x-api-key path.
    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const loggedBy = claims?.email;

    await ensureActivityLogIndexes(db);

    const now = new Date();
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
      createdAt: now.toISOString(),
    }, { status: 201 });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/activity Error:', error)
    return NextResponse.json({ error: 'Failed to log call', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
