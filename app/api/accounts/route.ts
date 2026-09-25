import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../lib/brand'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../lib/tenant'
import { computeAccountRollups, ensureAccountsIndex, type AccountSourceLead } from '../../../lib/accounts'

// Issue #209, Phase 1 — a read-only, computed view grouping a brand/tenant's
// own leads by their existing parentOrgId field (see lib/accounts.ts for the
// pure grouping/rollup math and docs/ARCHITECTURE.md for the Phase 1 vs
// Phase 2 design decision). No new Mongo collection.
//
// Same brand/tenant scoping and cap convention as GET /api/contacts (issue
// #139) — this in-process aggregation is bounded by MAX_ACCOUNTS_SCAN, not
// a full unbounded collection scan, with the truncation disclosed rather
// than silently dropped (matching /api/admin/duplicate-scan's own
// cap-and-disclose pattern, issue #107).
const MAX_ACCOUNTS_SCAN = 5000;

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

export async function GET(request: NextRequest) {
  try {
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
    await ensureAccountsIndex(db, config.dbCollection);

    // A lead with no parentOrgId can never contribute to any Account group
    // — excluded at the query level, not filtered client-side, so it never
    // counts toward the scan cap either.
    const filter = { $and: [tenantFilter(tenantId), { parentOrgId: { $exists: true, $ne: '' } }] };

    const totalAvailable = await db.collection(config.dbCollection).countDocuments(filter);

    const rawLeads = await db.collection(config.dbCollection)
      .find(filter, { projection: PROJECTION })
      .limit(MAX_ACCOUNTS_SCAN)
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

    const accounts = computeAccountRollups(leads, config.currency);

    return NextResponse.json({
      accounts,
      brand,
      tenantId,
      returned: rawLeads.length,
      totalAvailable,
      truncated: totalAvailable > rawLeads.length,
    });
  } catch (error: any) {
    console.error('GET /api/accounts Error:', error)
    return NextResponse.json({ error: 'Failed to fetch accounts', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
