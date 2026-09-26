import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb'
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api'
import { resolveBrand } from '../../../../lib/brand'
import { getTenantId } from '../../../../../lib/tenant'
import { getOrCreateSchedulingLinkToken } from '../../../../lib/scheduling-store'

export const dynamic = 'force-dynamic'

// Issue #229: returns this lead's public scheduling-link path. The link
// carries a random per-lead token, never the lead's _id, so a prospect who
// holds one link can't guess their way to another lead. Brand-gated like
// every other lead action; the token is created on first request and then
// reused, so every copy of the link stays valid.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const brand = await resolveBrand(new URL(request.url).searchParams.get('brand') || '')
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
  const authError = await requireBrandAccessApi(request, brand)
  if (authError) return authError
  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })

  try {
    const { id } = await params
    const client = await clientPromise
    const token = await getOrCreateSchedulingLinkToken(client.db(), brand, getTenantId(request), id)
    if (!token) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    return NextResponse.json({ path: `/schedule/${encodeURIComponent(brand)}?t=${token}` })
  } catch (error) {
    console.error('[API:leads/[id]/scheduling-link] POST error:', error)
    return NextResponse.json({ error: 'Failed to create the scheduling link' }, { status: 500 })
  }
}
