import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb'
import { resolveBrand, type Brand } from '@/app/lib/brand'
import { requireBrandAccessApi } from '@/lib/require-brand-access-api'
import { resolveSessionFromIdToken } from '@/lib/session'
import { listAllUserAccess, hasAccessToBrand, getRoleForBrand } from '@/lib/sso-access'

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url)
  return await resolveBrand(url.searchParams.get('brand') || 'cogmap')
}

// Lead ownership (issue: CRM Lead ownership) — brand-scoped subset of
// GET /api/admin/users (which is super-admin-only and returns every user's
// access across every brand). Any user who can already see this brand's
// leads needs to see who they can hand one to or self-assign as — this
// deliberately does NOT require super-admin, unlike the admin listing.
// Also returns the caller's own resolved role for this brand so the
// assignee-picker UI can disable "assign to someone else" with a visible
// reason for a non-admin (CLAUDE.md Rule 7 — no live-looking control that
// silently fails) rather than only discovering the 403 after the attempt.
export async function GET(request: NextRequest) {
  try {
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const client = await getClientPromise()
    const db = client.db()
    const all = await listAllUserAccess(db)
    const users = all
      .filter((u) => hasAccessToBrand(u.email, u.orgAccess, brand))
      .map((u) => ({ ssoUserId: u.ssoUserId, email: u.email, name: u.name }))

    // Resolved separately from requireBrandAccessApi above (which only
    // returns a NextResponse-or-null, discarding the claims it verified)
    // rather than changing that shared guard's return contract — same
    // pattern as app/api/leads/route.ts's PATCH handler. Absent for an
    // x-api-key caller, which has no per-user role to report.
    const idToken = request.cookies.get('sso_id_token')?.value
    const claims = await resolveSessionFromIdToken(idToken)
    const callerRecord = claims ? all.find((u) => u.ssoUserId === claims.sub) : undefined
    const callerRole = claims ? getRoleForBrand(claims.email, callerRecord?.orgAccess, brand) : null

    return NextResponse.json({
      users,
      callerSsoUserId: claims?.sub ?? null,
      callerRole,
    })
  } catch (error: any) {
    console.error('GET /api/leads/assignable-users Error:', error)
    return NextResponse.json({ error: 'Failed to fetch assignable users', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
