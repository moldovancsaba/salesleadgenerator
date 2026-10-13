import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../lib/tenant';
import { resolveBrand } from '../../../lib/brand';
import type { Brand } from '../../../lib/brand';
import {
  syncTaskReminderToGoogleCalendar,
  deleteCalendarTaskReminder,
} from '../../../../lib/gcal-sync';

export const dynamic = 'force-dynamic';

async function getBrand(request: Request, bodyBrand?: string): Promise<Brand | null> {
  const url = new URL(request.url);
  const rawBrand = (bodyBrand || url.searchParams.get('brand') || '').trim();
  return await resolveBrand(rawBrand);
}

export async function POST(request: NextRequest) {
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

    if (!body.taskId || typeof body.taskId !== 'string') {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db();

    const result = await syncTaskReminderToGoogleCalendar(db, {
      brand,
      tenantId,
      taskId: body.taskId,
      title: body.title || 'CRM Task',
      dueAt: body.dueAt || new Date().toISOString(),
      durationMinutes: body.durationMinutes,
      channel: body.channel,
      contactName: body.contactName,
      contactEmail: body.contactEmail,
      companyName: body.companyName,
      instructions: body.instructions,
      leadId: body.leadId || '',
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to sync task to calendar' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const url = new URL(request.url);
    const taskId = (url.searchParams.get('taskId') || '').trim();
    if (!taskId) {
      return NextResponse.json({ error: 'Task ID is required' }, { status: 400 });
    }

    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db();

    const result = await deleteCalendarTaskReminder(db, {
      brand,
      tenantId,
      taskId,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: 'Failed to delete task from calendar' }, { status: 500 });
  }
}
