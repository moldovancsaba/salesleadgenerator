import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb'
import { requireSuperAdminSession } from '../../../../lib/session'
import { resolveBrand } from '../../../lib/brand'
import { validateCreateWebhookInput } from '../../../../lib/webhooks'
import { createWebhook, listWebhooks } from '../../../lib/webhook-store'

// Issue #210 sub-issue #219 — outbound webhook subscription management.
// Session-only (requireSuperAdminSession), deliberately never
// x-api-key-accessible — same "a key must never mint/read another key's
// data" rule #210 §17 already applies to /api/admin/api-keys.
export async function GET(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })

  const { searchParams } = new URL(request.url)
  const brand = await resolveBrand(searchParams.get('brand') || undefined)
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })

  const client = await clientPromise
  const db = client.db()
  const webhooks = await listWebhooks(db, brand)

  return NextResponse.json({ webhooks, brand })
}

export async function POST(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })

  const body = await request.json().catch(() => ({}))
  const brand = await resolveBrand(body.brand)
  const validation = validateCreateWebhookInput(body, brand)
  if (!validation.valid) return NextResponse.json({ error: validation.errors.join('; ') }, { status: 400 })

  const client = await clientPromise
  const db = client.db()
  const result = await createWebhook(db, validation.value, claimsOrResponse.email || 'unknown')
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 })

  // rawSecret is present in this one response only — never persisted raw,
  // never logged, never re-derivable from the stored encryptedSecret
  // (issue #210 §9/§17).
  return NextResponse.json({ webhook: result.record, secret: result.rawSecret }, { status: 201 })
}

export const dynamic = 'force-dynamic'
