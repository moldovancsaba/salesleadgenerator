import { NextResponse } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { getPublicLeadById } from '../../../../lib/public-data'
import { BRAND_CONFIG, resolveBrand } from '../../../lib/brand'
import { normalizeLead } from '../../../lib/normalize-lead'

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

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  try {
    const brand = getBrand(request);
    const config = BRAND_CONFIG[brand];

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()
    const body = await request.json()
    const { ObjectId } = await import('mongodb')

    const existing = await db.collection(config.dbCollection).findOne({ _id: new ObjectId(params.id) })
    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const updateData: any = { updatedAt: new Date() }
    let action = body.action
    let outcomeValue = action
    let teachingWeight = 50

    // If no explicit action, treat as MODIFY (direct field update)
    if (!action) action = 'MODIFY'

    if (body.kanbanColumn && body.kanbanColumn !== existing.kanbanColumn) {
      action = 'COLUMN_MOVE'
      const now = new Date()
      updateData.kanbanColumn = body.kanbanColumn
      updateData.sortOrder = body.sortOrder || 0
      updateData.manualLaneOverrideAt = now
      updateData.manualLaneCooldownUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      updateData.manualLaneFloorColumn = body.kanbanColumn
      updateData.manualLaneOverrideBy = body.manualLaneOverrideBy || 'webapp-user'
      teachingWeight = 70
      outcomeValue = `Moved to ${body.kanbanColumn}`
    }

    if (action === 'ACCEPT') {
      updateData.status = 'qualified'
      updateData.acceptanceCount = (existing.acceptanceCount || 0) + 1
      updateData.feedbackScore = (existing.feedbackScore || 0) + 1
      teachingWeight = 80
    }

    if (action === 'DECLINE') {
      updateData.status = 'lost'
      updateData.kanbanColumn = 'LOST'
      updateData.declineReason = body.declineReason || 'OTHER'
      updateData.declinedAt = new Date()
      updateData.declineCount = (existing.declineCount || 0) + 1
      updateData.feedbackScore = (existing.feedbackScore || 0) - 1
      teachingWeight = 100
      outcomeValue = body.declineReason || 'DECLINED'
    }

    if (action === 'MODIFY') {
      const fields = ['entity_name', 'url', 'region', 'address', 'general_contact', 'size', 'industry', 
                      'sport_or_sector', 'level_league', 'decision_maker_name', 'decision_maker_title',
                      'decision_maker_contact', 'value_proposition', 'notes', 'tags',
                      'ice', 'iceScore', 'sortOrder', 'contacts']
      fields.forEach(field => {
        if (body[field] !== undefined) updateData[field] = body[field]
      })
      if (body[config.proField]) updateData[config.proField] = body[config.proField]
      if (body[config.conField]) updateData[config.conField] = body[config.conField]

      if (body.qualityStatus) {
        const currentLeadQuality = updateData.qualityStatus || existing.qualityStatus || 'DRAFT'
        const upstreamQuality = body.upstreamQualityStatuses || ['DRAFT']

        const { enforceQualityCeiling } = await import('../../../../lib/quality-registry')
        updateData.qualityStatus = enforceQualityCeiling(
          body.qualityStatus,
          upstreamQuality
        )
      }

      teachingWeight = 95
    }

    if (action === 'PIN') {
      updateData.kanbanColumn = 'ENGAGED'
      const now = new Date()
      updateData.manualLaneOverrideAt = now
      updateData.manualLaneCooldownUntil = new Date(now.getTime() + 48 * 60 * 60 * 1000)
      outcomeValue = 'Pinned to ENGAGED'
    }

    if (action === 'REQUEST_REFRESH') {
      outcomeValue = 'Refresh requested'
    }

    const result = await db.collection(config.dbCollection).findOneAndUpdate(
      { _id: new ObjectId(params.id) },
      { $set: updateData },
      { returnDocument: 'after' }
    )

    await db.collection('outcomelogs').insertOne({
      leadId: params.id,
      action,
      outcomeType: action,
      outcomeValue,
      annotation: body.annotation || body.notes || '',
      teachingWeight,
      actorType: 'USER',
      actedBy: 'webapp-user',
      beforeState: {
        kanbanColumn: existing.kanbanColumn,
        status: existing.status,
      },
      afterState: {
        kanbanColumn: updateData.kanbanColumn || existing.kanbanColumn,
        status: updateData.status || existing.status,
      },
      createdAt: new Date(),
    })

    return NextResponse.json({ success: true, lead: result })

  } catch (error: any) {
    console.error('PATCH Error:', error)
    return NextResponse.json(
      { error: 'Failed to update lead', details: error.message },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic';
