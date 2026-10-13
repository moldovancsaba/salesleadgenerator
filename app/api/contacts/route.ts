import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../lib/brand'
import type { Brand } from '../../lib/brand'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../lib/tenant'
import { aggregateContactsAcrossLeads } from '../../../lib/contacts'
import { escapeRegExp } from '../../lib/search/tagged-content-filter'

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
    // Same bound as GET /api/leads — revisit only if real usage shows this
    // in-process aggregation needs to become a Mongo-level pipeline instead.
    const limit = Math.max(1, Math.min(5000, parseInt(searchParams.get('limit') || '5000') || 5000));

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise();
    const db = client.db();
    const filter = { ...tenantFilter(tenantId) };

    const rawLeads = await db.collection(config.dbCollection)
      .find(filter, { projection: { entity_name: 1, contacts: 1 } })
      .limit(limit)
      .toArray();

    const leads = rawLeads.map((l: any) => ({
      _id: l._id.toString(),
      entity_name: l.entity_name || '',
      contacts: l.contacts,
    }));

    let contacts = aggregateContactsAcrossLeads(leads);

    const crmStatusFilter = (searchParams.get('crmStatus') || '').trim().toLowerCase();
    const ownerFilter = (searchParams.get('owner') || '').trim();
    const buyingRoleFilter = (searchParams.get('buyingRole') || '').trim().toLowerCase();
    const format = (searchParams.get('format') || '').trim().toLowerCase();

    if (q) {
      // Case-insensitive substring match against name, email, secondaryEmail, title, or company name (issue #241).
      const re = new RegExp(escapeRegExp(q), 'i');
      contacts = contacts.filter((c) =>
        re.test(c.name) ||
        (c.email && re.test(c.email)) ||
        (c.secondaryEmail && re.test(c.secondaryEmail)) ||
        (c.title && re.test(c.title)) ||
        (c.leads && c.leads.some((l) => re.test(l.entity_name)))
      );
    }

    if (crmStatusFilter) {
      contacts = contacts.filter((c) => (c.crmStatus || 'prospect').toLowerCase() === crmStatusFilter);
    }

    if (ownerFilter) {
      contacts = contacts.filter((c) => c.ownerUserId === ownerFilter);
    }

    if (buyingRoleFilter) {
      contacts = contacts.filter((c) => (c.buyingRole || '').toLowerCase() === buyingRoleFilter);
    }

    if (format === 'csv' || request.headers.get('accept')?.includes('text/csv')) {
      const header = ['Name', 'First Name', 'Last Name', 'Title', 'Primary Email', 'Secondary Email', 'Phone', 'LinkedIn', 'Buying Role', 'Decision Maker', 'CRM Status', 'Owner', 'Companies'];
      const rows = contacts.map((c) => {
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
      contacts,
      brand,
      tenantId,
      returned: contacts.length,
    });
  } catch (error: any) {
    console.error('GET /api/contacts Error:', error)
    return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic';
