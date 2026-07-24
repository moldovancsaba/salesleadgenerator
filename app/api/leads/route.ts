import { NextResponse } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../lib/mongodb'
import { BRAND_CONFIG, resolveBrand, PRO_FIELD, CON_FIELD } from '../../lib/brand'
import { normalizeLead, extractWarnings } from '../../lib/normalize-lead'
import { requireApiKey } from '../../../lib/api-auth'
import { validateLeadPayload, validatePatchPayload, bestContactConfidence } from '../../../lib/validate-lead'
import { generateRequestId } from '../../lib/request-id'
import { executeLeadAction } from '../../lib/lead-actions'
import { deriveKanbanColumn } from '../../../lib/kanban-column'
import { buildFingerprint } from '../../../lib/fingerprint'
import { dedupeContacts } from '../../../lib/contacts'

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

// Shared JSON body reader for route handlers
async function readBody(request: Request) {
  return request.json()
}

type Brand = 'cogmap' | 'seyu';

// Ease scoring reads contacts[] only (no more top-level decision-maker
// fields — see lib/contacts.ts and issue #45). effectiveAddress is the
// organization-level address (contacts[] has never had a per-contact
// address field; a prior version of this function read one anyway, always
// false since dedup strips unknown keys — removed rather than kept as dead
// code with no behavioral difference).
function computeEase(body: any): number {
  const contacts: any[] = Array.isArray(body.contacts) ? body.contacts : [];
  const effectiveNamed = contacts.some((c: any) => typeof c?.name === 'string' && c.name.trim().length > 0);
  const effectiveEmail = contacts.some((c: any) => typeof c?.email === 'string' && c.email.trim().length > 0);
  const effectivePhone = contacts.some((c: any) => typeof c?.phone === 'string' && c.phone.trim().length > 0);
  const effectiveAddress = !!body.address;
  const hasGeneral = !!body.general_contact;

  if (!effectiveNamed && !hasGeneral) return 1;
  if (!effectiveNamed && hasGeneral) return 2;
  if (effectiveNamed && !effectiveEmail && !effectivePhone) return 3;
  if (effectiveNamed && effectiveAddress && !effectiveEmail && !effectivePhone) return 4;
  if (effectiveNamed && (effectiveEmail || effectivePhone) && !effectiveAddress) return 5;
  if (effectiveNamed && effectiveAddress && (effectiveEmail || effectivePhone) && !(effectiveEmail && effectivePhone)) return 6;
  if (effectiveNamed && effectiveAddress && effectiveEmail && effectivePhone) return 7;
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
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || url.pathname.split('/')[2] || 'cogmap';
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
    const limit = Math.max(1, Math.min(5000, parseInt(searchParams.get('limit') || '5000') || 5000))
    const page = Math.max(1, parseInt(searchParams.get('page') || '1') || 1)
    const skip = (page - 1) * limit
    const cursor = searchParams.get('cursor') || undefined

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()

    // Backward-compatible tenant filter: include legacy docs without tenantId when querying default
    let filter: any = {}
    if (tenantId === 'default') {
      filter = { $or: [{ tenantId: 'default' }, { tenantId: { $exists: false } }] }
    } else {
      filter = { tenantId }
    }
    if (region) filter.region = region
    if (kanbanColumn) filter.kanbanColumn = kanbanColumn

    const totalCount = await db.collection(config.dbCollection).countDocuments(filter)

    let rawLeads: any[]
    let hasMore = false
    let nextCursor: string | undefined

    if (cursor !== undefined) {
      // Opt-in cursor pagination (the same shape /api/leads/columns and
      // /api/search use): sorts by createdAt desc, _id desc as a tie-break —
      // matching the createdAt-desc order the dedup step below already
      // produces regardless of the legacy sort. This path only activates
      // when a caller actually sends `cursor`, so the legacy page/skip path
      // — still used by the research agent's one-shot `?limit=1000` listing
      // call, an external consumer this repo doesn't control — is completely
      // untouched for anyone who doesn't opt in.
      let cursorFilter: Record<string, any> = {}
      const [createdAtStr, id] = cursor.split('|')
      const createdAtMs = Number(createdAtStr)
      const { ObjectId } = await import('mongodb')
      const idObj = ObjectId.isValid(id) ? new ObjectId(id) : undefined
      if (Number.isFinite(createdAtMs) && idObj) {
        cursorFilter = {
          $or: [
            { createdAt: { $lt: new Date(createdAtMs) } },
            { createdAt: new Date(createdAtMs), _id: { $lt: idObj } },
          ],
        }
      }

      rawLeads = await db.collection(config.dbCollection)
        .find({ $and: [filter, cursorFilter] })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit)
        .toArray()

      hasMore = rawLeads.length >= limit
      const last = rawLeads[rawLeads.length - 1]
      nextCursor = hasMore && last ? `${new Date(last.createdAt).getTime()}|${last._id.toString()}` : undefined
    } else {
      rawLeads = await db.collection(config.dbCollection)
        .find(filter)
        .sort({ kanbanColumn: 1, sortOrder: 1, createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .toArray()
      hasMore = skip + rawLeads.length < totalCount
    }

    // UI dedup: collapse duplicate fingerprints to the newest document per fingerprint
    const byFingerprint = new Map<string, any>()
    for (const lead of rawLeads) {
      const fp = lead.fingerprint || lead._id.toString()
      const existing = byFingerprint.get(fp)
      if (!existing || new Date(lead.createdAt) > new Date(existing.createdAt)) {
        byFingerprint.set(fp, lead)
      }
    }
    const dedupedLeads = Array.from(byFingerprint.values())
      .sort((a, b) => {
        const ac = a.createdAt ? new Date(a.createdAt).getTime() : 0
        const bc = b.createdAt ? new Date(b.createdAt).getTime() : 0
        return bc - ac
      })

    return NextResponse.json({
      // contacts[] is the single source of truth for contact data — no more
      // top-level decision-maker fields to reconcile/blank (see lib/contacts.ts,
      // issue #45). A legacy stored document that still has the old fields
      // (pre-migration) simply has them ignored here, not read into the response.
      leads: dedupedLeads.map((l) => {
        const normalized = normalizeLead({ ...l, _id: l._id.toString() })
        normalized.contacts = dedupeContacts(normalized.contacts || [])
        return normalized
      }),
      brand,
      tenantId,
      returned: dedupedLeads.length,
      total: totalCount,
      page,
      limit,
      totalPages: Math.ceil(totalCount / limit),
      hasMore,
      nextCursor,
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

    const body = await readBody(request)
    const validation = validateLeadPayload(body, brand);
    if (!validation.valid) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 });
    }

    // Normalize address (org-level, unrelated to contacts[])
    if (body.address) {
      body.address = normalizeAddress(body.address, body.country || 'US')
    }

    const client = await getClientPromise()
    const db = client.db()

    const normalizedBody = normalizeLead(body)
    const normalizedWarnings = extractWarnings(normalizedBody)

    // contacts[] is the single source of truth for contact data — dedupeContacts
    // also applies per-contact phone/email formatting (lib/contacts.ts).
    normalizedBody.contacts = dedupeContacts(normalizedBody.contacts || [])

    const fingerprint = buildFingerprint(
      normalizedBody.entity_name || normalizedBody.name || '',
      normalizedBody.url || '',
      normalizedBody.region || 'US'
    )

    // Match both exact tenantId and legacy docs without tenantId to prevent duplicates
    const existing = await db.collection(config.dbCollection).findOne({
      fingerprint,
      $or: [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: 'default' }],
    })
    if (existing) {
      return NextResponse.json(
        { error: 'Duplicate lead detected', existing: { _id: existing._id, entity_name: existing.entity_name } },
        { status: 409 }
      )
    }

    // Hard-enforce no duplicate fingerprints for this tenant.
    // The schema index is currently non-unique, so we dedupe here before insert.
    const duplicateCandidates = await db.collection(config.dbCollection)
      .find({ fingerprint, tenantId })
      .sort({ createdAt: -1 })
      .limit(10)
      .toArray()
    if (duplicateCandidates.length > 1) {
      const keep = duplicateCandidates[0]
      const removeIds = duplicateCandidates.slice(1).map((d: any) => d._id)
      await db.collection(config.dbCollection).deleteMany({ _id: { $in: removeIds } })
      console.warn(`Deduplicated ${removeIds.length} duplicate lead(s) for fingerprint=${fingerprint}`)
    }

    const impact = normalizedBody.ice?.impact || normalizedBody.impact || 5
    const confidence = normalizedBody.ice?.confidence || normalizedBody.confidence || 5
    const ease = computeEase(normalizedBody)

    const iceScore = computeIceScore(impact, confidence, ease)
    const scoreProfile = buildScoreProfile(impact, confidence, ease)

    const contactQuality = bestContactConfidence(normalizedBody.contacts || [])
    const hasVerifiedDecisionMaker = contactQuality >= 5

    if ((confidence < 6 || ease < 4) && !hasVerifiedDecisionMaker && ease < 3) {
      return NextResponse.json(
        {
          error: 'Quality gate: very low ease or confidence requires a verified decision-maker contact',
          details: {
            confidence,
            ease,
            contactQuality,
            requirement: 'At least 1 contact with email/phone/Linkedin confidence >= 5 when ease < 3 or confidence < 5',
          },
        },
        { status: 422 }
      )
    }

    const kanbanColumn = normalizedBody.kanbanColumn || deriveKanbanColumn(iceScore)

    const count = await db.collection(config.dbCollection).countDocuments({ kanbanColumn, tenantId })

    const newLead = {
      id: Date.now(),
      region: normalizedBody.region || 'US',
      entity_name: normalizedBody.entity_name || normalizedBody.name,
      url: normalizedBody.url || '',
      contacts: normalizedBody.contacts || [],
      address: normalizedBody.address || '',
      general_contact: normalizedBody.general_contact || '',
      size: normalizedBody.size || '',
      industry: normalizedBody.industry || '',
      sport_or_sector: normalizedBody.sport_or_sector || '',
      level_league: normalizedBody.level_league || '',
      [PRO_FIELD]: normalizedBody[PRO_FIELD] || [],
      [CON_FIELD]: normalizedBody[CON_FIELD] || [],
      value_proposition: normalizedBody.value_proposition || '',
      recommended_tier: normalizedBody.recommended_tier || '',
      estimated_participants: Number(normalizedBody.estimated_participants) || 0,
      estimated_annual_revenue_usd: Number(normalizedBody.estimated_annual_revenue_usd) || 0,
      revenue_model: normalizedBody.revenue_model || '',
      product_fit_notes: normalizedBody.product_fit_notes || '',
      pricingByCompany: normalizedBody.pricingByCompany || {},
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
  const requestId = generateRequestId();
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const brand = getBrand(request);
    const tenantId = getTenantId(request);

    const body = await readBody(request)
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'Missing id', requestId }, { status: 400 })
    }

    const action = String(body.action || '').toUpperCase()
    const allowed = new Set(['ACCEPT', 'DECLINE', 'MODIFY', 'PIN', 'REQUEST_REFRESH', 'COLUMN_MOVE'])
    if (!allowed.has(action)) {
      return NextResponse.json({ error: `Unsupported action: ${action}` }, { status: 400 })
    }

    const result = await executeLeadAction({
      leadId: id,
      action: action as any,
      brand,
      tenantId,
      payload: body,
    })

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Action failed', requestId }, { status: 400 })
    }

    return NextResponse.json({ success: true, lead: result.lead, requestId })
  } catch (error: any) {
    console.error('PATCH Error:', error)
    return NextResponse.json(
      { error: 'Failed to update lead', details: error.message, requestId },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic';
