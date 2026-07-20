import { NextResponse } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '../../../lib/brand'
import { normalizeLead } from '../../../lib/normalize-lead'
import { requireApiKey } from '../../../../lib/api-auth'

function getBrand(request: Request): 'cogmap' | 'seyu' {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || 'cogmap';
  return resolveBrand(brandParam);
}

function getTenantId(request: Request): string {
  const url = new URL(request.url);
  const tenantId = (url.searchParams.get('tenantId') || 'default').trim();
  return tenantId || 'default';
}

function buildTenantFilter(tenantId: string) {
  return tenantId === 'default'
    ? { $or: [{ tenantId: 'default' }, { tenantId: { $exists: false } }] }
    : { tenantId };
}

async function tryFindLead(db: any, config: any, tenantId: string, rawId: string) {
  const trimmed = rawId.trim();
  const filter = buildTenantFilter(tenantId);

  // Try MongoDB ObjectId first
  try {
    const lead = await db.collection(config.dbCollection).findOne({
      _id: new (await import('mongodb')).ObjectId(trimmed),
      ...filter,
    });
    if (lead) return lead;
  } catch {
    // not a valid ObjectId; fall through
  }

  // Try numeric `id` field returned by POST
  const numericId = Number(trimmed);
  if (Number.isFinite(numericId)) {
    return db.collection(config.dbCollection).findOne({
      id: numericId,
      ...filter,
    });
  }

  // Last resort: string match against stored id/_id
  return db.collection(config.dbCollection).findOne({
    $or: [{ id: trimmed }, { _id: trimmed }],
    ...filter,
  });
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const brand = getBrand(request);
    const config = BRAND_CONFIG[brand];
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const clientPromise = getClientPromise()
    let lead: any = null

    try {
      const client = await clientPromise
      const db = client.db()
      lead = await tryFindLead(db, config, tenantId, params.id)
      if (lead) {
        lead = normalizeLead({ ...lead, _id: lead._id.toString() }, brand);
      }
    } catch {
      // DB lookup failed; treat as not found instead of falling back to legacy static data
      lead = null;
    }

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    return NextResponse.json(lead)
  } catch (error: any) {
    console.error('GET lead/:id Error:', error)
    return NextResponse.json({ error: 'Failed to fetch lead', details: error.message }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const brand = getBrand(request);
    const config = BRAND_CONFIG[brand];
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()

    const result = await db.collection(config.dbCollection).deleteOne({
      _id: new (await import('mongodb')).ObjectId(params.id),
      tenantId,
    })

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Lead not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete lead', details: error.message },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic';
