import { NextResponse } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb'
import { requireApiKey } from '../../../lib/api-auth'
import { DEFAULT_OUTREACH_TEMPLATES } from '../../lib/outreach/default-templates'
import type { OutreachTemplate } from '../../lib/outreach/default-templates'
import { buildTaggedContentFilter, normalizeTags } from '../../lib/search/tagged-content-filter'
import { computeTemplateConversions } from '../../../lib/template-conversion'
import { ObjectId } from 'mongodb'
import { getTenantId } from '../../../lib/tenant'

export const dynamic = 'force-dynamic'

const SEARCH_TEXT_FIELDS = ['name', 'subject', 'body']

function getBrand(request: Request): string {
  const url = new URL(request.url)
  const brand = (url.searchParams.get('brand') || '').trim()
  return brand || 'default'
}

function getRequestedTags(searchParams: URLSearchParams): string[] {
  const raw = (searchParams.get('tags') || '').trim()
  if (!raw) return []
  return normalizeTags(raw.split(','))
}

// Shared by both the Mongo-configured and default-templates (no-Mongo)
// paths so `industry`/`channel`/`tags`/`q` behave identically regardless of
// which source the templates came from.
function matchesFilters(
  t: { channel: string; industry: string; tags?: string[]; name?: string; subject?: string; body?: string },
  opts: { industry?: string; channel?: string; tags?: string[]; q?: string }
): boolean {
  if (opts.channel && t.channel !== opts.channel) return false
  if (opts.industry && t.industry !== opts.industry) return false
  if (opts.tags && opts.tags.length > 0) {
    const templateTagsLower = (t.tags || []).map((tag) => tag.toLowerCase())
    const requestedLower = opts.tags.map((tag) => tag.toLowerCase())
    if (!requestedLower.some((tag) => templateTagsLower.includes(tag))) return false
  }
  if (opts.q) {
    const needle = opts.q.toLowerCase()
    const haystack = `${t.name || ''} ${t.subject || ''} ${t.body || ''}`.toLowerCase()
    if (!haystack.includes(needle)) return false
  }
  return true
}

export async function GET(request: Request) {
  try {
    const tenantId = getTenantId(request)
    const brand = getBrand(request)
    const { searchParams } = new URL(request.url)
    const industry = (searchParams.get('industry') || '').trim()
    const channel = (searchParams.get('channel') || '').trim()
    const q = (searchParams.get('q') || '').trim()
    const tags = getRequestedTags(searchParams)
    const mode = (searchParams.get('mode') || '').trim()

    if (mode === 'search') {
      if (!isMongoConfigured()) {
        const matched = DEFAULT_OUTREACH_TEMPLATES.filter((t: OutreachTemplate) =>
          matchesFilters(t, { industry, channel, tags, q })
        )
        return NextResponse.json({
          templates: matched,
          matchedOn: { q: q || undefined, tags: tags.length ? tags : undefined },
          total: matched.length,
          source: 'default',
        })
      }

      const client = await clientPromise
      const db = client.db()
      const filter = buildTaggedContentFilter({ tenantId, brand, q, tags, textFields: SEARCH_TEXT_FIELDS })
      const dbFiltered = await db.collection('outreach_templates').find(filter).sort({ name: 1 }).toArray()
      const matched = dbFiltered
        .map((t) => ({
          id: t._id.toString(),
          name: t.name,
          channel: t.channel,
          industry: t.industry,
          subject: t.subject,
          body: t.body,
          variables: t.variables,
          tags: t.tags || [],
        }))
        .filter((t) => matchesFilters(t, { industry, channel }))

      if (!matched.length) {
        console.warn('[API:outreach-templates] mode=search returned zero results', { q, tags, industry, channel, brand, tenantId })
      }

      return NextResponse.json({
        templates: matched,
        matchedOn: { q: q || undefined, tags: tags.length ? tags : undefined },
        total: matched.length,
        source: 'mongodb',
      })
    }

    if (mode === 'analytics') {
      if (!isMongoConfigured()) {
        return NextResponse.json({ analytics: [], total: 0, source: 'default' })
      }

      const client = await clientPromise
      const db = client.db()

      const match: Record<string, string> = { tenantId, brand }
      if (industry) match.industry = industry
      if (channel) match.channel = channel

      // Issue #75: fetched raw (not pre-aggregated) so the same records feed
      // both the existing volume totals and the new conversion-attribution
      // join below, without a second round trip.
      const outreachLogs = await db.collection('outreach_logs').find(match).toArray()

      const leadIds = Array.from(new Set(outreachLogs.map((log) => log.leadId).filter(Boolean)))
      const outcomeLogs = leadIds.length
        ? await db.collection('outcomelogs').find({
            tenantId,
            leadId: { $in: leadIds },
            'afterState.kanbanColumn': { $in: ['WON', 'LOST'] },
          }).toArray()
        : []

      const conversions = computeTemplateConversions(
        outreachLogs
          .filter((log) => log.templateId)
          .map((log) => ({ leadId: log.leadId, templateId: String(log.templateId), createdAt: log.createdAt })),
        outcomeLogs.map((log) => ({ leadId: log.leadId, afterState: log.afterState, createdAt: log.createdAt }))
      )

      const totalsByTemplate = new Map<string, { totalLogs: number; channels: Set<string>; lastUsed: Date | null }>()
      for (const log of outreachLogs) {
        if (!log.templateId) continue
        const templateId = String(log.templateId)
        let entry = totalsByTemplate.get(templateId)
        if (!entry) {
          entry = { totalLogs: 0, channels: new Set(), lastUsed: null }
          totalsByTemplate.set(templateId, entry)
        }
        entry.totalLogs += 1
        if (log.channel) entry.channels.add(log.channel)
        if (!entry.lastUsed || log.createdAt > entry.lastUsed) entry.lastUsed = log.createdAt
      }

      const templateIds = Array.from(totalsByTemplate.keys())

      const dbTemplates = templateIds.length
        ? await db.collection('outreach_templates').find({ tenantId, brand, _id: { $in: templateIds.map((id) => new ObjectId(id)) } }).toArray()
        : []

      const templateNameMap = new Map(dbTemplates.map((t) => [t._id.toString(), t.name]))

      const analytics = Array.from(totalsByTemplate.entries())
        .map(([templateId, entry]) => {
          const conv = conversions.get(templateId)
          return {
            templateId,
            name: templateNameMap.get(templateId) || `Template #${templateId}`,
            channel: Array.from(entry.channels)[0] || 'email',
            channels: Array.from(entry.channels),
            totalLogs: entry.totalLogs,
            lastUsed: entry.lastUsed ? entry.lastUsed.toISOString() : null,
            won: conv?.won ?? 0,
            lost: conv?.lost ?? 0,
            conversionRate: conv?.conversionRate ?? 0,
            declineRate: conv?.declineRate ?? 0,
          }
        })
        .sort((a, b) => b.totalLogs - a.totalLogs)

      return NextResponse.json({ analytics, total: analytics.length, source: 'mongodb', brand })
    }

    const hasAdditionalFilters = Boolean(industry || channel || q || tags.length)

    if (!isMongoConfigured()) {
      if (!hasAdditionalFilters) {
        return NextResponse.json({ templates: DEFAULT_OUTREACH_TEMPLATES, source: 'default', brand })
      }
      const matched = DEFAULT_OUTREACH_TEMPLATES.filter((t: OutreachTemplate) =>
        matchesFilters(t, { industry, channel, tags, q })
      )
      // Zero-match falls back to the full unfiltered list rather than a
      // blank state — matches the existing industry/channel behavior below,
      // extended to also cover tags/q.
      return NextResponse.json({ templates: matched.length ? matched : DEFAULT_OUTREACH_TEMPLATES, source: 'default', brand })
    }

    const client = await clientPromise
    const db = client.db()
    const templates = await db.collection('outreach_templates').find({ tenantId, brand }).sort({ name: 1 }).toArray()

    if (!templates.length) {
      const defaults = hasAdditionalFilters
        ? DEFAULT_OUTREACH_TEMPLATES.filter((t: OutreachTemplate) => matchesFilters(t, { industry, channel, tags, q }))
        : DEFAULT_OUTREACH_TEMPLATES
      return NextResponse.json({ templates: defaults.length ? defaults : DEFAULT_OUTREACH_TEMPLATES, source: 'default', brand })
    }

    const mapped = templates.map((t) => ({
      id: t._id.toString(),
      name: t.name,
      channel: t.channel,
      industry: t.industry,
      subject: t.subject,
      body: t.body,
      variables: t.variables,
      tags: t.tags || [],
    }))

    if (hasAdditionalFilters) {
      const matched = mapped.filter((t) => matchesFilters(t, { industry, channel, tags, q }))
      return NextResponse.json({ templates: matched.length ? matched : mapped, source: 'mongodb', brand })
    }

    return NextResponse.json({ templates: mapped, source: 'mongodb', brand })
  } catch (error: any) {
    console.error('[API:outreach-templates] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch templates', details: error.message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const tenantId = getTenantId(request)
    const brand = getBrand(request)
    const body = await request.json()

    const name = String(body.name || '').trim()
    const channel = String(body.channel || '').trim()
    const industry = String(body.industry || '').trim()
    const templateBody = String(body.body || '').trim()
    const subject = body.subject ? String(body.subject).trim() : undefined
    const variables = Array.isArray(body.variables) ? body.variables.filter((v: any) => typeof v === 'string' && v.trim()) : []
    const tags = normalizeTags(body.tags)

    if (!name || !channel || !templateBody) {
      return NextResponse.json({ error: 'name, channel, and body are required' }, { status: 400 })
    }

    if (!['email', 'linkedin'].includes(channel)) {
      return NextResponse.json({ error: 'channel must be email or linkedin' }, { status: 400 })
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()

    const template = {
      tenantId,
      brand,
      name,
      channel,
      industry,
      subject,
      body: templateBody,
      variables,
      tags,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    const result = await db.collection('outreach_templates').insertOne(template)

    return NextResponse.json({
      id: result.insertedId.toString(),
      ...template,
    }, { status: 201 })
  } catch (error: any) {
    console.error('[API:outreach-templates] POST error:', error)
    return NextResponse.json({ error: 'Failed to create template', details: error.message }, { status: 500 })
  }
}
