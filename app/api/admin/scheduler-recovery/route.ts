import { NextResponse } from 'next/server';
import clientPromise from '../../../../lib/mongodb';
import { requireApiKey } from '../../../../lib/api-auth';
import {
  getSchedulerState,
  downtimeExceeded,
  SCHEDULER_RECOVERY_THRESHOLD_MS,
  RECOVERY_MAX_SENDS_PER_HOUR,
  RECOVERY_MIN_GAP_SECONDS,
  DEFAULT_DAILY_CAP,
} from '../../../../lib/scheduler-recovery';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/scheduler-recovery
 * Returns the current scheduler heartbeat, downtime status, and last recovery pass metrics.
 */
export async function GET(request: Request) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  try {
    const client = await clientPromise;
    const db = client.db();
    const state = await getSchedulerState(db);
    const now = new Date();
    const isDowntime = downtimeExceeded(state?.lastHeartbeatAt, now);

    return NextResponse.json({
      status: isDowntime ? 'downtime_detected' : 'healthy',
      now: now.toISOString(),
      lastHeartbeatAt: state?.lastHeartbeatAt || null,
      downtimeExceeded: isDowntime,
      thresholdMs: SCHEDULER_RECOVERY_THRESHOLD_MS,
      policy: {
        recoveryMaxSendsPerHour: RECOVERY_MAX_SENDS_PER_HOUR,
        recoveryMinGapSeconds: RECOVERY_MIN_GAP_SECONDS,
        defaultDailyCap: DEFAULT_DAILY_CAP,
      },
      lastRecoveryAt: state?.lastRecoveryAt || null,
      lastRecoverySummary: state?.lastRecoverySummary || null,
    });
  } catch (error: any) {
    console.error('[API:admin/scheduler-recovery] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch scheduler recovery state' }, { status: 500 });
  }
}
