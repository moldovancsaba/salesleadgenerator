import { NextResponse } from 'next/server'
import { ObjectId } from 'mongodb'
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb'
import { requireApiKey } from '../../../../lib/api-auth'
import { getTenantId, tenantFilter } from '../../../../lib/tenant'
import { sanitizeAutomationTrigger, sanitizeAutomationAction, validateAutomationRule } from '../../../../lib/automation-rules'
import { automationRuleToResponseShape, AUTOMATION_RULES_COLLECTION } from '../../../lib/automation-store'

export const dynamic = 'force-dynamic'

async function findRule(db: any, id: string, tenantId: string) {
  let objectId: ObjectId
  try {
    objectId = new ObjectId(id.trim())
  } catch {
    return null
  }
  return db.collection(AUTOMATION_RULES_COLLECTION).findOne({ _id: objectId, ...tenantFilter(tenantId) })
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const doc = await findRule(db, id, tenantId)
    if (!doc) {
      return NextResponse.json({ error: 'Automation rule not found' }, { status: 404 })
    }

    return NextResponse.json(automationRuleToResponseShape(doc))
  } catch (error: any) {
    console.error('[API:automation-rules/[id]] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch automation rule', details: error.message }, { status: 500 })
  }
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findRule(db, id, tenantId)
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
      { _id: existing._id, ...tenantFilter(tenantId) },
      { $set: updateData },
      { returnDocument: 'after' }
    )

    if (!result) {
      return NextResponse.json({ error: 'Automation rule not found after update' }, { status: 404 })
    }

    return NextResponse.json(automationRuleToResponseShape(result))
  } catch (error: any) {
    console.error('[API:automation-rules/[id]] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update automation rule', details: error.message }, { status: 500 })
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const { id } = await params
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await clientPromise
    const db = client.db()
    const existing = await findRule(db, id, tenantId)
    if (!existing) {
      return NextResponse.json({ error: 'Automation rule not found' }, { status: 404 })
    }

    await db.collection(AUTOMATION_RULES_COLLECTION).deleteOne({ _id: existing._id, ...tenantFilter(tenantId) })

    return NextResponse.json({ ok: true, id })
  } catch (error: any) {
    console.error('[API:automation-rules/[id]] DELETE error:', error)
    return NextResponse.json({ error: 'Failed to delete automation rule', details: error.message }, { status: 500 })
  }
}
