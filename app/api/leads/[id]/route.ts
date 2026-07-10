import { NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { ObjectId } from 'mongodb'

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const client = await clientPromise
    const db = client.db()

    const lead = await db.collection('leads').findOne({
      _id: new ObjectId(params.id)
    })

    if (!lead) {
      return NextResponse.json(
        { error: 'Lead not found' },
        { status: 404 }
      )
    }

    // Fetch linked outcome logs
    const outcomes = await db.collection('outcomelogs')
      .find({ leadId: params.id })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray()

    return NextResponse.json({
      ...lead,
      _id: lead._id.toString(),
      outcomes: outcomes.map(o => ({
        ...o,
        _id: o._id.toString(),
      })),
    })
  } catch (error: any) {
    console.error('GET lead/:id Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch lead', details: error.message },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const client = await clientPromise
    const db = client.db()

    const result = await db.collection('leads').deleteOne({
      _id: new ObjectId(params.id)
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
