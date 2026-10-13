import { NextResponse, type NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { isMongoConfigured, getClientPromise } from '../../../../../lib/mongodb';
import { getBrandConfig, resolveBrand, type Brand } from '../../../../lib/brand';
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api';
import { getTenantId, tenantFilter } from '../../../../../lib/tenant';
import { computeSnoozeDate } from '../../../../../lib/today';
import {
  ACTIVITY_LOG_COLLECTION,
  ensureActivityLogIndexes,
  truncateBody,
} from '../../../../lib/activity-log-store';
import { resolveSessionFromIdToken } from '../../../../../lib/session';

export const dynamic = 'force-dynamic';

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || 'cogmap';
  return await resolveBrand(brandParam);
}

function parseObjectId(id: string): ObjectId | null {
  try {
    return new ObjectId(id.trim());
  } catch {
    return null;
  }
}

// POST /api/leads/[id]/snooze — snoozes a follow-up reminder by a duration preset ('1d', '3d', '1w') or ISO date.
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
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const leadObjectId = parseObjectId(id);
    if (!leadObjectId) {
      return NextResponse.json({ error: 'Invalid lead id' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const duration = typeof body.duration === 'string' && body.duration ? body.duration : '1d';
    const note = typeof body.note === 'string' ? body.note : undefined;

    const config = (await getBrandConfig(brand))!;
    const tenantId = getTenantId(request);
    const client = await getClientPromise();
    const db = client.db();

    const lead = await db.collection(config.dbCollection).findOne({
      _id: leadObjectId,
      ...tenantFilter(tenantId),
    });

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const now = new Date();
    const nextDue = computeSnoozeDate(duration, now);
    const updateSet: Record<string, any> = {
      nextActionDueAt: nextDue.toISOString(),
      updatedAt: now,
    };
    if (note !== undefined) {
      updateSet.nextActionNote = note;
    }

    await db.collection(config.dbCollection).updateOne(
      { _id: leadObjectId },
      { $set: updateSet }
    );

    // Audit activity log
    try {
      const idToken = request.cookies.get('sso_id_token')?.value;
      const claims = await resolveSessionFromIdToken(idToken);
      const loggedBy = claims?.email;
      await ensureActivityLogIndexes(db);
      await db.collection(ACTIVITY_LOG_COLLECTION).insertOne({
        leadId: id,
        tenantId,
        brand,
        type: 'note',
        direction: 'outbound',
        matchedContactKey: null,
        bodyExcerpt: truncateBody(`Follow-up snoozed (${duration})${note ? `: ${note}` : ''}`),
        loggedBy,
        source: 'manual',
        createdAt: now,
      });
    } catch (logErr) {
      console.error('[leads/snooze] activity log write failed', logErr);
    }

    return NextResponse.json({
      ok: true,
      nextActionDueAt: nextDue.toISOString(),
      nextActionNote: note !== undefined ? note : lead.nextActionNote,
    });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/snooze Error:', error);
    return NextResponse.json({ error: 'Failed to snooze lead' }, { status: 500 });
  }
}
