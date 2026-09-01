import { NextResponse } from 'next/server'
import { ObjectId } from 'mongodb'
import type { Db } from 'mongodb'
import clientPromise from '../../../../lib/mongodb'
import { requireCronOrApiKey, requireApiKey } from '../../../../lib/api-auth'
import { tenantFilter } from '../../../../lib/tenant'
import { getAllBrandConfigs } from '../../../lib/brand'
import { DEFAULT_OUTREACH_TEMPLATES } from '../../../lib/outreach/default-templates'
import type { OutreachTemplate } from '../../../lib/outreach/default-templates'
import { advanceActiveCadence } from '../../../../lib/cadences'
import type { CadenceStep, ActiveCadence } from '../../../../lib/cadences'
import { sendAutomatedEmail } from '../../../../lib/outreach-send'
import type { LeadForSend } from '../../../../lib/outreach-send'

export const dynamic = 'force-dynamic'

// Matches MAX_SCAN_SIZE (app/api/admin/duplicate-scan/route.ts) / MAX_BULK_SIZE
// (app/api/leads/bulk/route.ts)'s existing "cap a batch op, never silently
// drop the remainder" precedent — a lead past the cap simply gets picked up
// on tomorrow's tick, not lost. Applied per-brand (issue #151's own
// Architecture section caps it inside the per-brand loop), so a busy brand
// can't starve another's due leads within one run.
const MAX_CADENCE_SENDS_PER_TICK = 200
const TENANT_ID = 'default'

const REMINDER_NOTE_DEFAULTS: Record<'linkedin' | 'call', string> = {
  linkedin: 'LinkedIn touch due (cadence)',
  call: 'Call due (cadence)',
}

type TickSummary = {
  processed: number
  emailsSent: number
  remindersSet: number
  cadencesCompleted: number
  failures: Array<{ leadId: string; brand: string; reason: string }>
}

// A cadence step's templateId may reference either a brand's own persisted
// `outreach_templates` document or one of the built-in DEFAULT_OUTREACH_TEMPLATES
// (never a real ObjectId) — same two-tier resolution GET /api/outreach-templates
// itself falls back through. Returns null (never throws) so a deleted/typo'd
// templateId surfaces as sendAutomatedEmail()'s own "template not found" path
// rather than crashing the tick.
async function resolveTemplate(db: Db, brand: string, templateId: string | undefined): Promise<OutreachTemplate | null> {
  if (!templateId) return null
  try {
    const doc = await db.collection('outreach_templates').findOne({ _id: new ObjectId(templateId), ...tenantFilter(TENANT_ID), brand })
    if (doc) {
      return {
        id: doc._id.toString(),
        name: doc.name,
        channel: doc.channel,
        industry: doc.industry,
        subject: doc.subject,
        body: doc.body,
        variables: doc.variables || [],
        tags: doc.tags || [],
      }
    }
  } catch {
    // Not a valid ObjectId — falls through to the default-template lookup
    // below rather than treating a built-in template id as an error.
  }
  return DEFAULT_OUTREACH_TEMPLATES.find((t) => t.id === templateId) || null
}

async function runCadenceTick(): Promise<TickSummary> {
  const client = await clientPromise
  const db = client.db()
  const now = new Date()
  const nowIso = now.toISOString()

  const summary: TickSummary = { processed: 0, emailsSent: 0, remindersSet: 0, cadencesCompleted: 0, failures: [] }

  // Derived from BRAND_CONFIG, never a hardcoded brand list (issue #147's
  // own fix for the same class of bug) — a future brand needs no change here.
  const allBrandConfigs = await getAllBrandConfigs()
  for (const brand of Object.keys(allBrandConfigs)) {
    const config = allBrandConfigs[brand]
    const leadsCollection = db.collection(config.dbCollection)

    // Sorted oldest-due-first so the per-brand cap consistently favors the
    // most-overdue leads at the boundary, not an arbitrary cursor order
    // (issue #151's own edge case). ISO-8601 strings sort lexicographically
    // in the same order as chronologically, so a plain string sort is correct.
    const dueLeads = await leadsCollection
      .find({ ...tenantFilter(TENANT_ID), 'activeCadence.stepDueAt': { $lte: nowIso } })
      .sort({ 'activeCadence.stepDueAt': 1 })
      .limit(MAX_CADENCE_SENDS_PER_TICK)
      .toArray()

    for (const leadDoc of dueLeads) {
      summary.processed++
      const leadId = leadDoc._id.toString()
      const active = leadDoc.activeCadence as ActiveCadence

      let cadenceObjectId: ObjectId | null = null
      try {
        cadenceObjectId = new ObjectId(active.cadenceId)
      } catch {
        cadenceObjectId = null
      }

      const cadenceDoc = cadenceObjectId ? await db.collection('cadences').findOne({ _id: cadenceObjectId }) : null

      // Issue #149's own edge case, handled here rather than crashing the
      // whole run over one bad lead: a cadence template deleted while a lead
      // was actively enrolled on it. Clears the dangling enrollment and
      // moves on.
      if (!cadenceDoc) {
        await leadsCollection.updateOne({ _id: leadDoc._id }, { $set: { activeCadence: null } })
        summary.failures.push({ leadId, brand, reason: 'cadence template not found' })
        continue
      }

      // An operator who disabled a cadence mid-flight should not have it
      // silently keep firing for leads already enrolled — cleared, not
      // skipped-forever (issue #151's own Acceptance Criteria).
      if (cadenceDoc.enabled !== true) {
        await leadsCollection.updateOne({ _id: leadDoc._id }, { $set: { activeCadence: null } })
        summary.failures.push({ leadId, brand, reason: 'cadence disabled' })
        continue
      }

      const steps: CadenceStep[] = cadenceDoc.steps || []
      const currentStep = steps[active.currentStepIndex]
      if (!currentStep) {
        await leadsCollection.updateOne({ _id: leadDoc._id }, { $set: { activeCadence: null } })
        summary.failures.push({ leadId, brand, reason: 'step index out of range' })
        continue
      }

      const cadenceForAdvance = { id: cadenceDoc._id.toString(), steps }

      if (currentStep.channel === 'email') {
        const template = await resolveTemplate(db, brand, currentStep.templateId)
        const leadForSend: LeadForSend = { ...leadDoc, _id: leadId }
        const result = await sendAutomatedEmail(db, leadForSend, template, {
          brand,
          tenantId: TENANT_ID,
          cadenceId: cadenceForAdvance.id,
          stepIndex: active.currentStepIndex,
        })
        if (result.sent) {
          summary.emailsSent++
        } else {
          // Non-Goals: no retry-with-backoff within the same tick — a
          // routing/send failure still advances the cadence (logged here,
          // visible in Activity via outreach_logs), never blocks on retry.
          summary.failures.push({ leadId, brand, reason: result.reason || 'send failed' })
        }
      } else {
        // linkedin/call — never calls Resend (LinkedIn automation is
        // ToS-infeasible, see lib/cadences.ts's own header comment). Reuses
        // issue #121's exact due/overdue mechanism rather than a second one.
        const reminderNote = currentStep.reminderNote || REMINDER_NOTE_DEFAULTS[currentStep.channel]
        await leadsCollection.updateOne(
          { _id: leadDoc._id },
          { $set: { nextActionDueAt: nowIso, nextActionNote: reminderNote, updatedAt: now } }
        )
        summary.remindersSet++
      }

      const nextActive = advanceActiveCadence(cadenceForAdvance, active, now)
      if (nextActive) {
        await leadsCollection.updateOne({ _id: leadDoc._id }, { $set: { activeCadence: nextActive } })
      } else {
        await leadsCollection.updateOne({ _id: leadDoc._id }, { $set: { activeCadence: null } })
        summary.cadencesCompleted++
      }
    }
  }

  return summary
}

// GET is the Vercel Cron target (automatic `Authorization: Bearer
// $CRON_SECRET`) but also accepts the standard x-api-key admin auth for a
// manual re-trigger — same pattern as every other admin cron route in this
// app (GET /api/admin/forecast-snapshot, GET /api/admin/ticket-size-recalc).
// DECLINE/LOST auto-cancel is deliberately NOT handled here — it's
// immediate, in app/lib/lead-actions.ts and PUT /api/leads/[id] (issue
// #149's own review fix), not deferred to the next day's tick.
export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const summary = await runCadenceTick()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...summary })
  } catch (error: any) {
    console.error('[API:admin/cadence-tick] GET error:', error)
    return NextResponse.json({ error: 'Failed to run cadence tick', details: error.message }, { status: 500 })
  }
}

// Manual trigger — key-guarded (x-api-key), identical behavior to GET's
// cron path, exposed separately so a manual re-run never needs to spoof a
// cron header.
export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const summary = await runCadenceTick()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...summary })
  } catch (error: any) {
    console.error('[API:admin/cadence-tick] POST error:', error)
    return NextResponse.json({ error: 'Failed to run cadence tick', details: error.message }, { status: 500 })
  }
}
