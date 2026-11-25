import { NextRequest, NextResponse } from 'next/server'
import clientPromise from '@/lib/mongodb'
import { requireBrandAdminSession } from '@/lib/session'
import { isSuperAdminEmail } from '@/lib/sso-access'
import { resolveBrand, type Brand } from '@/app/lib/brand'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

async function authorizeToggleAccess(
  request: NextRequest,
  rawBrand: string,
  rawTenantId: string,
): Promise<{ ok: false; error: NextResponse } | { ok: true; brand: Brand }> {
  const brand = await resolveBrand(rawBrand)
  if (!brand) return { ok: false, error: NextResponse.json({ error: 'Invalid brand' }, { status: 400 }) }
  const claimsOrResponse = await requireBrandAdminSession(request, brand)
  if (claimsOrResponse instanceof NextResponse) return { ok: false, error: claimsOrResponse }
  if (!isSuperAdminEmail(claimsOrResponse.email) && rawTenantId !== brand) {
    return { ok: false, error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, brand }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json()
    const rawBrand = body.brand || 'cogmap'
    const tenantId = body.tenantId || rawBrand
    const auth = await authorizeToggleAccess(request, rawBrand, tenantId)
    if (!auth.ok) return auth.error
    const { brand } = auth
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
    return NextResponse.json({ error: 'Failed to update toggle' }, { status: 500 })
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url)
    const rawBrand = searchParams.get('brand') || 'cogmap'
    const tenantId = searchParams.get('tenantId') || rawBrand
    const auth = await authorizeToggleAccess(request, rawBrand, tenantId)
    if (!auth.ok) return auth.error
    const { brand } = auth

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
    return NextResponse.json({ error: 'Failed to fetch toggles' }, { status: 500 })
  }
}
