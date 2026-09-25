import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { resolveBrand } from '../../../../lib/brand';
import { bookSlot, checkAndRecordRateLimit } from '../../../../lib/scheduling-store';

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Issue #207 — public booking commit. Race-safe (app/lib/scheduling-store.ts's
// bookSlot()): two near-simultaneous submissions for the identical slot
// resolve to exactly one success, the other a 409 with a refreshed slot
// list — never a silent double-book.
export async function POST(request: NextRequest, { params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  if (!isMongoConfigured()) return NextResponse.json({ error: 'This scheduling link is temporarily unavailable' }, { status: 503 });

  const client = await clientPromise;
  const db = client.db();

  const allowed = await checkAndRecordRateLimit(db, `${clientIp(request)}|${brand}|book`);
  if (!allowed) return NextResponse.json({ error: 'Too many requests — please try again shortly' }, { status: 429 });

  const body = await request.json().catch(() => ({}));
  const slotStart = typeof body.slotStart === 'string' ? body.slotStart : '';
  const slotEnd = typeof body.slotEnd === 'string' ? body.slotEnd : '';
  const prospectName = typeof body.prospectName === 'string' ? body.prospectName.trim() : '';
  const prospectEmail = typeof body.prospectEmail === 'string' ? body.prospectEmail.trim() : '';
  const leadId = typeof body.leadId === 'string' ? body.leadId : undefined;

  if (!slotStart || !slotEnd || Number.isNaN(new Date(slotStart).getTime()) || Number.isNaN(new Date(slotEnd).getTime())) {
    return NextResponse.json({ error: 'A valid time slot is required' }, { status: 400 });
  }
  if (!prospectName) return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  if (!isValidEmail(prospectEmail)) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });

  const result = await bookSlot(db, brand, 'default', { slotStart, slotEnd, leadId, prospectName, prospectEmail });
  if (!result.ok) {
    return NextResponse.json({ error: result.error, freshSlots: result.freshSlots }, { status: result.status });
  }

  return NextResponse.json({ confirmed: true, startAt: result.startAt, endAt: result.endAt });
}

export const dynamic = 'force-dynamic';
