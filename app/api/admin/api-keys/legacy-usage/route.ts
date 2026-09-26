import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb'
import { requireSuperAdminSession } from '../../../../../lib/session'
import { summarizeLegacyKeyUsage } from '../../../../../lib/legacy-key-usage'

export const dynamic = 'force-dynamic'

// Issue #220: which routes still receive the shared SLG_API_KEY, over the
// last ?days= (default 30, max 120 — the retention window). Session-only,
// like the rest of key management: a key must never read key telemetry.
export async function GET(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })

  const days = Math.min(120, Math.max(1, parseInt(new URL(request.url).searchParams.get('days') || '30', 10) || 30))
  const client = await clientPromise
  const usage = await summarizeLegacyKeyUsage(client.db(), days)
  return NextResponse.json({ days, usage })
}
