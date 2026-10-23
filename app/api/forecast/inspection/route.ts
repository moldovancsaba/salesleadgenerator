import { NextResponse, type NextRequest } from 'next/server';
import clientPromise from '@/lib/mongodb';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { tenantFilter } from '@/lib/tenant';
import {
  computePipelineInspection,
  INSPECTION_WINDOWS,
  type InspectionWindowDays,
  type InspectionLeadInput,
  type InspectionOutcomeLog,
} from '@/lib/pipeline-inspection';

export const dynamic = 'force-dynamic';

// Pipeline Inspection & Deal Movement Waterfall (issue #277).
// GET /api/forecast/inspection?brand=<brand>&days=7|14|30|90
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const brand = await resolveBrand(url.searchParams.get('brand') || 'cogmap');
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const rawDays = Number(url.searchParams.get('days') || '30');
    const windowDays: InspectionWindowDays = INSPECTION_WINDOWS.includes(rawDays as InspectionWindowDays)
      ? (rawDays as InspectionWindowDays)
      : 30;

    const tenantId = (url.searchParams.get('tenantId') || brand).trim() || brand;
    const brandConfig = await getBrandConfig(brand);
    if (!brandConfig) return NextResponse.json({ error: 'Brand config not found' }, { status: 404 });

    const client = await clientPromise;
    const db = client.db();

    const now = new Date();
    const windowStart = new Date(now.getTime() - windowDays * 86_400_000);

    const [leadDocs, logDocs] = await Promise.all([
      db
        .collection(brandConfig.dbCollection)
        .find(tenantFilter(tenantId))
        .project({
          _id: 1,
          entity_name: 1,
          kanbanColumn: 1,
          createdAt: 1,
          updatedAt: 1,
          deals: 1,
          ticketSizeEstimate: 1,
          estimatedTicketSize: 1,
          actualDealValueUsd: 1,
          assignedToEmail: 1,
        })
        .toArray(),
      db
        .collection('outcomelogs')
        .find({
          ...tenantFilter(tenantId),
          createdAt: { $gte: windowStart },
        })
        .project({
          leadId: 1,
          createdAt: 1,
          beforeState: 1,
          afterState: 1,
        })
        .toArray(),
    ]);

    const leads: InspectionLeadInput[] = leadDocs.map((d: any) => ({
      _id: String(d._id),
      entity_name: d.entity_name || 'Unnamed Lead',
      kanbanColumn: d.kanbanColumn || 'DISCOVERED',
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      deals: d.deals,
      ticketSizeEstimate: d.ticketSizeEstimate,
      estimatedTicketSize: d.estimatedTicketSize,
      actualDealValueUsd: d.actualDealValueUsd,
      assignedToEmail: d.assignedToEmail,
    }));

    const logs: InspectionOutcomeLog[] = logDocs.map((l: any) => ({
      leadId: String(l.leadId),
      createdAt: l.createdAt,
      beforeState: l.beforeState,
      afterState: l.afterState,
    }));

    const report = computePipelineInspection(
      leads,
      logs,
      windowDays,
      now,
      brandConfig.currency || 'EUR'
    );

    return NextResponse.json({ inspection: report });
  } catch (error: any) {
    console.error('[GET /api/forecast/inspection] Error:', error);
    return NextResponse.json({ error: 'Failed to compute pipeline inspection' }, { status: 500 });
  }
}
