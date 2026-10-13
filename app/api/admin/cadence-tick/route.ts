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
import { sendAutomatedEmail, isResendSendConfigured } from '../../../../lib/outreach-send'
import type { LeadForSend } from '../../../../lib/outreach-send'
import { syncTaskReminderToGoogleCalendar } from '../../../../lib/gcal-sync'

export const dynamic = 'force-dynamic'

// Matches MAX_SCAN_SIZE (app/api/admin/duplicate-scan/route.ts) / MAX_BULK_SIZE
// (app/api/leads/bulk/route.ts)'s existing "cap a batch op, never silently
// drop the remainder" precedent — a lead past the cap simply gets picked up
// on tomorrow's tick, not lost. Applied per-brand (issue #151's own
// Architecture section caps it inside the per-brand loop), so a busy brand
// can't starve another's due leads within one run.
const MAX_CADENCE_SENDS_PER_TICK = 200
const TENANT_ID = 'default'

const REMINDER_NOTE_DEFAULTS: Record<'linkedin' | 'call' | 'general', string> = {
  linkedin: 'LinkedIn touch due (cadence)',
  call: 'Call due (cadence)',
  general: 'Task due (cadence)',
}

type TickSummary = {
  processed: number
  emailsSent: number
  remindersSet: number
  cadencesCompleted: number
  emailStepsHeld: number
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

  const summary: TickSummary = { processed: 0, emailsSent: 0, remindersSet: 0, cadencesCompleted: 0, emailStepsHeld: 0, failures: [] }

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
      .find({
        ...tenantFilter(TENANT_ID),
        'activeCadence.stepDueAt': { $lte: nowIso },
        'activeCadence.waitingForTask': { $ne: true },
      })
      .sort({ 'activeCadence.stepDueAt': 1 })
      .limit(MAX_CADENCE_SENDS_PER_TICK)
      .toArray()

    for (const leadDoc of dueLeads) {
      summary.processed++
      const leadId = leadDoc._id.toString()
      const active = leadDoc.activeCadence as ActiveCadence

      // CRM Invariant 3: completion gating. If waiting for manual task, skip.
      if (active.waitingForTask) {
        continue
      }

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
        // Issue #224: with no RESEND_API_KEY every send is guaranteed to fail,
        // and the advance-on-failure rule below would silently walk every
        // enrolled lead through its email steps without sending anything.
        // Hold the step instead — no send attempt, no advance — so the
        // cadence resumes exactly where it was once sending is configured.
        if (!isResendSendConfigured()) {
          summary.emailStepsHeld++
          summary.failures.push({ leadId, brand, reason: 'email sending not configured (RESEND_API_KEY unset): step held, cadence not advanced' })
          continue
        }
        const template = await resolveTemplate(db, brand, currentStep.templateId)
        const leadForSend: LeadForSend = { ...leadDoc, _id: leadId }
        const result = await sendAutomatedEmail(db, leadForSend, template, {
          brand,
          tenantId: TENANT_ID,
          cadenceId: cadenceForAdvance.id,
          stepIndex: active.currentStepIndex,
          documentIds: currentStep.documentIds,
        })
        if (result.sent) {
          summary.emailsSent++
        } else {
          // CRM Invariant 2 & 4: If send was aborted because recipient replied or is suppressed,
          // stop the cadence immediately.
          if (
            result.reason?.startsWith('SEND_CANCELLED_REPLIED') ||
            result.reason?.startsWith('SEND_CANCELLED_SUPPRESSED')
          ) {
            await leadsCollection.updateOne({ _id: leadDoc._id }, { $set: { activeCadence: null, updatedAt: now } })
            summary.failures.push({ leadId, brand, reason: result.reason })
            continue
          }

          // CRM Invariant / Predecessor Handoff 10 (issue #241): Missing required merge variables
          // block the send (personalization_blocked). The cadence step is held rather than advanced,
          // so reps can enrich the missing contact data rather than skipping the step.
          if (result.reason?.startsWith('PERSONALIZATION_BLOCKED')) {
            await leadsCollection.updateOne(
              { _id: leadDoc._id },
              { $set: { 'activeCadence.status': 'blocked_personalization', updatedAt: now } }
            )
            summary.failures.push({ leadId, brand, reason: result.reason })
            continue
          }

          // CRM Invariant / Predecessor Handoff 11 (issue #243): Missing referenced documents
          // in the library block the send (blocked_attachment). The cadence step is held rather than advanced,
          // so reps or operators can restore the missing document rather than skipping the step.
          if (result.reason?.startsWith('ATTACHMENT_MISSING')) {
            await leadsCollection.updateOne(
              { _id: leadDoc._id },
              { $set: { 'activeCadence.status': 'blocked_attachment', updatedAt: now } }
            )
            summary.failures.push({ leadId, brand, reason: result.reason })
            continue
          }

          // Non-Goals: no retry-with-backoff within the same tick — a
          // routing/send failure still advances the cadence (logged here,
          // visible in Activity via outreach_logs), never blocks on retry.
          summary.failures.push({ leadId, brand, reason: result.reason || 'send failed' })
        }

        const nextActive = advanceActiveCadence(cadenceForAdvance, active, now)
        if (nextActive) {
          await leadsCollection.updateOne({ _id: leadDoc._id }, { $set: { activeCadence: nextActive } })
        } else {
          await leadsCollection.updateOne({ _id: leadDoc._id }, { $set: { activeCadence: null } })
          summary.cadencesCompleted++
        }
      } else {
        // linkedin/call/general — never calls Resend.
        // CRM Invariant 3: manual tasks pause the cadence (completion gating).
        // The cadence scheduler (cadence-tick) MUST NOT advance the step while waiting.
        // Overdue tasks stay waiting and do not auto-complete.
        const reminderNote = currentStep.reminderNote || (REMINDER_NOTE_DEFAULTS as Record<string, string>)[currentStep.channel] || 'Task due (cadence)'
        const waitingCadence: ActiveCadence = {
          ...active,
          waitingForTask: true,
          taskStepId: currentStep.id,
          taskDueAt: nowIso,
          status: 'waiting_task',
        }
        await leadsCollection.updateOne(
          { _id: leadDoc._id },
          {
            $set: {
              nextActionDueAt: nowIso,
              nextActionNote: reminderNote,
              activeCadence: waitingCadence,
              updatedAt: now,
            },
          }
        )
        summary.remindersSet++

        // Predecessor Handoff 08 (issue #244): Google Calendar Task Reminders Sync
        // Asynchronously sync task reminder to Google Calendar (non-blocking, fail-safe).
        const primaryContact = Array.isArray(leadDoc.contacts)
          ? leadDoc.contacts.find((c: any) => c.isDecisionMaker) || leadDoc.contacts[0]
          : undefined
        await syncTaskReminderToGoogleCalendar(db, {
          brand,
          tenantId: TENANT_ID,
          taskId: currentStep.id,
          title: reminderNote,
          dueAt: nowIso,
          channel: currentStep.channel,
          contactName: primaryContact?.name,
          contactEmail: primaryContact?.email,
          companyName: leadDoc.entity_name || leadDoc.company,
          instructions: currentStep.reminderNote,
          leadId,
        }).catch(() => {})
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
    return NextResponse.json({ error: 'Failed to run cadence tick' }, { status: 500 })
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
    return NextResponse.json({ error: 'Failed to run cadence tick' }, { status: 500 })
  }
}
