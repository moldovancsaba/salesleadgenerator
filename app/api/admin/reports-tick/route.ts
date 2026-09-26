import { NextResponse } from 'next/server'
import clientPromise from '../../../../lib/mongodb'
import { requireCronOrApiKey, requireApiKey } from '../../../../lib/api-auth'
import { getAllBrandConfigs } from '../../../lib/brand'
import { resolveOutboundFromAddress } from '../../../../lib/outreach-send'
import { computeNextRunAt } from '../../../../lib/report-definitions'
import { sendReportEmail, renderReportEmailHtml, isReportDeliveryConfigured } from '../../../../lib/report-delivery'
import { REPORT_DEFINITIONS_COLLECTION, reportDocToDefinition, runReportDefinition } from '../../../lib/report-store'

export const dynamic = 'force-dynamic'

// Same per-tick cap convention as cadence-tick's MAX_CADENCE_SENDS_PER_TICK
// — a due report simply picks up on the next tick rather than one
// oversized batch blocking the whole run (issue #212 §16).
const MAX_REPORTS_PER_TICK = 200

type TickSummary = {
  processed: number
  sent: number
  failures: Array<{ reportId: string; brand: string; reason: string }>
}

async function runReportsTick(): Promise<TickSummary> {
  const client = await clientPromise
  const db = client.db()
  const now = new Date()
  const summary: TickSummary = { processed: 0, sent: 0, failures: [] }

  const dueDocs = await db.collection(REPORT_DEFINITIONS_COLLECTION)
    .find({ 'schedule.enabled': true, 'schedule.nextRunAt': { $lte: now.toISOString() } })
    .limit(MAX_REPORTS_PER_TICK)
    .toArray()

  const allBrandConfigs = await getAllBrandConfigs()

  for (const doc of dueDocs) {
    summary.processed++
    const definition = reportDocToDefinition(doc)
    const config = allBrandConfigs[definition.brand]

    // A brand deleted/renamed after a report references it, or a schedule
    // with a stale/malformed shape — fails this one definition, never
    // crashes the tick (issue #212 §15).
    if (!config || !definition.schedule) {
      summary.failures.push({ reportId: definition.id, brand: definition.brand, reason: 'brand or schedule unresolvable' })
      continue
    }

    // Issue #224: without RESEND_API_KEY every delivery fails, and the
    // failure path below would still advance nextRunAt — silently skipping
    // each scheduled run. Hold the run instead so it is delivered once
    // sending is configured.
    if (!isReportDeliveryConfigured()) {
      summary.failures.push({ reportId: definition.id, brand: definition.brand, reason: 'report delivery not configured (RESEND_API_KEY unset): run held, nextRunAt unchanged' })
      continue
    }

    try {
      const rows = await runReportDefinition(db, config.dbCollection, definition)
      const html = renderReportEmailHtml(definition.name, rows)
      const from = resolveOutboundFromAddress(definition.brand, config.fromEmail)

      let anySent = false
      let lastReason: string | undefined
      for (const recipient of definition.schedule.recipients) {
        const result = await sendReportEmail({
          to: recipient,
          from,
          subject: `Report: ${definition.name}`,
          html,
          // Deterministic per (report, recipient, due-time) — a genuine
          // network-level retry of the same tick invocation reuses the
          // same key; a later, separately-due run gets a distinct one.
          idempotencyKey: `report_${definition.id}_${recipient}_${definition.schedule.nextRunAt}`,
        })
        if (result.sent) anySent = true
        else lastReason = result.reason
      }

      const nextRunAt = computeNextRunAt(definition.schedule, now)
      await db.collection(REPORT_DEFINITIONS_COLLECTION).updateOne(
        { id: definition.id },
        anySent
          ? { $set: { 'schedule.nextRunAt': nextRunAt, lastRunAt: now.toISOString(), lastRunStatus: 'ok' }, $unset: { lastRunError: '' } }
          : { $set: { 'schedule.nextRunAt': nextRunAt, lastRunAt: now.toISOString(), lastRunStatus: 'error', lastRunError: lastReason || 'no recipients sent' } }
      )

      if (anySent) summary.sent++
      else summary.failures.push({ reportId: definition.id, brand: definition.brand, reason: lastReason || 'send failed' })
    } catch (error: any) {
      // A per-definition failure (e.g. an aggregation error) still advances
      // nextRunAt so a permanently-broken definition doesn't fire on every
      // single tick forever — logged as lastRunStatus: 'error' instead.
      const nextRunAt = computeNextRunAt(definition.schedule, now)
      await db.collection(REPORT_DEFINITIONS_COLLECTION).updateOne(
        { id: definition.id },
        { $set: { 'schedule.nextRunAt': nextRunAt, lastRunAt: now.toISOString(), lastRunStatus: 'error', lastRunError: error?.message || 'run failed' } }
      )
      summary.failures.push({ reportId: definition.id, brand: definition.brand, reason: error?.message || 'run failed' })
    }
  }

  return summary
}

export async function GET(request: Request) {
  const authError = requireCronOrApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const summary = await runReportsTick()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...summary })
  } catch (error: any) {
    console.error('[API:admin/reports-tick] GET error:', error)
    return NextResponse.json({ error: 'Failed to run reports tick' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const authError = requireApiKey(request)
  if (authError) return authError

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
  }

  try {
    const summary = await runReportsTick()
    return NextResponse.json({ ranAt: new Date().toISOString(), ...summary })
  } catch (error: any) {
    console.error('[API:admin/reports-tick] POST error:', error)
    return NextResponse.json({ error: 'Failed to run reports tick' }, { status: 500 })
  }
}
