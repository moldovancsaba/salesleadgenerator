import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../../../lib/brand'
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api'
import { getTenantId } from '../../../../../lib/tenant'
import { REPORT_DEFINITIONS_COLLECTION, reportDocToDefinition, runReportDefinition } from '../../../../lib/report-store'

// Issue #212 — executes a stored definition's pipeline now. Never mutates
// schedule.nextRunAt (only the tick route advances that).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
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
    const doc = await db.collection(REPORT_DEFINITIONS_COLLECTION).findOne({ brand, tenantId, id })
    if (!doc) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    const definition = reportDocToDefinition(doc)
    const rows = await runReportDefinition(db, config.dbCollection, definition)

    return NextResponse.json({ rows, metric: definition.metric, groupBy: definition.groupBy })
  } catch (error: any) {
    console.error('POST /api/reports/[id]/run Error:', error)
    return NextResponse.json({ error: 'Failed to run report', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
