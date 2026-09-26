import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../lib/mongodb'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { resolveBrand } from '../../lib/brand'
import { getTenantId } from '../../../lib/tenant'
import { sanitizeAutomationRule, validateAutomationRule } from '../../../lib/automation-rules'
import { ensureAutomationIndexes, automationRuleToResponseShape, AUTOMATION_RULES_COLLECTION } from '../../lib/automation-store'

export const dynamic = 'force-dynamic'

// Resolves ?brand= (slug or alias) to the real slug, so a rule is always
// stored under the same key evaluateEventRules/runStaleTickForBrand query by
// (issue #227). A missing value resolves to 'cogmap'; an unknown one → null.
async function getBrand(request: NextRequest) {
  const url = new URL(request.url)
  return await resolveBrand((url.searchParams.get('brand') || '').trim())
}

// Every handler is gated by requireBrandAccessApi (issue #227): the SSO
// session the Automation page already carries, or the legacy/scoped
// x-api-key for machine callers.
export async function GET(request: NextRequest) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = getTenantId(request)

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
    return NextResponse.json({ error: 'Failed to fetch automation rules' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = getTenantId(request)
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
    return NextResponse.json({ error: 'Failed to create automation rule' }, { status: 500 })
  }
}
