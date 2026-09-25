import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { resolveBrand } from '../../../lib/brand';
import { getTenantId } from '../../../../lib/tenant';
import { getSchedulingSettings, saveSchedulingSettings } from '../../../lib/scheduling-store';
import { isValidAvailabilityWindow, DEFAULT_AVAILABILITY_WINDOW } from '../../../../lib/scheduling';

// Issue #207 — the availability-window editor's backing route. Brand-scoped
// (requireBrandAccessApi, same guard the core lead API uses) — any admin
// with this brand's access can manage it, not only the super admin,
// matching this repo's own established pattern for brand-level settings.
export async function GET(request: NextRequest, { params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  const authResponse = await requireBrandAccessApi(request, brand);
  if (authResponse) return authResponse;

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const tenantId = getTenantId(request);
  const client = await clientPromise;
  const db = client.db();
  const settings = await getSchedulingSettings(db, brand, tenantId);
  return NextResponse.json({ settings });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ brand: string }> }) {
  const { brand: brandParam } = await params;
  const brand = await resolveBrand(brandParam);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  const authResponse = await requireBrandAccessApi(request, brand);
  if (authResponse) return authResponse;

  const body = await request.json().catch(() => ({}));
  const timeZone = typeof body.timeZone === 'string' && body.timeZone.trim() ? body.timeZone.trim() : 'UTC';
  const availabilityWindow = isValidAvailabilityWindow(body.availabilityWindow) ? body.availabilityWindow : DEFAULT_AVAILABILITY_WINDOW;

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const tenantId = getTenantId(request);
  const client = await clientPromise;
  const db = client.db();
  await saveSchedulingSettings(db, brand, tenantId, { timeZone, availabilityWindow });
  return NextResponse.json({ settings: { timeZone, availabilityWindow } });
}

export const dynamic = 'force-dynamic';
