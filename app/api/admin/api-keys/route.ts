import { NextResponse, type NextRequest } from 'next/server'
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb'
import { requireSuperAdminSession } from '../../../../lib/session'
import { resolveBrand } from '../../../lib/brand'
import { validateCreateApiKeyInput } from '../../../../lib/scoped-api-keys'
import { createApiKey, listApiKeys } from '../../../lib/api-key-store'

// Issue #210, Phase 1 — scoped API key management. Session-only
// (requireSuperAdminSession), deliberately never x-api-key-accessible: a
// key must never be able to mint or read other keys' metadata (issue
// #210 §17's own explicit requirement).
export async function GET(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })

  const { searchParams } = new URL(request.url)
  const brand = await resolveBrand(searchParams.get('brand') || undefined)
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })

  const client = await clientPromise
  const db = client.db()
  const keys = await listApiKeys(db, brand)

  return NextResponse.json({ keys, brand })
}

export async function POST(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request)
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })

  const body = await request.json().catch(() => ({}))
  const brand = await resolveBrand(body.brand)
  const validation = validateCreateApiKeyInput(body, brand)
  if (!validation.valid) return NextResponse.json({ error: validation.errors.join('; ') }, { status: 400 })

  const client = await clientPromise
  const db = client.db()
  const { record, rawKey } = await createApiKey(db, validation.value, claimsOrResponse.email || 'unknown')

  // rawKey is present in this one response only — never persisted, never
  // logged, never re-derivable from the stored hashedKey (issue #210 §9/§17).
  return NextResponse.json({ key: { ...record, hashedKey: undefined }, rawKey }, { status: 201 })
}

export const dynamic = 'force-dynamic'
