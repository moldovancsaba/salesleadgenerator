import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { getBrandConfig, resolveBrand } from '../../../lib/brand'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'
import { getTenantId } from '../../../../lib/tenant'
import { validateReportDefinitionInput, buildReportDefinition } from '../../../../lib/report-definitions'
import { REPORT_DEFINITIONS_COLLECTION, reportDocToDefinition } from '../../../lib/report-store'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

    return NextResponse.json({ report: reportDocToDefinition(doc) })
  } catch (error: any) {
    console.error('GET /api/reports/[id] Error:', error)
    return NextResponse.json({ error: 'Failed to fetch report', details: error.message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const existingDoc = await db.collection(REPORT_DEFINITIONS_COLLECTION).findOne({ brand, tenantId, id })
    if (!existingDoc) return NextResponse.json({ error: 'Report not found' }, { status: 404 })
    const existing = reportDocToDefinition(existingDoc)

    const body = await request.json().catch(() => ({}))
    const merged = { name: existing.name, metric: existing.metric, groupBy: existing.groupBy, filters: existing.filters, dateRange: existing.dateRange, chartType: existing.chartType, schedule: existing.schedule, ...body }
    const validation = validateReportDefinitionInput(merged)
    if (!validation.valid) return NextResponse.json({ error: validation.errors.join('; ') }, { status: 400 })

    const definition = buildReportDefinition(brand, tenantId, merged, { existing, createdBy: existing.createdBy })

    await db.collection(REPORT_DEFINITIONS_COLLECTION).updateOne({ brand, tenantId, id }, { $set: definition })
    return NextResponse.json({ report: definition })
  } catch (error: any) {
    console.error('PATCH /api/reports/[id] Error:', error)
    return NextResponse.json({ error: 'Failed to update report', details: error.message }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
    const result = await db.collection(REPORT_DEFINITIONS_COLLECTION).deleteOne({ brand, tenantId, id })
    if (result.deletedCount === 0) return NextResponse.json({ error: 'Report not found' }, { status: 404 })

    return new NextResponse(null, { status: 204 })
  } catch (error: any) {
    console.error('DELETE /api/reports/[id] Error:', error)
    return NextResponse.json({ error: 'Failed to delete report', details: error.message }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
