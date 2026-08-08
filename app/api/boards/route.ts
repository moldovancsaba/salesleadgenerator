import { NextResponse } from 'next/server'
import { BRAND_CONFIG, PRO_FIELD, CON_FIELD } from '../../lib/brand'
import { requireApiKey } from '../../../lib/api-auth'

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

// Issue #178 — this legacy route (no frontend caller; the live UI uses
// GET /api/boards/[brand] instead) had no auth check at all. Gated the same
// way every other data-exposing admin route already is.
export async function GET(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  try {
    const tenantId = getTenantId(request)
    const filter = tenantFilter(tenantId)
    const boards = Object.entries(BRAND_CONFIG).map(([brandKey, config]) => ({
      brand: brandKey,
      label: config.label,
      apiPrefix: config.apiPrefix,
      dbCollection: config.dbCollection,
      proField: PRO_FIELD,
      conField: CON_FIELD,
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
