import { NextRequest, NextResponse } from 'next/server'
import { getTenantId } from '@/lib/tenant'
import { resolveBrand, getBrandConfig } from '@/app/lib/brand'
import { requireBrandAccessApi } from '@/lib/require-brand-access-api'
import { resolveSessionFromIdToken } from '@/lib/session'
import { getUserAccess, getRoleForBrand } from '@/lib/sso-access'
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb'
import { isValidPeriod, PERIOD_TYPES } from '@/lib/quota'
import type { PeriodType } from '@/lib/quota'
import { getQuotaAttainment } from '@/app/lib/quota-store'

// Quota tracking (issue #204) — a rep can always see their own attainment
// (the rep-facing tile); viewing someone else's requires the caller's own
// brand role to be admin, the same "self always allowed, cross-user needs
// admin" split lib/lead-assignment.ts's canAssign() already established for
// reassignment. No x-api-key path — attainment is a browser-session-only
// read, same as /api/leads/assignable-users.
export async function GET(request: NextRequest, { params }: { params: Promise<{ brand: string }> }) {
  try {
    const { brand: brandParam } = await params
    const brand = await resolveBrand(brandParam)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError
    const brandConfig = await getBrandConfig(brand)
    if (!brandConfig) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })

    const tenantId = getTenantId(request)
    const { searchParams } = new URL(request.url)
    const period = searchParams.get('period') || ''
    const periodType = searchParams.get('periodType') as PeriodType
    const requestedUserId = searchParams.get('userId') || ''

    if (!PERIOD_TYPES.includes(periodType)) {
      return NextResponse.json({ error: 'periodType must be one of: ' + PERIOD_TYPES.join(', ') }, { status: 400 })
    }
    if (!isValidPeriod(period, periodType)) {
      return NextResponse.json({ error: `period is not a valid ${periodType} period` }, { status: 400 })
    }

    const idToken = request.cookies.get('sso_id_token')?.value
    const claims = await resolveSessionFromIdToken(idToken)
    if (!claims) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const userId = requestedUserId || claims.sub
    if (userId !== claims.sub) {
      if (!isMongoConfigured()) {
        return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
      }
      const client = await getClientPromise()
      const db = client.db()
      const actorRecord = await getUserAccess(db, claims.sub)
      const actorBrandRole = getRoleForBrand(claims.email, actorRecord?.orgAccess, brand)
      if (actorBrandRole !== 'admin') {
        return NextResponse.json({ error: 'Only a brand admin can view another user\'s quota attainment' }, { status: 403 })
      }
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()
    const attainment = await getQuotaAttainment(db, brand, tenantId, userId, period, periodType)
    if (!attainment) {
      return NextResponse.json({ error: 'Invalid period' }, { status: 400 })
    }

    return NextResponse.json({ attainment })
  } catch (error: any) {
    console.error('GET /api/quota/[brand]/attainment Error:', error)
    return NextResponse.json({ error: 'Failed to fetch quota attainment', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
