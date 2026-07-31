import { NextRequest, NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { requireSuperAdminSession } from '@/lib/session'
import { resolveBrand } from '@/app/lib/brand'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export async function PUT(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  try {
    const body = await request.json()
    const brand = resolveBrand(body.brand || 'cogmap')
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const tenantId = body.tenantId || brand
    const operation = body.operation
    const enabled = body.enabled

    if (!operation || !['discovery', 'enrichment'].includes(operation)) {
      return NextResponse.json({ error: 'operation required: discovery or enrichment' }, { status: 400 })
    }
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ error: 'MongoDB not configured' }, { status: 500 })
    }

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection('tenant_operations')

    await collection.updateOne(
      { brand, tenantId, operation },
      { $set: { enabled, updatedAt: new Date().toISOString() } },
      { upsert: true }
    )

    // Also persist to tenants.json so cron-generator picks up changes immediately
    const tenantsPath = join(process.cwd(), '..', 'Agents', 'contentcreator', 'tenants.json')
    try {
      const raw = readFileSync(tenantsPath, 'utf-8')
      const tenants = JSON.parse(raw)
      const key = tenantId === brand ? brand : tenantId
      if (tenants.tenants?.[key]?.[operation]) {
        tenants.tenants[key][operation].enabled = enabled
        writeFileSync(tenantsPath, JSON.stringify(tenants, null, 2) + '\n', 'utf-8')
      }
    } catch (_e) {
      // tenants.json update is best-effort; cron uses MongoDB too on next read
    }

    return NextResponse.json({ ok: true, brand, tenantId, operation, enabled, updatedAt: new Date().toISOString() })
  } catch (error: any) {
    console.error('[API:admin:toggle] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update toggle', details: error.message }, { status: 500 })
  }
}

export async function GET(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  try {
    const { searchParams } = new URL(request.url)
    const brand = resolveBrand(searchParams.get('brand') || 'cogmap')
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const tenantId = searchParams.get('tenantId') || brand

    if (!process.env.MONGODB_URI) {
      return NextResponse.json({ error: 'MongoDB not configured' }, { status: 500 })
    }

    const client = await clientPromise
    const db = client.db()
    const collection = db.collection('tenant_operations')

    const docs = await collection.find({ brand, tenantId }).toArray()
    const toggles: Record<string, boolean> = {}
    for (const doc of docs) {
      toggles[(doc as any).operation] = (doc as any).enabled
    }

    return NextResponse.json({ toggles, brand, tenantId })
  } catch (error: any) {
    console.error('[API:admin:toggle] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch toggles', details: error.message }, { status: 500 })
  }
}
