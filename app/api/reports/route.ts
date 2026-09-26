import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../lib/brand'
import { requireBrandAccessApi } from '../../../lib/require-brand-access-api'
import { getTenantId } from '../../../lib/tenant'
import { resolveSessionFromIdToken } from '../../../lib/session'
import { validateReportDefinitionInput, buildReportDefinition } from '../../../lib/report-definitions'
import { ensureReportIndexes, REPORT_DEFINITIONS_COLLECTION, reportDocToDefinition } from '../../lib/report-store'

// Issue #212 — ad-hoc report definitions CRUD, brand/tenant scoped exactly
// like GET /api/metrics.
async function resolveCreatedBy(request: NextRequest): Promise<string> {
  try {
    const idToken = request.cookies.get('sso_id_token')?.value
    const claims = await resolveSessionFromIdToken(idToken)
    return claims?.email || 'unknown'
  } catch {
    return 'unknown'
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const brand = await resolveBrand(searchParams.get('brand') || undefined)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const config = await getBrandConfig(brand)
    if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })

    const client = await getClientPromise()
    const db = client.db()
    const docs = await db.collection(REPORT_DEFINITIONS_COLLECTION)
      .find({ brand, tenantId })
      .sort({ updatedAt: -1 })
      .toArray()

    return NextResponse.json({ reports: docs.map(reportDocToDefinition), brand, tenantId })
  } catch (error: any) {
    console.error('GET /api/reports Error:', error)
    return NextResponse.json({ error: 'Failed to fetch reports' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const brand = await resolveBrand(searchParams.get('brand') || undefined)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const config = await getBrandConfig(brand)
    if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const tenantId = getTenantId(request)

    if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 })

    const body = await request.json().catch(() => ({}))
    const validation = validateReportDefinitionInput(body)
    if (!validation.valid) return NextResponse.json({ error: validation.errors.join('; ') }, { status: 400 })

    const createdBy = await resolveCreatedBy(request)
    const definition = buildReportDefinition(brand, tenantId, body, { createdBy })

    const client = await getClientPromise()
    const db = client.db()
    await ensureReportIndexes(db)
    await db.collection(REPORT_DEFINITIONS_COLLECTION).insertOne(definition)

    return NextResponse.json({ report: definition }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/reports Error:', error)
    return NextResponse.json({ error: 'Failed to create report' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
