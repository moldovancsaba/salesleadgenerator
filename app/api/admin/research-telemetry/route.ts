import { NextRequest, NextResponse } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand } from '@/app/lib/brand';
import { requireBrandAccessApi, requireMachineKeyApi } from '@/lib/require-brand-access-api';
import { requireBrandAdminSession } from '@/lib/session';
import {
  getWorkspaceResearchTelemetry,
  recordResearchTelemetryRun,
  type ResearchOperationType,
} from '@/lib/research-telemetry';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const rawBrand = searchParams.get('brand') || 'cogmap';
    const brand = await resolveBrand(rawBrand);
    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = searchParams.get('tenantId') || brand;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db();
    const telemetry = await getWorkspaceResearchTelemetry(db, brand, tenantId);
    return NextResponse.json(telemetry);
  } catch (error: any) {
    console.error('[API:admin/research-telemetry] GET error:', error);
    return NextResponse.json({ error: 'Failed to load research telemetry' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const rawBrand = body.brand || new URL(request.url).searchParams.get('brand') || 'cogmap';
    const brand = await resolveBrand(rawBrand);
    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    // Machine-key callers (scheduled research/enrichment runner) OR workspace admins updating interval/run state.
    const machineErr = await requireMachineKeyApi(request, brand);
    if (machineErr) {
      const adminOrResponse = await requireBrandAdminSession(request, brand);
      if (adminOrResponse instanceof NextResponse) {
        return adminOrResponse;
      }
    }

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const operation = body.operation as ResearchOperationType;
    if (operation !== 'discovery' && operation !== 'enrichment') {
      return NextResponse.json({ error: 'operation must be discovery or enrichment' }, { status: 400 });
    }

    const tenantId = typeof body.tenantId === 'string' && body.tenantId.trim() ? body.tenantId.trim() : brand;
    const client = await clientPromise;
    const db = client.db();

    // Allow interval-only configuration update without fabricating a run timestamp
    if (body.status === undefined && typeof body.intervalMinutes === 'number') {
      const mins = Math.max(1, Math.round(body.intervalMinutes));
      await db.collection('tenant_operations').updateOne(
        { brand, tenantId, operation },
        {
          $set: { intervalMinutes: mins, updatedAt: new Date().toISOString() },
          $setOnInsert: { brand, tenantId, operation, enabled: true },
        },
        { upsert: true }
      );
      const telemetry = await getWorkspaceResearchTelemetry(db, brand, tenantId);
      return NextResponse.json({ ok: true, telemetry });
    }

    const status = body.status === 'failed' ? 'failed' : 'succeeded';
    await recordResearchTelemetryRun(db, {
      brand,
      tenantId,
      operation,
      status,
      leadId: typeof body.leadId === 'string' ? body.leadId : undefined,
      entityName: typeof body.entityName === 'string' ? body.entityName : undefined,
      error: typeof body.error === 'string' ? body.error : undefined,
      intervalMinutes: typeof body.intervalMinutes === 'number' ? body.intervalMinutes : undefined,
    });

    const telemetry = await getWorkspaceResearchTelemetry(db, brand, tenantId);
    return NextResponse.json({ ok: true, telemetry });
  } catch (error: any) {
    console.error('[API:admin/research-telemetry] POST error:', error);
    return NextResponse.json({ error: 'Failed to record research telemetry' }, { status: 500 });
  }
}
