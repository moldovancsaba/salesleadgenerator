import { NextResponse, type NextRequest } from 'next/server'
import { ObjectId } from 'mongodb'
import { isMongoConfigured, getClientPromise } from '../../../../../../lib/mongodb'
import { getBrandConfig, resolveBrand, type Brand } from '../../../../../lib/brand'
import { requireBrandAccessApi } from '../../../../../../lib/require-brand-access-api'
import { getTenantId, tenantFilter } from '../../../../../../lib/tenant'
import { completeTaskStep, type ActiveCadence } from '../../../../../../lib/cadences'
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes, truncateBody } from '../../../../../lib/activity-log-store'
import { resolveSessionFromIdToken } from '../../../../../../lib/session'

export const dynamic = 'force-dynamic'

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url)
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || 'cogmap'
  return await resolveBrand(brandParam)
}

function parseObjectId(id: string): ObjectId | null {
  try {
    return new ObjectId(id.trim())
  } catch {
    return null
  }
}

// POST /api/leads/[id]/cadence/complete-step — completes the currently waiting
// manual task step (call/linkedin/general) on a lead's active cadence enrollment.
// Implements CRM Invariant 3: completion-gated progression.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const brand = await getBrand(request)
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 })
    const authError = await requireBrandAccessApi(request, brand)
    if (authError) return authError

    const tenantId = getTenantId(request)
    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const leadObjectId = parseObjectId(id)
    if (!leadObjectId) {
      return NextResponse.json({ error: 'Invalid lead id' }, { status: 400 })
    }

    const config = (await getBrandConfig(brand))!
    const client = await getClientPromise()
    const db = client.db()

    const lead = await db.collection(config.dbCollection).findOne({ _id: leadObjectId, ...tenantFilter(tenantId) })
    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const active = lead.activeCadence as ActiveCadence | null
    if (!active) {
      return NextResponse.json({ error: 'Lead does not have an active cadence enrollment' }, { status: 400 })
    }

    if (!active.waitingForTask) {
      return NextResponse.json({ error: 'Cadence is not waiting for task completion' }, { status: 400 })
    }

    const cadenceObjectId = parseObjectId(active.cadenceId)
    const cadenceDoc = cadenceObjectId
      ? await db.collection('cadences').findOne({ _id: cadenceObjectId, brand, ...tenantFilter(tenantId) })
      : null

    if (!cadenceDoc) {
      // Cadence template missing — clear enrollment
      await db.collection(config.dbCollection).updateOne(
        { _id: leadObjectId },
        { $set: { activeCadence: null, nextActionDueAt: null, nextActionNote: null, updatedAt: new Date() } }
      )
      return NextResponse.json({ error: 'Cadence template not found' }, { status: 404 })
    }

    const steps = cadenceDoc.steps || []
    const now = new Date()
    const nextActive = completeTaskStep({ id: cadenceDoc._id.toString(), steps }, active, now)

    // Optional note from request body
    let body: any = {}
    try {
      body = await request.json()
    } catch {
      // Body may be empty
    }

    const currentStep = steps[active.currentStepIndex]
    const stepChannel = currentStep?.channel || 'task'

    // Write audit activity log
    try {
      const idToken = request.cookies.get('sso_id_token')?.value
      const claims = await resolveSessionFromIdToken(idToken)
      const loggedBy = claims?.email
      await ensureActivityLogIndexes(db)
      await db.collection(ACTIVITY_LOG_COLLECTION).insertOne({
        leadId: id,
        tenantId,
        brand,
        type: stepChannel === 'call' ? 'call' : 'note',
        direction: 'outbound',
        matchedContactKey: null,
        bodyExcerpt: truncateBody(typeof body?.note === 'string' && body.note ? body.note : `Cadence task completed: ${stepChannel}`),
        loggedBy,
        source: 'manual',
        createdAt: now,
      })
    } catch (logErr) {
      console.error('[cadence/complete-step] activity log write failed', logErr)
    }

    if (nextActive) {
      await db.collection(config.dbCollection).updateOne(
        { _id: leadObjectId },
        {
          $set: {
            activeCadence: nextActive,
            nextActionDueAt: null,
            nextActionNote: null,
            updatedAt: now,
          },
        }
      )
    } else {
      await db.collection(config.dbCollection).updateOne(
        { _id: leadObjectId },
        {
          $set: {
            activeCadence: null,
            nextActionDueAt: null,
            nextActionNote: null,
            updatedAt: now,
          },
        }
      )
    }

    return NextResponse.json({
      ok: true,
      activeCadence: nextActive,
      completed: !nextActive,
    })
  } catch (error: any) {
    console.error('POST /api/leads/[id]/cadence/complete-step Error:', error)
    return NextResponse.json({ error: 'Failed to complete cadence step' }, { status: 500 })
  }
}
