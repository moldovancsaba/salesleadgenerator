import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb'
import { requireSuperAdminSession } from '../../../../../lib/session'
import { resolveBrand } from '../../../../lib/brand'
import { deleteWebhook, setWebhookEnabled } from '../../../../lib/webhook-store'

// Issue #210 sub-issue #219 — hard delete (not soft), matching #210 §10's
// own explicit contract: a removed subscription stops immediately and
// never appears in a future listing.
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
  const deleted = await deleteWebhook(db, id, brand)
  if (!deleted) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

  return new NextResponse(null, { status: 204 })
}

// { enabled: boolean } — lets an admin manually re-enable a webhook the
// dead-letter policy auto-disabled, once the endpoint is fixed (#210 §10).
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const brand = await resolveBrand(searchParams.get('brand') || undefined)
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })

  const body = await request.json().catch(() => ({}))
  if (typeof body.enabled !== 'boolean') return NextResponse.json({ error: 'enabled (boolean) is required' }, { status: 400 })

  const client = await clientPromise
  const db = client.db()
  const updated = await setWebhookEnabled(db, id, brand, body.enabled)
  if (!updated) return NextResponse.json({ error: 'Webhook not found' }, { status: 404 })

  return new NextResponse(null, { status: 204 })
}

export const dynamic = 'force-dynamic'
