import { NextResponse, type NextRequest } from 'next/server'
import { ObjectId } from 'mongodb'
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'
import { resolveBrand } from '../../../lib/brand'
import { getTenantId, tenantFilter } from '../../../../lib/tenant'
import { sanitizeAutomationTrigger, sanitizeAutomationAction, validateAutomationRule } from '../../../../lib/automation-rules'
import { automationRuleToResponseShape, AUTOMATION_RULES_COLLECTION } from '../../../lib/automation-store'

export const dynamic = 'force-dynamic'

async function getBrand(request: NextRequest) {
  const url = new URL(request.url)
  return await resolveBrand((url.searchParams.get('brand') || '').trim())
}

// Scoped by brand as well as tenant (issue #227): an id belonging to another
// brand is a 404 here, never readable or writable through this brand's access.
async function findRule(db: any, id: string, tenantId: string, brand: string) {
  let objectId: ObjectId
  try {
    objectId = new ObjectId(id.trim())
  } catch {
    return null
  }
  return db.collection(AUTOMATION_RULES_COLLECTION).findOne({ _id: objectId, brand, ...tenantFilter(tenantId) })
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const doc = await findRule(db, id, tenantId, brand)
    if (!doc) {
      return NextResponse.json({ error: 'Automation rule not found' }, { status: 404 })
    }

    return NextResponse.json(automationRuleToResponseShape(doc))
  } catch (error: any) {
    console.error('[API:automation-rules/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch automation rule' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findRule(db, id, tenantId, brand)
    if (!existing) {
      return NextResponse.json({ error: 'Automation rule not found' }, { status: 404 })
    }

    const body = await request.json()

    // Partial update: only the provided top-level fields are validated and
    // written, defaulting to the existing value for anything omitted — same
    // contract as PUT /api/cadences/[id].
    const merged = {
      name: body.name !== undefined ? String(body.name).trim().slice(0, 200) : existing.name,
      trigger: body.trigger !== undefined ? sanitizeAutomationTrigger(body.trigger) : existing.trigger,
      action: body.action !== undefined ? sanitizeAutomationAction(body.action) : existing.action,
      enabled: body.enabled !== undefined ? body.enabled === true : existing.enabled === true,
    }

    const errors = validateAutomationRule(merged as any)
    if (errors.length > 0) {
      return NextResponse.json({ error: errors.join('; ') }, { status: 400 })
    }

    const updateData: Record<string, any> = { updatedAt: new Date() }
    if (body.name !== undefined) updateData.name = merged.name
    if (body.trigger !== undefined) updateData.trigger = merged.trigger
    if (body.action !== undefined) updateData.action = merged.action
    if (body.enabled !== undefined) updateData.enabled = merged.enabled

    const result = await db.collection(AUTOMATION_RULES_COLLECTION).findOneAndUpdate(
      { _id: existing._id, brand, ...tenantFilter(tenantId) },
      { $set: updateData },
      { returnDocument: 'after' }
    )

    if (!result) {
      return NextResponse.json({ error: 'Automation rule not found after update' }, { status: 404 })
    }

    return NextResponse.json(automationRuleToResponseShape(result))
  } catch (error: any) {
    console.error('[API:automation-rules/[id]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update automation rule' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findRule(db, id, tenantId, brand)
    if (!existing) {
      return NextResponse.json({ error: 'Automation rule not found' }, { status: 404 })
    }

    await db.collection(AUTOMATION_RULES_COLLECTION).deleteOne({ _id: existing._id, brand, ...tenantFilter(tenantId) })

    return NextResponse.json({ ok: true, id })
  } catch (error: any) {
    console.error('[API:automation-rules/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete automation rule' }, { status: 500 })
  }
}
