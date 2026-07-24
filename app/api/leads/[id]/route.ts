import { NextResponse } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { BRAND_CONFIG, resolveBrand, PRO_FIELD, CON_FIELD } from '../../../lib/brand'
import { normalizeLead } from '../../../lib/normalize-lead'
import { requireApiKey } from '../../../../lib/api-auth'
import { validateLeadPayload } from '../../../../lib/validate-lead'
import { deriveKanbanColumn, isAutoManagedColumn } from '../../../../lib/kanban-column'
import { dedupeContacts } from '../../../../lib/contacts'

function getBrand(request: Request): 'cogmap' | 'seyu' {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || 'cogmap';
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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
      lead = await tryFindLead(db, config, tenantId, id)
      if (lead) {
        lead = normalizeLead({ ...lead, _id: lead._id.toString() });
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
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const { id } = await params;
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

    const existing = await tryFindLead(dbInstance, config, tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const validation = validateLeadPayload(body, brand, { partial: true });
    if (!validation.valid) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 })
    }

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    const allowedFields = [
      'entity_name', 'url', 'region', 'address', 'general_contact', 'size', 'industry',
      'sport_or_sector', 'level_league', 'value_proposition', 'notes', 'tags',
      'kanbanColumn', 'sortOrder', 'priority', 'status', 'ice', 'iceScore',
      PRO_FIELD, CON_FIELD, 'contacts', 'qualityStatus',
      'recommended_tier', 'estimated_participants', 'estimated_annual_revenue_usd',
      'revenue_model', 'product_fit_notes', 'pricingByCompany'
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // Unlike POST (which runs the whole body through normalizeLead()'s
    // ensureNumber() coercion), this loop copies `ice` from the request
    // body verbatim. validateLeadPayload only range-checks via Number(),
    // it never mutates the stored value — so a request with numerically
    // valid but string-typed ice fields (e.g. "8" instead of 8) would pass
    // validation and get persisted as strings, which then breaks the
    // ICE-score sort aggregation ($multiply requires numeric types).
    // Coerce here so every write path stores real numbers.
    if (body.ice !== undefined && typeof body.ice === 'object' && body.ice !== null) {
      updateData.ice = {
        impact: Number(body.ice.impact),
        confidence: Number(body.ice.confidence),
        ease: Number(body.ice.ease),
      };
    }

    // Shared with POST and PATCH MODIFY (lib/contacts.ts) — previously this route
    // had its own inline normalization and never deduped, unlike POST. Using the
    // same dedupeContacts() here closes that divergence (issue #45).
    if (body.contacts && Array.isArray(body.contacts)) {
      updateData.contacts = dedupeContacts(body.contacts);
    }

    // Discovered/Qualified are auto-managed by ICE score alone: a score change
    // re-derives the column. Every other column is exclusively user-managed —
    // once a lead has been moved out (or an explicit kanbanColumn is sent in
    // the same request), it's never auto-reclassified again.
    if (body.ice !== undefined && body.kanbanColumn === undefined && isAutoManagedColumn(existing.kanbanColumn)) {
      const newIceScore = Number(body.ice.impact) * Number(body.ice.confidence) * Number(body.ice.ease);
      updateData.kanbanColumn = deriveKanbanColumn(newIceScore);
    }

    const result = await dbInstance.collection(config.dbCollection).findOneAndUpdate(
      { _id: existing._id, ...buildTenantFilter(tenantId) },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: 'Lead not found after update' }, { status: 404 })
    }
    const updatedLead = result;

    return NextResponse.json(normalizeLead({ ...updatedLead, _id: updatedLead._id.toString() }))
  } catch (error: any) {
    console.error('PUT lead/:id Error:', error)
    return NextResponse.json({ error: 'Failed to update lead', details: error.message }, { status: 500 })
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const brand = getBrand(request);
    const config = BRAND_CONFIG[brand];
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const clientPromise = getClientPromise()
    const db = await clientPromise.then(client => client.db())

    const existing = await tryFindLead(db, config, tenantId, id)
    if (!existing) {
      return NextResponse.json(
        { error: 'Lead not found' },
        { status: 404 }
      )
    }

    const result = await db.collection(config.dbCollection).deleteOne({
      _id: existing._id,
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
