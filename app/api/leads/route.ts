import { NextResponse } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../lib/mongodb'
import { BRAND_CONFIG, resolveBrand } from '../../lib/brand'
import { normalizeLead, extractWarnings } from '../../lib/normalize-lead'
import crypto from 'crypto'
import { requireApiKey } from '../../../lib/api-auth'
import { validateLeadPayload, validatePatchPayload } from '../../../lib/validate-lead'

// Normalize phone to international format
function normalizePhone(phone: string): string {
  if (!phone) return phone
  const cleaned = phone.replace(/[^\d+]/g, '')
  if (cleaned.startsWith('+')) return cleaned
  if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
    return '+1' + cleaned  // Assume US
  }
  if (cleaned.startsWith('1') && cleaned.length === 11) {
    return '+' + cleaned
  }
  return '+' + cleaned
}

// Normalize email to lowercase, trim
function normalizeEmail(email: string): string {
  if (!email) return email
  return email.toLowerCase().trim()
}

// Normalize address - ensure country is included if missing
function normalizeAddress(address: string, country: string): string {
  if (!address) return address
  const addr = address.trim()
  // If address doesn't contain country name and no ZIP pattern, add country
  const country_names: Record<string, string> = {
    'US': 'United States', 'GB': 'United Kingdom', 'FR': 'France',
    'DE': 'Germany', 'IT': 'Italy', 'ES': 'Spain', 'SA': 'Saudi Arabia',
    'AE': 'United Arab Emirates', 'QA': 'Qatar', 'PL': 'Poland',
    'AU': 'Australia', 'NZ': 'New Zealand', 'CA': 'Canada'
  }
  const country_name = country_names[country] || country
  if (!addr.toLowerCase().includes(country_name.toLowerCase()) &&
      !addr.match(/\b[A-Z]{2}\s+\d{4,6}\b/)) {
    return addr + ', ' + country_name
  }
  return addr
}

type Brand = 'cogmap' | 'seyu';

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

function computeEase(body: any): number {
  const hasNamed = !!body.decision_maker_name;
  const hasEmail = !!body.decision_maker_contact;
  const hasPhone = !!body.contact_phone;
  const hasAddress = !!body.address;
  const hasGeneral = !!body.general_contact;

  if (!hasNamed && !hasGeneral) return 1;
  if (!hasNamed && hasGeneral) return 2;
  if (hasNamed && !hasEmail && !hasPhone) return 3;
  if (hasNamed && hasAddress && !hasEmail && !hasPhone) return 4;
  if (hasNamed && (hasEmail || hasPhone) && !hasAddress) return 5;
  if (hasNamed && hasAddress && (hasEmail || hasPhone) && !(hasEmail && hasPhone)) return 6;
  if (hasNamed && hasAddress && hasEmail && hasPhone) return 7;
  return 4;
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

function getBrand(request: Request): Brand {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || url.pathname.split('/')[2] || 'cogmap';
  return resolveBrand(brandParam);
}

function getTenantId(request: Request): string {
  const url = new URL(request.url);
  const tenantId = (url.searchParams.get('tenantId') || 'default').trim();
  return tenantId || 'default';
}

// GET - List leads with filters
export async function GET(request: Request) {
  try {
    const brand = getBrand(request);
    const config = BRAND_CONFIG[brand];
    const tenantId = getTenantId(request);
    const { searchParams } = new URL(request.url)
    const region = searchParams.get('region') || undefined
    const kanbanColumn = searchParams.get('kanbanColumn') || undefined
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '100') || 100))
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
    const skip = (page - 1) * limit

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()
    const filter: any = { tenantId }
    if (region) filter.region = region
    if (kanbanColumn) filter.kanbanColumn = kanbanColumn

    const totalCount = await db.collection(config.dbCollection).countDocuments(filter)
    const rawLeads = await db.collection(config.dbCollection)
      .find(filter)
      .sort({ kanbanColumn: 1, sortOrder: 1, createdAt: -1 })
      .limit(limit)
      .skip(skip)
      .toArray()

    return NextResponse.json({
      leads: rawLeads.map((l) => normalizeLead({ ...l, _id: l._id.toString() }, brand)),
      brand,
      tenantId,
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit)
    })
  } catch (error: any) {
    console.error('GET Error:', error)
    return NextResponse.json({ error: 'Failed to fetch leads', details: error.message }, { status: 500 })
  }
}

// POST - Create new lead with dedup and scoring
export async function POST(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const brand = getBrand(request);
    const config = BRAND_CONFIG[brand];
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const body = await request.json()
    const validation = validateLeadPayload(body, brand);
    if (!validation.valid) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 });
    }

    // Normalize contact fields
    if (body.decision_maker_contact) {
      body.decision_maker_contact = normalizeEmail(body.decision_maker_contact)
    }
    if (body.contact_phone) {
      body.contact_phone = normalizePhone(body.contact_phone)
    }
    if (body.address) {
      body.address = normalizeAddress(body.address, body.country || 'US')
    }
    if (body.general_email) {
      body.general_email = normalizeEmail(body.general_email)
    }
    if (body.contacts && Array.isArray(body.contacts)) {
      body.contacts = body.contacts.map((c: any) => ({
        ...c,
        email: c.email ? normalizeEmail(c.email) : c.email,
        phone: c.phone ? normalizePhone(c.phone) : c.phone,
      }))
    }

    const client = await getClientPromise()
    const db = client.db()

    const normalizedBody = normalizeLead(body, brand)
    const normalizedWarnings = extractWarnings(normalizedBody)

    const fingerprint = buildFingerprint(
      normalizedBody.entity_name || normalizedBody.name || '',
      normalizedBody.url || '',
      normalizedBody.region || 'US'
    )

    const existing = await db.collection(config.dbCollection).findOne({ fingerprint, tenantId })
    if (existing) {
      return NextResponse.json(
        { error: 'Duplicate lead detected', existing: { _id: existing._id, entity_name: existing.entity_name } },
        { status: 409 }
      )
    }

    const impact = normalizedBody.ice?.impact || normalizedBody.impact || 5
    const confidence = normalizedBody.ice?.confidence || normalizedBody.confidence || 5
    const ease = computeEase(normalizedBody)

    const iceScore = computeIceScore(impact, confidence, ease)
    const scoreProfile = buildScoreProfile(impact, confidence, ease)

    const kanbanColumn = normalizedBody.kanbanColumn || deriveKanbanColumn(iceScore)

    const count = await db.collection(config.dbCollection).countDocuments({ kanbanColumn, tenantId })

    const newLead = {
      id: Date.now(),
      region: normalizedBody.region || 'US',
      entity_name: normalizedBody.entity_name || normalizedBody.name,
      url: normalizedBody.url || '',
      contact_phone: normalizedBody.contact_phone || '',
      contacts: normalizedBody.contacts || [],
      address: normalizedBody.address || '',
      general_contact: normalizedBody.general_contact || '',
      size: normalizedBody.size || '',
      industry: normalizedBody.industry || '',
      sport_or_sector: normalizedBody.sport_or_sector || '',
      level_league: normalizedBody.level_league || '',
      decision_maker_name: normalizedBody.decision_maker_name || '',
      decision_maker_title: normalizedBody.decision_maker_title || '',
      decision_maker_contact: normalizedBody.decision_maker_contact || '',
      [config.proField]: normalizedBody[config.proField] || [],
      [config.conField]: normalizedBody[config.conField] || [],
      value_proposition: normalizedBody.value_proposition || '',
      priority: normalizedBody.priority || 'medium',
      status: normalizedBody.status || 'new',
      notes: normalizedBody.notes || '',
      tags: normalizedBody.tags || [],

      kanbanColumn,
      sortOrder: count * 100,
      fingerprint,
      tenantId,
      ice: { impact, confidence, ease },
      scoreProfile,
      normalizationWarnings: normalizedWarnings,

      feedbackScore: 0,
      declineCount: 0,
      acceptanceCount: 0,

      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result = await db.collection(config.dbCollection).insertOne(newLead)

    if (normalizedWarnings.length > 0) {
      console.warn('Lead created with normalization warnings', normalizedWarnings)
    }

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
      tenantId,
    })

    return NextResponse.json({
      success: true,
      lead: { ...newLead, _id: result.insertedId, tenantId }
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
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 })
    }

    const body = await request.json()
    const validation = validatePatchPayload(body, brand);
    if (!validation.valid) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 });
    }

    const normalizedBody = normalizeLead(body, brand)
    const normalizedWarnings = extractWarnings(normalizedBody)
    const { ObjectId } = await import('mongodb')

    const existing = await db.collection(config.dbCollection).findOne({ _id: new ObjectId(id) })
    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const updateData: any = { updatedAt: new Date() }
    let action = normalizedBody.action
    let outcomeValue = action
    let teachingWeight = 50

    if (normalizedBody.kanbanColumn && normalizedBody.kanbanColumn !== existing.kanbanColumn) {
      action = 'COLUMN_MOVE'
      const now = new Date()
      updateData.kanbanColumn = normalizedBody.kanbanColumn
      updateData.sortOrder = normalizedBody.sortOrder || 0
      updateData.manualLaneOverrideAt = now
      updateData.manualLaneCooldownUntil = new Date(now.getTime() + 24 * 60 * 60 * 1000)
      updateData.manualLaneFloorColumn = normalizedBody.kanbanColumn
      updateData.manualLaneOverrideBy = normalizedBody.manualLaneOverrideBy || 'webapp-user'
      teachingWeight = 70
      outcomeValue = `Moved to ${normalizedBody.kanbanColumn}`
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
      updateData.declineReason = normalizedBody.declineReason || 'OTHER'
      updateData.declinedAt = new Date()
      updateData.declineCount = (existing.declineCount || 0) + 1
      updateData.feedbackScore = (existing.feedbackScore || 0) - 1
      teachingWeight = 100
      outcomeValue = normalizedBody.declineReason || 'DECLINED'
    }

    if (action === 'MODIFY') {
      const fields = ['entity_name', 'url', 'address', 'general_contact', 'size', 'industry',
                      'sport_or_sector', 'level_league', 'decision_maker_name', 'decision_maker_title',
                      'decision_maker_contact', 'value_proposition', 'notes', 'tags']
      fields.forEach(field => {
        if (normalizedBody[field] !== undefined) updateData[field] = normalizedBody[field]
      })
      if (normalizedBody[config.proField]) updateData[config.proField] = normalizedBody[config.proField]
      if (normalizedBody[config.conField]) updateData[config.conField] = normalizedBody[config.conField]

      if (normalizedBody.qualityStatus) {
        const currentLeadQuality = updateData.qualityStatus || existing.qualityStatus || 'DRAFT'
        const upstreamQuality = normalizedBody.upstreamQualityStatuses || ['DRAFT']

        const { enforceQualityCeiling } = await import('../../../lib/quality-registry')
        updateData.qualityStatus = enforceQualityCeiling(
          normalizedBody.qualityStatus,
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

    if (normalizedWarnings.length > 0) {
      console.warn('PATCH with normalization warnings', normalizedWarnings)
    }

    const result = await db.collection(config.dbCollection).findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: updateData },
      { returnDocument: 'after' }
    )

    const updatedLead = (result as any)?.value || (result as any)

    if (!updatedLead) {
      return NextResponse.json({ error: 'Lead not found after update' }, { status: 404 })
    }

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
      tenantId,
    })

    const normalizedLead = normalizeLead({ ...updatedLead, _id: updatedLead._id.toString() }, brand)
    return NextResponse.json({ success: true, lead: normalizedLead })

  } catch (error: any) {
    console.error('PATCH Error:', error)
    return NextResponse.json(
      { error: 'Failed to update lead', details: error.message },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic';
