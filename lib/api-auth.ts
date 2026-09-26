import { NextResponse } from 'next/server';
import { recordLegacyKeyUse } from './legacy-key-usage';

const API_KEY = process.env.SLG_API_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

export function requireApiKey(request: Request): NextResponse | null {
  if (!API_KEY) {
    // Issue #105: fail open only outside production — a local/dev/test
    // environment with no key configured shouldn't need one. In production,
    // an unset SLG_API_KEY is a misconfiguration (accidental removal, a new
    // environment spun up without it) and must fail closed instead of
    // silently dropping auth on every route this guards.
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'Unauthorized', details: 'SLG_API_KEY is not configured' },
        { status: 401 }
      );
    }
    return null;
  }

  const headerKey = request.headers.get('x-api-key');
  if (headerKey === API_KEY) {
    recordLegacyKeyUse(request);
    return null;
  }

  return NextResponse.json(
    { error: 'Unauthorized', details: 'Missing or invalid x-api-key' },
    { status: 401 }
  );
}

export function isCronRequest(request: Request): boolean {
  if (!CRON_SECRET) return false;
  const authHeader = request.headers.get('authorization') || '';
  return authHeader === `Bearer ${CRON_SECRET}`;
}

// Accepts either Vercel Cron's automatic `Authorization: Bearer $CRON_SECRET`
// header (the scheduled trigger) or the existing x-api-key admin auth (manual
// trigger/backfill) — used only by app/api/admin/forecast-snapshot (issue
// #57). Inherits requireApiKey's own fail-open-outside-production behavior
// when SLG_API_KEY is unset (issue #105).
export function requireCronOrApiKey(request: Request): NextResponse | null {
  if (isCronRequest(request)) {
    return null;
  }

  // Vercel sets this header on every scheduled invocation (issue #224). It is
  // used only to make a rejected cron run visible in the logs — never as an
  // auth signal, since any caller can send it.
  const cronSchedule = request.headers.get('x-vercel-cron-schedule');
  if (cronSchedule) {
    const reason = CRON_SECRET ? 'Authorization header does not match CRON_SECRET' : 'CRON_SECRET is not configured';
    console.error(`[api-auth] Vercel Cron invocation rejected (${reason}): ${new URL(request.url).pathname} schedule="${cronSchedule}"`);
  }

  return requireApiKey(request);
}
