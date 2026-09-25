import { NextResponse } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb'
import { requireApiKey } from '../../../lib/api-auth'
import { getTenantId } from '../../../lib/tenant'
import { sanitizeAutomationRule, validateAutomationRule } from '../../../lib/automation-rules'
import { ensureAutomationIndexes, automationRuleToResponseShape, AUTOMATION_RULES_COLLECTION } from '../../lib/automation-store'

export const dynamic = 'force-dynamic'

function getBrand(request: Request): string {
  const url = new URL(request.url)
  const brand = (url.searchParams.get('brand') || '').trim()
  return brand || 'default'
}

// GET is unauthenticated, matching GET /api/cadences — read-only reference
// data, same trust level as this app's other per-brand config lists.
export async function GET(request: Request) {
  try {
    const tenantId = getTenantId(request)
    const brand = getBrand(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ rules: [], total: 0, source: 'default', brand })
    }

    const client = await clientPromise
    const db = client.db()
    const docs = await db.collection(AUTOMATION_RULES_COLLECTION).find({ tenantId, brand }).sort({ name: 1 }).toArray()
    const rules = docs.map(automationRuleToResponseShape)

    return NextResponse.json({ rules, total: rules.length, source: 'mongodb', brand })
  } catch (error: any) {
    console.error('[API:automation-rules] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch automation rules', details: error.message }, { status: 500 })
  }
}

// Write auth matches POST /api/cadences exactly (issue #201 §17: "same
// admin/session auth already gating /api/cadences") — requireApiKey, not a
// new pattern.
export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const tenantId = getTenantId(request)
    const brand = getBrand(request)
    const body = await request.json()

    const rule = sanitizeAutomationRule(body, brand, tenantId)
    const errors = validateAutomationRule(rule)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    await ensureAutomationIndexes(db)

    const { id: _id, ...doc } = rule
    const result = await db.collection(AUTOMATION_RULES_COLLECTION).insertOne({
      ...doc,
      firingCount: 0,
      createdAt: new Date(rule.createdAt),
      updatedAt: new Date(rule.updatedAt),
    })

    return NextResponse.json({
      ...rule,
      id: result.insertedId.toString(),
    }, { status: 201 })
  } catch (error: any) {
    console.error('[API:automation-rules] POST error:', error)
    return NextResponse.json({ error: 'Failed to create automation rule', details: error.message }, { status: 500 })
  }
}
