import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getClientPromise, isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand, getBrandConfig, type Brand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { getTenantId, tenantFilter } from '@/lib/tenant';
import { normalizeLead } from '@/app/lib/normalize-lead';
import { dedupeContacts } from '@/lib/contacts';
import {
  exportLeadsToCsv,
  exportLeadsToGoogleSheetsTsv,
  type CrmPreset,
} from '@/lib/crm-lead-exchange';
import type { Lead } from '@/app/types';

export const dynamic = 'force-dynamic';

async function getBrandFromRequest(request: Request): Promise<Brand | null> {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || 'seyu';
  return await resolveBrand(brandParam);
}

export async function GET(request: NextRequest) {
  try {
    const brand = await getBrandFromRequest(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const { searchParams } = new URL(request.url);
    const tenantId = getTenantId(request);
    const preset = (searchParams.get('preset') || 'google_sheets') as CrmPreset;
    const format = (searchParams.get('format') || 'csv').toLowerCase();
    const kanbanColumn = searchParams.get('kanbanColumn') || undefined;
    const region = searchParams.get('region') || undefined;
    const industry = searchParams.get('industry') || undefined;

    const client = await getClientPromise();
    const db = client.db();
    const config = (await getBrandConfig(brand))!;

    const filter: any = { ...tenantFilter(tenantId) };
    if (kanbanColumn) filter.kanbanColumn = kanbanColumn;
    if (region) filter.region = region;
    if (industry) filter.industry = industry;

    const rawLeads = await db
      .collection(config.dbCollection)
      .find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .limit(10000)
      .toArray();

    const leads: Lead[] = rawLeads.map((l) => {
      const normalized = normalizeLead({ ...l, _id: l._id.toString() });
      normalized.contacts = dedupeContacts(normalized.contacts || []);
      return normalized as unknown as Lead;
    });

    if (format === 'tsv') {
      const tsvContent = exportLeadsToGoogleSheetsTsv(leads);
      return new Response(tsvContent, {
        headers: {
          'Content-Type': 'text/tab-separated-values; charset=utf-8',
          'Content-Disposition': `attachment; filename="${brand}-leads-${preset}.tsv"`,
        },
      });
    }

    const csvContent = exportLeadsToCsv(leads, preset, brand);
    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${brand}-leads-${preset}.csv"`,
      },
    });
  } catch (error: any) {
    console.error('[leads/export GET] Error:', error);
    return NextResponse.json({ error: error?.message || 'Export failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const brandParam = body.brand || new URL(request.url).searchParams.get('brand') || 'seyu';
    const brand = await resolveBrand(brandParam);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const tenantId = body.tenantId || getTenantId(request);
    const preset = (body.preset || 'google_sheets') as CrmPreset;
    const format = (body.format || 'csv').toLowerCase();
    const leadIds: string[] = Array.isArray(body.leadIds) ? body.leadIds : [];

    const client = await getClientPromise();
    const db = client.db();
    const config = (await getBrandConfig(brand))!;

    const filter: any = { ...tenantFilter(tenantId) };
    if (leadIds.length > 0) {
      const objectIds = leadIds
        .filter((id) => ObjectId.isValid(id))
        .map((id) => new ObjectId(id));
      filter.$or = [{ _id: { $in: objectIds } }, { _id: { $in: leadIds } }, { id: { $in: leadIds } }];
    }

    const rawLeads = await db
      .collection(config.dbCollection)
      .find(filter)
      .sort({ sortOrder: 1, createdAt: -1 })
      .limit(10000)
      .toArray();

    const leads: Lead[] = rawLeads.map((l) => {
      const normalized = normalizeLead({ ...l, _id: l._id.toString() });
      normalized.contacts = dedupeContacts(normalized.contacts || []);
      return normalized as unknown as Lead;
    });

    if (format === 'tsv') {
      const tsvContent = exportLeadsToGoogleSheetsTsv(leads);
      return new Response(tsvContent, {
        headers: {
          'Content-Type': 'text/tab-separated-values; charset=utf-8',
          'Content-Disposition': `attachment; filename="${brand}-leads-${preset}.tsv"`,
        },
      });
    }

    const csvContent = exportLeadsToCsv(leads, preset, brand);
    return new Response(csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${brand}-leads-${preset}.csv"`,
      },
    });
  } catch (error: any) {
    console.error('[leads/export POST] Error:', error);
    return NextResponse.json({ error: error?.message || 'Export failed' }, { status: 500 });
  }
}
