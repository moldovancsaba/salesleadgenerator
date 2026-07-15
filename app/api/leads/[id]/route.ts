import { NextResponse } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { getPublicLeadById } from '../../../../lib/public-data'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    if (!isMongoConfigured()) {
      return NextResponse.json(getPublicLeadById(params.id) || { error: 'Lead not found' }, { status: getPublicLeadById(params.id) ? 200 : 404 })
    }

    const clientPromise = getClientPromise()
    let lead: any = null

    try {
      const client = await clientPromise
      const db = client.db()
      lead = await db.collection('leads').findOne({ _id: new (await import('mongodb')).ObjectId(params.id) })
      if (lead) {
        lead = { ...lead, _id: lead._id.toString() }
      }
    } catch {
      lead = getPublicLeadById(params.id)
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
  try {
    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()

    const result = await db.collection('leads').deleteOne({
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
