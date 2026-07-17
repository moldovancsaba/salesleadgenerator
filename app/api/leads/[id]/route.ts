import { NextResponse } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { getPublicLeadById } from '../../../../lib/public-data'
import { BRAND_CONFIG, resolveBrand } from '../../../lib/brand'
import { normalizeLead } from '../../../lib/normalize-lead'
import { requireApiKey } from '../../../../lib/api-auth'

function getBrand(request: Request): 'cogmap' | 'seyu' {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || 'cogmap';
  return resolveBrand(brandParam);
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const brand = getBrand(request);
    const config = BRAND_CONFIG[brand];

    if (!isMongoConfigured()) {
      const fallback = getPublicLeadById(params.id);
      if (!fallback) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      return NextResponse.json(normalizeLead(fallback, brand));
    }

    const clientPromise = getClientPromise()
    let lead: any = null

    try {
      const client = await clientPromise
      const db = client.db()
      lead = await db.collection(config.dbCollection).findOne({ _id: new (await import('mongodb')).ObjectId(params.id) })
      if (lead) {
        lead = normalizeLead({ ...lead, _id: lead._id.toString() }, brand);
      }
    } catch {
      lead = getPublicLeadById(params.id);
      if (lead) lead = normalizeLead(lead, brand);
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

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()

    const result = await db.collection(config.dbCollection).deleteOne({
      _id: new (await import('mongodb')).ObjectId(params.id)
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
