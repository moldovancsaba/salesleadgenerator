import { NextResponse } from 'next/server';
import { getClientPromise } from '../../../../../lib/mongodb';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const days = Math.max(1, Math.min(365, parseInt(searchParams.get('days') || '30') || 30));

    const client = await getClientPromise();
    const db = client.db();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const leads = await db.collection('leads').find({ createdAt: { $gte: cutoff } }).toArray();

    const total = leads.length;
    const byColumn: Record<string, number> = {};
    const byRegion: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    let totalIce = 0;
    let iceCount = 0;
    let accepted = 0;
    let declined = 0;
    let won = 0;
    let lost = 0;

    for (const lead of leads) {
      byColumn[lead.kanbanColumn || 'UNKNOWN'] = (byColumn[lead.kanbanColumn || 'UNKNOWN'] || 0) + 1;
      byRegion[lead.region || 'UNKNOWN'] = (byRegion[lead.region || 'UNKNOWN'] || 0) + 1;
      bySource[lead.source || 'unknown'] = (bySource[lead.source || 'unknown'] || 0) + 1;

      if (lead.ice?.impact && lead.ice?.confidence && lead.ice?.ease) {
        totalIce += lead.ice.impact * lead.ice.confidence * lead.ice.ease;
        iceCount += 1;
      }

      if (lead.outcome === 'accepted') accepted += 1;
      if (lead.outcome === 'declined') declined += 1;
      if (lead.outcome === 'won') won += 1;
      if (lead.outcome === 'lost') lost += 1;
    }

    const avgIce = iceCount > 0 ? Math.round(totalIce / iceCount) : 0;
    const conversionRate = total > 0 ? Math.round(((accepted + won) / total) * 100) : 0;

    const metrics = {
      period: { days, from: cutoff.toISOString(), to: new Date().toISOString() },
      totals: { total, accepted, declined, won, lost, conversionRate },
      avgIce,
      breakdown: { byColumn, byRegion, bySource },
    };

    return NextResponse.json({ metrics });
  } catch (error) {
    console.error('Error computing metrics:', error);
    return NextResponse.json({ error: 'Failed to compute metrics' }, { status: 500 });
  }
}
