import { NextResponse } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { requireApiKey } from '../../../lib/api-auth'
import { DEFAULT_OUTREACH_TEMPLATES } from '../../lib/outreach/default-templates'
import type { OutreachTemplate } from '../../lib/outreach/default-templates'

export const dynamic = 'force-dynamic'

function getTenantId(request: Request): string {
  const url = new URL(request.url)
  const tenantId = (url.searchParams.get('tenantId') || 'default').trim()
  return tenantId || 'default'
}

function getBrand(request: Request): string {
  const url = new URL(request.url)
  const brand = (url.searchParams.get('brand') || '').trim()
  return brand || 'default'
}

export async function GET(request: Request) {
  try {
    const tenantId = getTenantId(request)
    const brand = getBrand(request)
    const { searchParams } = new URL(request.url)
    const industry = (searchParams.get('industry') || '').trim()
    const channel = (searchParams.get('channel') || '').trim()

    if (!isMongoConfigured()) {
      const defaults = DEFAULT_OUTREACH_TEMPLATES.filter((t: OutreachTemplate) => {
        if (industry && t.industry !== industry) return false
        if (channel && t.channel !== channel) return false
        return true
      })
      return NextResponse.json({ templates: defaults, source: 'default', brand })
    }

    const client = await clientPromise
    const db = client.db()
    const filter: Record<string, string> = { tenantId, brand }
    if (industry) filter.industry = industry
    if (channel) filter.channel = channel

    const templates = await db.collection('outreach_templates').find(filter).sort({ name: 1 }).toArray()

    return NextResponse.json({
      templates: templates.map((t) => ({
        id: t._id.toString(),
        name: t.name,
        channel: t.channel,
        industry: t.industry,
        subject: t.subject,
        body: t.body,
        variables: t.variables,
      })),
      source: 'mongodb',
      brand,
    })
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

function isMongoConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI || process.env.MONGODB_URI_LEADS || process.env.MONGODB_URI_CLASSCOUT)
}
