import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { resolveBrand } from '../../../../lib/brand';
import { getAvailability, checkAndRecordRateLimit } from '../../../../lib/scheduling-store';

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

// Issue #207 — the first fully public, unauthenticated, data-returning
// endpoint pair this app has ever shipped. Never returns anything beyond
// slot start/end boundaries — no event titles, no attendees, no busy-block
// reasons (§17). Rate-limited per IP+brand (a new, real capability — this
// repo had no rate-limiting utility anywhere before this issue, §3/§15).
export async function GET(request: NextRequest, { params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  if (!isMongoConfigured()) return NextResponse.json({ error: 'This scheduling link is temporarily unavailable' }, { status: 503 });

  const client = await clientPromise;
  const db = client.db();

  const allowed = await checkAndRecordRateLimit(db, `${clientIp(request)}|${brand}|availability`);
  if (!allowed) return NextResponse.json({ error: 'Too many requests — please try again shortly' }, { status: 429 });

  const { searchParams } = new URL(request.url);
  const daysParam = Number.parseInt(searchParams.get('days') || '14', 10);
  const days = Number.isFinite(daysParam) ? daysParam : 14;

  const result = await getAvailability(db, brand, 'default', days);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ slots: result.slots });
}

export const dynamic = 'force-dynamic';
