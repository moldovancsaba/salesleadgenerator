import { NextResponse } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { getPublicLeads } from '../../../../lib/public-data'
import crypto from 'crypto'

// Helper functions
function buildFingerprint(name: string, url: string, region: string): string {
  const data = `${(url || '').trim().toLowerCase()}|${(name || '').trim().toLowerCase()}|${(region || '').toUpperCase()}`
  return crypto.createHash('sha1').update(data).digest('hex')
}

function deriveKanbanColumn(iceScore: number): string {
  if (iceScore >= 720) return 'ENGAGED'
  if (iceScore >= 480) return 'QUALIFIED'
  if (iceScore >= 240) return 'DISCOVERED'
  return 'DISCOVERED'
}

function computeIceScore(impact: number, confidence: number, ease: number): number {
  return impact * confidence * ease
}

function buildScoreProfile(impact: number, confidence: number, ease: number) {
  const iceScore = computeIceScore(impact, confidence, ease)
  return {
    agentProposal: { impact, confidence, effort: ease },
    calibratedHeuristic: { impact, confidence, effort: ease },
    finalBlended: {
      ice: iceScore,
      quality: Math.round((impact / 10) * 100),
      urgency: Math.round((confidence / 10) * 100),
      freshness: 50,
      humanSignal: 50,
      risk: Math.round(((10 - ease) / 10) * 100),
    },
    qualityDimensions: {
      evidenceQuality: confidence / 10,
      linguisticQuality: 0.8,
      actionabilityQuality: impact / 10,
      strategicValue: impact / 10,
    },
  }
}

// GET - List leads with filters
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const region = searchParams.get('region') || undefined
    const kanbanColumn = searchParams.get('kanbanColumn') || undefined
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '100') || 100))

    let rawLeads: any[] = []
    let source = 'public-data'

    if (isMongoConfigured()) {
      try {
        const client = await getClientPromise()
        const db = client.db()
        const filter: any = {}
        if (region) filter.region = region
        if (kanbanColumn) filter.kanbanColumn = kanbanColumn
        rawLeads = await db.collection('seyu_leads')
          .find(filter)
          .sort({ kanbanColumn: 1, sortOrder: 1, createdAt: -1 })
          .limit(limit)
          .toArray()
        source = 'mongodb'
      } catch {
        rawLeads = getPublicLeads()
      }
    } else {
      rawLeads = getPublicLeads()
    }

    if (source === 'public-data') {
      if (region) rawLeads = rawLeads.filter((l) => l.region === region)
      if (kanbanColumn) rawLeads = rawLeads.filter((l) => l.kanbanColumn === kanbanColumn)
      rawLeads = rawLeads.slice(0, limit)
    }

    return NextResponse.json({ leads: rawLeads.map((l) => ({ ...l, _id: l._id.toString() })), source })
  } catch (error: any) {
    console.error('GET Error:', error)
    return NextResponse.json({ error: 'Failed to fetch leads', details: error.message }, { status: 500 })
  }
}

// POST - Create new lead with dedup and scoring
export async function POST(request: Request) {
  try {
    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()
    const body = await request.json()
    
    // Build fingerprint for dedup
    const fingerprint = buildFingerprint(
      body.entity_name || body.name || '',
      body.url || '',
      body.region || 'US'
    )
    
    // Check for duplicate
    const existing = await db.collection('seyu_leads').findOne({ fingerprint })
    if (existing) {
      return NextResponse.json(
        { error: 'Duplicate lead detected', existing: { _id: existing._id, entity_name: existing.entity_name } },
        { status: 409 }
      )
    }
    
    // Compute ICE score
    const impact = body.ice?.impact || body.impact || 5
    const confidence = body.ice?.confidence || body.confidence || 5
    const ease = body.ice?.ease || body.ease || 5
    
    const iceScore = computeIceScore(impact, confidence, ease)
    const scoreProfile = buildScoreProfile(impact, confidence, ease)
    
    // Derive initial kanban column
    const kanbanColumn = body.kanbanColumn || deriveKanbanColumn(iceScore)
    
    // Count existing leads for sortOrder
    const count = await db.collection('seyu_leads').countDocuments({ kanbanColumn })
    
    const newLead = {
      id: Date.now(), // Simple ID generation
      region: body.region || 'US',
      entity_name: body.entity_name || body.name,
      url: body.url || '',
      address: body.address || '',
      general_contact: body.general_contact || '',
      size: body.size || '',
      industry: body.industry || '',
      sport_or_sector: body.sport_or_sector || '',
      level_league: body.level_league || '',
      decision_maker_name: body.decision_maker_name || '',
      decision_maker_title: body.decision_maker_title || '',
      decision_maker_contact: body.decision_maker_contact || '',
      pro_for_cogmap: body.pro_for_cogmap || [],
      con_for_cogmap: body.con_for_cogmap || [],
      value_proposition: body.value_proposition || '',
      priority: body.priority || 'medium',
      status: body.status || 'new',
      notes: body.notes || '',
      tags: body.tags || [],
      
      // Check-inspired fields
      kanbanColumn,
      sortOrder: count * 100,
      fingerprint,
      ice: { impact, confidence, ease },
      scoreProfile,
      
      feedbackScore: 0,
      declineCount: 0,
      acceptanceCount: 0,
      
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    
    const result = await db.collection('seyu_leads').insertOne(newLead)
    
    // Log outcome
    await db.collection('outcomelogs').insertOne({
      leadId: result.insertedId.toString(),
      action: 'CREATE',
      outcomeType: 'CREATE',
      outcomeValue: `Created ${kanbanColumn}`,
      actorType: 'USER',
      actedBy: 'webapp-user',
      beforeState: {},
      afterState: {
        entity_name: newLead.entity_name,
        kanbanColumn,
        iceScore,
      },
      createdAt: new Date(),
    })
    
    return NextResponse.json({ 
      success: true, 
      lead: { ...newLead, _id: result.insertedId } 
    }, { status: 201 })
    
  } catch (error: any) {
    console.error('POST Error:', error)
    return NextResponse.json(
      { error: 'Failed to create lead', details: error.message },
      { status: 500 }
    )
  }
}

// PATCH - Handle actions: ACCEPT, DECLINE, MODIFY, COLUMN_MOVE
export async function PATCH(request: Request) {
  try {
    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }
    
    const body = await request.json()
    const { ObjectId } = await import('mongodb')
    
    const existing = await db.collection('seyu_leads').findOne({ _id: new ObjectId(id) })
    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }
    
    const updateData: any = { updatedAt: new Date() }
    let action = body.action
    let outcomeValue = action
    let teachingWeight = 50
    
    // Handle COLUMN_MOVE (drag-and-drop)
    if (body.kanbanColumn && body.kanbanColumn !== existing.kanbanColumn) {
      action = 'COLUMN_MOVE'
      const now = new Date()
      updateData.kanbanColumn = body.kanbanColumn
      updateData.sortOrder = body.sortOrder || 0
      updateData.manualLaneOverrideAt = now
      updateData.manualLaneCooldownUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 24h cooldown
      updateData.manualLaneFloorColumn = body.kanbanColumn
      updateData.manualLaneOverrideBy = body.manualLaneOverrideBy || 'webapp-user'
      teachingWeight = 70
      outcomeValue = `Moved to ${body.kanbanColumn}`
    }
    
    // Handle ACCEPT
    if (action === 'ACCEPT') {
      updateData.status = 'qualified'
      updateData.acceptanceCount = (existing.acceptanceCount || 0) + 1
      updateData.feedbackScore = (existing.feedbackScore || 0) + 1
      teachingWeight = 80
    }
    
    // Handle DECLINE
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
    
    // Handle MODIFY
    if (action === 'MODIFY') {
      const fields = ['entity_name', 'url', 'address', 'general_contact', 'size', 'industry', 
                      'sport_or_sector', 'level_league', 'decision_maker_name', 'decision_maker_title',
                      'decision_maker_contact', 'value_proposition', 'notes', 'tags']
      fields.forEach(field => {
        if (body[field] !== undefined) updateData[field] = body[field]
      })
      if (body.pro_for_cogmap) updateData.pro_for_cogmap = body.pro_for_cogmap
      if (body.con_for_cogmap) updateData.con_for_cogmap = body.con_for_cogmap
      
      // Quality ceiling enforcement (Check-inspired)
      if (body.qualityStatus) {
        const currentLeadQuality = updateData.qualityStatus || existing.qualityStatus || 'DRAFT'
        const upstreamQuality = body.upstreamQualityStatuses || ['DRAFT']
        
        // Import quality enforcement
        const { enforceQualityCeiling } = await import('../../../lib/quality-registry')
        updateData.qualityStatus = enforceQualityCeiling(
          body.qualityStatus,
          upstreamQuality
        )
      }
      
      teachingWeight = 95
    }
    
    // Handle PIN
    if (action === 'PIN') {
      updateData.kanbanColumn = 'ENGAGED'
      const now = new Date()
      updateData.manualLaneOverrideAt = now
      updateData.manualLaneCooldownUntil = new Date(now.getTime() + 48 * 60 * 60 * 1000) // 48h for PIN
      outcomeValue = 'Pinned to ENGAGED'
    }
    
    // Handle REQUEST_REFRESH
    if (action === 'REQUEST_REFRESH') {
      outcomeValue = 'Refresh requested'
    }
    
    const result = await db.collection('seyu_leads').findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: 'after' }
    )
    
    // Log outcome
    await db.collection('outcomelogs').insertOne({
      leadId: id,
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
