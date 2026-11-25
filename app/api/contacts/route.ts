import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../lib/brand'
import type { Brand } from '../../lib/brand'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../lib/tenant'
import { aggregateContactsAcrossLeads } from '../../../lib/contacts'
import { queryContactsDirectory } from '../../../lib/contacts-directory'

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || 'cogmap';
  return resolveBrand(brandParam);
}

// Issue #139 — a read-only aggregation over every lead's own contacts[]
// array, not a separate Contact collection (see docs/ARCHITECTURE.md and
// issue #138's parent body for why: contacts[] stays the single source of
// truth, this is just another lens onto it, matching the Table/Kanban views
// already being alternate lenses onto the same lead data).
export async function GET(request: NextRequest) {
  try {
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const config = await getBrandConfig(brand);
    if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const tenantId = getTenantId(request);
    const { searchParams } = new URL(request.url);
    const q = (searchParams.get('q') || '').trim();
    const limitParam = searchParams.get('limit');
    const explicitLimit = limitParam ? Math.max(1, parseInt(limitParam, 10) || 5000) : null;
    const pageParam = searchParams.get('page');
    const pageSizeParam = searchParams.get('pageSize');
    const page = pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : undefined;
    const pageSize = pageSizeParam ? Math.max(1, Math.min(500, parseInt(pageSizeParam, 10) || 100)) : undefined;
    const sortBy = (searchParams.get('sortBy') || 'name').trim();
    const sortDir = searchParams.get('sortDir') === 'desc' ? 'desc' : 'asc';
    const phoneOnly = searchParams.get('phoneOnly') === '1' || searchParams.get('phoneOnly') === 'true';

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise();
    const db = client.db();
    // Combine tenant filter via $and because default-tenant tenantFilter carries $or.
    // Restricting to leads that actually have at least one contact avoids scanning
    // unpopulated leads while preserving 100% of contacts across all >5,000+ leads.
    const filter = {
      $and: [tenantFilter(tenantId), { 'contacts.0': { $exists: true } }],
    };

    const cursor = db.collection(config.dbCollection)
      .find(filter, { projection: { entity_name: 1, contacts: 1 } })
      .sort({ _id: 1 });
    if (explicitLimit !== null) {
      cursor.limit(explicitLimit);
    }
    const rawLeads = await cursor.toArray();

    const leads = rawLeads.map((l: any) => ({
      _id: l._id.toString(),
      entity_name: l.entity_name || '',
      contacts: l.contacts,
    }));

    const aggregated = aggregateContactsAcrossLeads(leads);

    const crmStatusFilter = (searchParams.get('crmStatus') || '').trim().toLowerCase();
    const ownerFilter = (searchParams.get('owner') || '').trim();
    const buyingRoleFilter = (searchParams.get('buyingRole') || '').trim().toLowerCase();
    const format = (searchParams.get('format') || '').trim().toLowerCase();

    const directory = queryContactsDirectory(aggregated, {
      q,
      crmStatus: crmStatusFilter,
      owner: ownerFilter,
      buyingRole: buyingRoleFilter,
      phoneOnly,
      sortBy,
      sortDir,
      page,
      pageSize,
    });

    if (format === 'csv' || request.headers.get('accept')?.includes('text/csv')) {
      const header = ['Name', 'First Name', 'Last Name', 'Title', 'Primary Email', 'Secondary Email', 'Phone', 'LinkedIn', 'Buying Role', 'Decision Maker', 'CRM Status', 'Owner', 'Companies'];
      const rows = directory.filteredContacts.map((c) => {
        const companies = (c.leads || []).map((l: any) => l.entity_name).join('; ');
        return [
          c.name || '',
          c.firstName || '',
          c.lastName || '',
          c.title || '',
          c.email || '',
          c.secondaryEmail || '',
          c.phone || '',
          c.linkedin || '',
          c.buyingRole || '',
          c.isDecisionMaker ? 'true' : 'false',
          c.crmStatus || 'prospect',
          c.ownerUserId || '',
          companies,
        ].map((field) => `"${String(field).replace(/"/g, '""')}"`).join(',');
      });
      const csvContent = [header.join(','), ...rows].join('\n');
      return new Response(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="contacts-${brand}.csv"`,
        },
      });
    }

    return NextResponse.json({
      contacts: directory.contacts,
      brand,
      tenantId,
      returned: directory.contacts.length,
      totalContacts: directory.totalContacts,
      filteredCount: directory.filteredCount,
      page: directory.page,
      pageSize: directory.pageSize,
      totalPages: directory.totalPages,
    });
  } catch (error: any) {
    console.error('GET /api/contacts Error:', error)
    return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
