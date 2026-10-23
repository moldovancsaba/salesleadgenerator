import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { resolveBrand } from '../../../lib/brand';
import { getTenantId } from '../../../../lib/tenant';
import { computeEngagementRates, type OutreachLogItem } from '../../../../lib/email-engagement';
import { computeCadenceVariantPerformance } from '../../../../lib/cadences';

export const dynamic = 'force-dynamic';

/**
 * GET /api/outreach/engagement?brand=<brand>
 * Returns email engagement metrics, unique rates (opens, clicks, replies, bounces),
 * status distribution, and standard tracking caveats disclosure (Vega CRM Phase 6 / Handoff 07).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brandParam = searchParams.get('brand') || searchParams.get('board') || 'cogmap';
    const brand = await resolveBrand(brandParam);

    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({
        brand,
        tenantId,
        rates: computeEngagementRates([]),
        variantPerformance: [],
        source: 'default',
      });
    }

    const client = await clientPromise;
    const db = client.db();

    const logs = await db
      .collection('outreach_logs')
      .find({ brand, tenantId })
      .sort({ createdAt: -1 })
      .limit(5000)
      .toArray();

    const outreachItems: OutreachLogItem[] = logs.map((log) => ({
      to: log.to,
      leadId: log.leadId,
      createdAt: log.createdAt,
      sentAt: log.createdAt,
      sendAttempted: log.sendAttempted,
      routingAllowed: log.routingAllowed,
      routingReason: log.routingReason,
      deliveryStatus: log.deliveryStatus,
      openCount: log.openCount,
      clickCount: log.clickCount,
      openedMachine: log.openedMachine,
      openedAt: log.openedAt,
      clickedAt: log.clickedAt,
      repliedAt: log.repliedAt,
      replyClass: log.replyClass,
      bouncedAt: log.bouncedAt,
      cancelledAt: log.cancelledAt,
    }));

    const rates = computeEngagementRates(outreachItems);
    const variantPerformance = computeCadenceVariantPerformance(
      logs.map((log) => ({
        cadenceId: log.cadenceId,
        stepIndex: log.stepIndex,
        cadenceVariant: log.cadenceVariant,
        sendAttempted: log.sendAttempted,
        routingAllowed: log.routingAllowed,
        bouncedAt: log.bouncedAt,
        cancelledAt: log.cancelledAt,
        openedAt: log.openedAt,
        openCount: log.openCount,
        openedMachine: log.openedMachine,
        clickedAt: log.clickedAt,
        clickCount: log.clickCount,
        repliedAt: log.repliedAt,
        replyClass: log.replyClass,
      }))
    );

    return NextResponse.json({
      brand,
      tenantId,
      rates,
      variantPerformance,
      source: 'mongodb',
    });
  } catch (error: any) {
    console.error('[API:outreach/engagement] Error:', error);
    return NextResponse.json({ error: 'Failed to compute engagement rates' }, { status: 500 });
  }
}
