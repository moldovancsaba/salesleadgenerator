import { NextResponse, type NextRequest } from 'next/server'
import clientPromise from '../../../lib/mongodb'
import { DEFAULT_STALE_THRESHOLDS } from '../../../lib/stale-deal'
import { DEFAULT_CONCENTRATION_SETTINGS } from '../../../lib/forecast-concentration'
import { DEFAULT_CALIBRATION_SETTINGS } from '../../../lib/win-rate-calibration'
import { requireApiKeyOrSession } from '../../../lib/session'

export const dynamic = 'force-dynamic'

const DEFAULT_WEIGHTS: Record<string, number> = {
  DISCOVERED: 0.01,
  QUALIFIED: 0.05,
  ENGAGED: 0.10,
  PROPOSAL: 0.25,
  WON: 1.0,
  LOST: 0.0,
}

// Issue #192 — deliberately left open: read-only, non-PII global scoring
// config, same trust level as GET /api/lead-taxonomy. Only PUT (below) is
// gated, since that's the actual write hole.
export async function GET() {
  try {
    const client = await clientPromise
    const db = client.db()
    const [weightsDoc, thresholdsDoc, concentrationDoc, calibrationDoc] = await Promise.all([
      db.collection('settings').findOne({ key: 'pipeline_weights' }),
      db.collection('settings').findOne({ key: 'stale_thresholds' }),
      db.collection('settings').findOne({ key: 'concentration_risk_settings' }),
      db.collection('settings').findOne({ key: 'forecast_calibration' }),
    ])
    const weights = weightsDoc?.weights || DEFAULT_WEIGHTS
    const thresholds = thresholdsDoc?.thresholds || DEFAULT_STALE_THRESHOLDS
    const concentrationRiskSettings = concentrationDoc
      ? { threshold: concentrationDoc.threshold, topN: concentrationDoc.topN }
      : DEFAULT_CONCENTRATION_SETTINGS
    const calibration = calibrationDoc
      ? { mode: calibrationDoc.mode, minSampleSize: calibrationDoc.minSampleSize, windowDays: calibrationDoc.windowDays ?? null }
      : DEFAULT_CALIBRATION_SETTINGS
    return NextResponse.json({
      weights,
      thresholds,
      concentrationRiskSettings,
      calibration,
      source: weightsDoc ? 'mongodb' : 'default',
      thresholdsSource: thresholdsDoc ? 'mongodb' : 'default',
      concentrationRiskSettingsSource: concentrationDoc ? 'mongodb' : 'default',
      calibrationSource: calibrationDoc ? 'mongodb' : 'default',
    })
  } catch (error: any) {
    console.error('[API:settings] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch settings', details: error.message }, { status: 500 })
  }
}

export async function PUT(request: NextRequest) {
  // Issue #192 — this route had no auth at all despite writing global
  // scoring config every board/forecast page reads. requireApiKeyOrSession,
  // not requireSuperAdminSession: the real caller (app/forecast/[brand]/
  // forecast-client.tsx's saveWeights/handleCalibrationModeChange) is any
  // brand-authorized user, not an admin-only flow.
  const authError = await requireApiKeyOrSession(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const weights = body.weights
    const thresholds = body.thresholds
    const concentrationRiskSettings = body.concentrationRiskSettings
    const calibration = body.calibration

    if (weights !== undefined && (typeof weights !== 'object' || weights === null)) {
      return NextResponse.json({ error: 'weights must be an object' }, { status: 400 })
    }
    if (thresholds !== undefined && (typeof thresholds !== 'object' || thresholds === null)) {
      return NextResponse.json({ error: 'thresholds must be an object' }, { status: 400 })
    }
    if (concentrationRiskSettings !== undefined) {
      if (typeof concentrationRiskSettings !== 'object' || concentrationRiskSettings === null) {
        return NextResponse.json({ error: 'concentrationRiskSettings must be an object' }, { status: 400 })
      }
      const { threshold, topN } = concentrationRiskSettings
      if (typeof threshold !== 'number' || !(threshold > 0) || typeof topN !== 'number' || !(topN > 0)) {
        return NextResponse.json({ error: 'concentrationRiskSettings requires positive numeric threshold and topN' }, { status: 400 })
      }
    }
    if (calibration !== undefined) {
      if (typeof calibration !== 'object' || calibration === null) {
        return NextResponse.json({ error: 'calibration must be an object' }, { status: 400 })
      }
      const { mode, minSampleSize, windowDays } = calibration
      if (mode !== 'static' && mode !== 'calibrated') {
        return NextResponse.json({ error: "calibration.mode must be 'static' or 'calibrated'" }, { status: 400 })
      }
      if (typeof minSampleSize !== 'number' || !(minSampleSize > 0)) {
        return NextResponse.json({ error: 'calibration requires a positive numeric minSampleSize' }, { status: 400 })
      }
      if (windowDays !== null && windowDays !== undefined && (typeof windowDays !== 'number' || !(windowDays > 0))) {
        return NextResponse.json({ error: 'calibration.windowDays must be null or a positive number' }, { status: 400 })
      }
    }
    if (weights === undefined && thresholds === undefined && concentrationRiskSettings === undefined && calibration === undefined) {
      return NextResponse.json({ error: 'weights, thresholds, concentrationRiskSettings, or calibration object required' }, { status: 400 })
    }

    const client = await clientPromise
    const db = client.db()
    const updates: Promise<unknown>[] = []
    if (weights !== undefined) {
      updates.push(
        db.collection('settings').updateOne(
          { key: 'pipeline_weights' },
          { $set: { weights, updatedAt: new Date() } },
          { upsert: true }
        )
      )
    }
    if (thresholds !== undefined) {
      updates.push(
        db.collection('settings').updateOne(
          { key: 'stale_thresholds' },
          { $set: { thresholds, updatedAt: new Date() } },
          { upsert: true }
        )
      )
    }
    if (concentrationRiskSettings !== undefined) {
      updates.push(
        db.collection('settings').updateOne(
          { key: 'concentration_risk_settings' },
          { $set: { threshold: concentrationRiskSettings.threshold, topN: concentrationRiskSettings.topN, updatedAt: new Date() } },
          { upsert: true }
        )
      )
    }
    if (calibration !== undefined) {
      updates.push(
        db.collection('settings').updateOne(
          { key: 'forecast_calibration' },
          { $set: { mode: calibration.mode, minSampleSize: calibration.minSampleSize, windowDays: calibration.windowDays ?? null, updatedAt: new Date() } },
          { upsert: true }
        )
      )
    }
    await Promise.all(updates)

    return NextResponse.json({ ok: true, weights, thresholds, concentrationRiskSettings, calibration })
  } catch (error: any) {
    console.error('[API:settings] PUT error:', error)
    return NextResponse.json({ error: 'Failed to update settings', details: error.message }, { status: 500 })
  }
}
