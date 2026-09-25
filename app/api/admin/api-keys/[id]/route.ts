import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb'
import { requireSuperAdminSession } from '../../../../../lib/session'
import { resolveBrand } from '../../../../lib/brand'
import { revokeApiKey } from '../../../../lib/api-key-store'

// Issue #210 — revoking a key sets revokedAt immediately; the very next
// request using it fails closed (lib/require-brand-access-api.ts). No
// "unrevoke" — a revoked key is permanently dead, per §13's own explicit
// UX contract.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const brand = await resolveBrand(searchParams.get('brand') || undefined)
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })

  const client = await clientPromise
  const db = client.db()
  const revoked = await revokeApiKey(db, id, brand)
  if (!revoked) return NextResponse.json({ error: 'Key not found or already revoked' }, { status: 404 })

  return new NextResponse(null, { status: 204 })
}

export const dynamic = 'force-dynamic'
