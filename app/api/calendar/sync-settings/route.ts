import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../lib/tenant';
import { resolveBrand } from '../../../lib/brand';
import type { Brand } from '../../../lib/brand';
import {
  getCalendarSyncSettings,
  CALENDAR_SYNC_SETTINGS_COLLECTION,
  DEFAULT_CALENDAR_SYNC_SETTINGS,
} from '../../../../lib/gcal-sync';

export const dynamic = 'force-dynamic';

async function getBrand(request: Request, bodyBrand?: string): Promise<Brand | null> {
  const url = new URL(request.url);
  const rawBrand = (bodyBrand || url.searchParams.get('brand') || '').trim();
  return await resolveBrand(rawBrand);
}

export async function GET(request: NextRequest) {
  try {
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ settings: DEFAULT_CALENDAR_SYNC_SETTINGS, brand });
    }

    const client = await clientPromise;
    const db = client.db();

    const settings = await getCalendarSyncSettings(db, brand, tenantId);
    return NextResponse.json({ settings, brand });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to retrieve calendar sync settings' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    let body: any;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 });
    }

    const brand = await getBrand(request, body.brand);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db();

    const updateFields: any = {
      updatedAt: new Date().toISOString(),
    };
    if (typeof body.syncEnabled === 'boolean') {
      updateFields.syncEnabled = body.syncEnabled;
    }
    if (typeof body.defaultDurationMinutes === 'number' && body.defaultDurationMinutes > 0) {
      updateFields.defaultDurationMinutes = Math.min(Math.round(body.defaultDurationMinutes), 480);
    }
    if (typeof body.autoSyncCadenceTasks === 'boolean') {
      updateFields.autoSyncCadenceTasks = body.autoSyncCadenceTasks;
    }

    await db.collection(CALENDAR_SYNC_SETTINGS_COLLECTION).updateOne(
      { brand, tenantId },
      { $set: updateFields },
      { upsert: true }
    );

    const updated = await getCalendarSyncSettings(db, brand, tenantId);
    return NextResponse.json({ ok: true, settings: updated, brand });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to update calendar sync settings' }, { status: 500 });
  }
}
