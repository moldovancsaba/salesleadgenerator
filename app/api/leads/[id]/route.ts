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

  try {
    const lead = await db.collection(config.dbCollection).findOne({
      _id: new (await import('mongodb')).ObjectId(trimmed),
      ...filter,
    });
    if (lead) return lead;
  } catch {
    // not a valid ObjectId; fall through
  }

  const numericId = Number(trimmed);
  if (Number.isFinite(numericId)) {
    return db.collection(config.dbCollection).findOne({
      id: numericId,
      ...filter,
    });
  }

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

export async function PUT(
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

    const body = await request.json();
    const clientPromise = getClientPromise()
    const db = clientPromise.then(client => client.db())
    const dbInstance = await db

    const existing = await tryFindLead(dbInstance, config, tenantId, params.id)
    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const forbiddenFields: Record<string, string[]> = {
      cogmap: ['pro_for_seyu', 'con_for_seyu'],
      seyu: ['pro_for_cogmap', 'con_for_cogmap'],
    };
    const forbidden = forbiddenFields[brand] || [];
    const badFields = forbidden.filter((f: string) => body[f] !== undefined);
    if (badFields.length > 0) {
      return NextResponse.json({ error: `Forbidden fields: ${badFields.join(', ')}` }, { status: 400 })
    }

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    const allowedFields = [
      'entity_name', 'url', 'region', 'address', 'general_contact', 'size', 'industry',
      'sport_or_sector', 'level_league', 'decision_maker_name', 'decision_maker_title',
      'decision_maker_contact', 'contact_phone', 'value_proposition', 'notes', 'tags',
      'kanbanColumn', 'sortOrder', 'priority', 'status', 'ice', 'iceScore',
      config.proField, config.conField, 'contacts', 'qualityStatus'
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (body.contacts && Array.isArray(body.contacts)) {
      updateData.contacts = body.contacts.map((c: any) => ({
        name: typeof c.name === 'string' ? c.name.trim() : '',
        title: typeof c.title === 'string' ? c.title.trim() : '',
        email: typeof c.email === 'string' ? c.email.trim() : '',
        phone: typeof c.phone === 'string' ? c.phone.trim() : (c.contact_phone || '').trim(),
        linkedin: typeof c.linkedin === 'string' ? c.linkedin.trim() : '',
        role: typeof c.role === 'string' ? c.role.trim() : '',
      }));
    }

    const result = await dbInstance.collection(config.dbCollection).findOneAndUpdate(
      { _id: existing._id, ...buildTenantFilter(tenantId) },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    const updatedLead = result?.value || result;
    if (!updatedLead) {
      return NextResponse.json({ error: 'Lead not found after update' }, { status: 404 })
    }

    return NextResponse.json(normalizeLead({ ...updatedLead, _id: updatedLead._id.toString() }, brand))
  } catch (error: any) {
    console.error('PUT lead/:id Error:', error)
    return NextResponse.json({ error: 'Failed to update lead', details: error.message }, { status: 500 })
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

    const clientPromise = getClientPromise()
    const db = await clientPromise.then(client => client.db())

    const result = await db.collection(config.dbCollection).deleteOne({
      _id: new (await import('mongodb')).ObjectId(params.id),
      ...buildTenantFilter(tenantId),
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
