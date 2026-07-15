import { NextResponse } from 'next/server';
import { getClientPromise } from '../../../../../lib/mongodb';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { leadId } = body;

    if (!leadId) {
      return NextResponse.json({ error: 'leadId is required' }, { status: 400 });
    }

    const client = await getClientPromise();
    const db = client.db();

    // Update enrichment status to pending
    const result = await db.collection('leads').updateOne(
      { _id: new (await import('mongodb')).ObjectId(leadId) },
      { $set: { enrichmentStatus: 'pending', enrichmentQueuedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'Enrichment queued', leadId });
  } catch (error) {
    console.error('Error queuing enrichment:', error);
    return NextResponse.json({ error: 'Failed to queue enrichment' }, { status: 500 });
  }
}
