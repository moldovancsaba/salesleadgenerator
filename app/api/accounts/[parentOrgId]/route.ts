import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../../lib/brand'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../../lib/tenant'
import { computeAccountDetail, type AccountSourceLead, type AccountActivityEntry } from '../../../../lib/accounts'
import {
  ACTIVITY_LOG_COLLECTION,
  ensureActivityLogIndexes,
  mapActivityLogDoc,
  mapOutreachLogToActivityEntry,
  mergeActivityTimeline,
} from '../../../lib/activity-log-store'

// Issue #209, Phase 1 — the detail half of GET /api/accounts: every lead
// sharing one exact parentOrgId string, within the same brand+tenant.
// Queried directly by parentOrgId (no scan cap needed here — a single
// account's own lead count is bounded by real org size, not the whole
// collection).
const PROJECTION = {
  entity_name: 1,
  parentOrgId: 1,
  parentOrgName: 1,
  relationshipToParent: 1,
  kanbanColumn: 1,
  sport_or_sector: 1,
  businessUnitCode: 1,
  contacts: 1,
  ticketSizeEstimate: 1,
  actualDealValueUsd: 1,
  updatedAt: 1,
} as const;

export async function GET(request: NextRequest, { params }: { params: Promise<{ parentOrgId: string }> }) {
  try {
    const { parentOrgId: rawParentOrgId } = await params;
    const parentOrgId = decodeURIComponent(rawParentOrgId || '').trim();
    if (!parentOrgId) return NextResponse.json({ error: 'Invalid parentOrgId' }, { status: 400 });

    const { searchParams } = new URL(request.url);
    const brand = await resolveBrand(searchParams.get('brand') || searchParams.get('board') || 'cogmap');
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const config = await getBrandConfig(brand);
    if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise();
    const db = client.db();

    const filter = { $and: [tenantFilter(tenantId), { parentOrgId }] };

    const rawLeads = await db.collection(config.dbCollection)
      .find(filter, { projection: PROJECTION })
      .toArray();

    const leads: AccountSourceLead[] = rawLeads.map((l: any) => ({
      _id: l._id.toString(),
      entity_name: l.entity_name,
      parentOrgId: l.parentOrgId,
      parentOrgName: l.parentOrgName,
      relationshipToParent: l.relationshipToParent,
      kanbanColumn: l.kanbanColumn,
      sport_or_sector: l.sport_or_sector,
      businessUnitCode: l.businessUnitCode,
      contacts: l.contacts,
      ticketSizeEstimate: l.ticketSizeEstimate,
      actualDealValueUsd: l.actualDealValueUsd,
      updatedAt: l.updatedAt,
    }));

    const leadIds = leads.map((l) => l._id);
    const leadNameById = new Map(leads.map((l) => [l._id, l.entity_name || 'Untitled lead']));

    let activities: AccountActivityEntry[] = [];
    if (leadIds.length > 0) {
      await ensureActivityLogIndexes(db);
      const [activityLogDocs, outreachLogDocs] = await Promise.all([
        db.collection(ACTIVITY_LOG_COLLECTION)
          .find({ leadId: { $in: leadIds } })
          .sort({ createdAt: -1 })
          .limit(50)
          .toArray(),
        db.collection('outreach_logs')
          .find({ leadId: { $in: leadIds }, tenantId, activityLogWritten: { $ne: true } })
          .sort({ createdAt: -1 })
          .limit(50)
          .toArray(),
      ]);

      const mappedActivityDocs = activityLogDocs.map((doc: any) => ({
        ...mapActivityLogDoc(doc),
        leadName: leadNameById.get(String(doc.leadId || '')),
      }));

      const mappedOutreachDocs = outreachLogDocs.map((log: any) => ({
        ...mapOutreachLogToActivityEntry(log),
        leadName: leadNameById.get(String(log.leadId || '')),
      }));

      activities = mergeActivityTimeline([mappedActivityDocs, mappedOutreachDocs], 50) as AccountActivityEntry[];
    }

    const account = computeAccountDetail(parentOrgId, leads, config.currency, activities);
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 });

    return NextResponse.json({ account, brand, tenantId });
  } catch (error: any) {
    console.error('GET /api/accounts/[parentOrgId] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch account' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
