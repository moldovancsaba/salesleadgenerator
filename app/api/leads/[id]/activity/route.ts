import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../../lib/mongodb'
import { resolveBrand } from '../../../../lib/brand'
import type { Brand } from '../../../../lib/brand'
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api'
import { getTenantId } from '../../../../../lib/tenant'
import {
  ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes,
  mapActivityLogDoc, mapOutreachLogToActivityEntry, mergeActivityTimeline,
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

export const dynamic = 'force-dynamic';
