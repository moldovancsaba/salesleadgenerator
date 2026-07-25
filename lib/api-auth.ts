import { NextResponse } from 'next/server';

const API_KEY = process.env.SLG_API_KEY || '';
const CRON_SECRET = process.env.CRON_SECRET || '';

export function requireApiKey(request: Request): NextResponse | null {
  if (!API_KEY) {
    return null;
  }

  const headerKey = request.headers.get('x-api-key');
  if (headerKey === API_KEY) {
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
// #57). Same fail-open behavior as requireApiKey when SLG_API_KEY is unset:
// documented, not accidental.
export function requireCronOrApiKey(request: Request): NextResponse | null {
  if (isCronRequest(request)) {
    return null;
  }

  return requireApiKey(request);
}
