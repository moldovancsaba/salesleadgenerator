import { NextResponse } from 'next/server'
import { BRAND_CONFIG } from '../../lib/brand'

function getTenantId(request: Request): string {
  const url = new URL(request.url)
  const tenantId = (url.searchParams.get('tenantId') || 'default').trim()
  return tenantId || 'default'
}

function tenantFilter(tenantId: string) {
  return tenantId === 'default'
    ? { $or: [{ tenantId: 'default' }, { tenantId: { $exists: false } }] }
    : { tenantId }
}

export async function GET(request: Request) {
  try {
    const tenantId = getTenantId(request)
    const filter = tenantFilter(tenantId)
    const boards = Object.entries(BRAND_CONFIG).map(([brandKey, config]) => ({
      brand: brandKey,
      label: config.label,
      apiPrefix: config.apiPrefix,
      dbCollection: config.dbCollection,
      proField: config.proField,
      conField: config.conField,
    }))

    return NextResponse.json({
      boards,
      tenantId,
      defaultBoard: 'cogmap',
      source: 'config',
      fetchedAt: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('[API:boards] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch boards', details: error.message }, { status: 500 })
  }
}
