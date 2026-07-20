import { NextResponse } from 'next/server';
import { getClientPromise } from '../../../lib/mongodb';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const leadId = searchParams.get('leadId');
    const limit = Math.max(1, Math.min(500, parseInt(searchParams.get('limit') || '100') || 100));

    const client = await getClientPromise();
    const db = client.db();
    const filter: any = {};
    if (leadId) filter.leadId = leadId;

    const logs = await db.collection('outcomeLogs')
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return NextResponse.json({ logs });
  } catch (error) {
    console.error('Error fetching outcome logs:', error);
    return NextResponse.json({ error: 'Failed to fetch outcome logs' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { leadId, action, outcomeType, outcomeValue, teachingWeight, actorType, actedBy, beforeState, afterState } = body;

    if (!leadId || !action) {
      return NextResponse.json({ error: 'leadId and action are required' }, { status: 400 });
    }

    const client = await getClientPromise();
    const db = client.db();

    const log = {
      leadId,
      action,
      outcomeType: outcomeType || null,
      outcomeValue: outcomeValue || null,
      teachingWeight: teachingWeight || 1,
      actorType: actorType || 'user',
      actedBy: actedBy || 'anonymous',
      beforeState: beforeState || null,
      afterState: afterState || null,
      createdAt: new Date(),
    };

    const result = await db.collection('outcomeLogs').insertOne(log);

    // Update lead feedback counters if outcomeType is set
    if (outcomeType && leadId) {
      const update: any = {};
      if (outcomeType === 'accepted') {
        update.$inc = { acceptanceCount: 1, feedbackScore: (teachingWeight || 1) };
      } else if (outcomeType === 'declined') {
        update.$inc = { declineCount: 1, feedbackScore: -(teachingWeight || 1) };
        update.$set = { declinedAt: new Date(), declineReason: outcomeValue || 'OTHER' };
      } else if (outcomeType === 'won') {
        update.$inc = { wonCount: 1, feedbackScore: (teachingWeight || 1) * 2 };
      } else if (outcomeType === 'lost') {
        update.$inc = { lostCount: 1, feedbackScore: -(teachingWeight || 1) * 2 };
      }

      if (Object.keys(update).length > 0) {
        await db.collection('leads').updateOne({ _id: new (await import('mongodb')).ObjectId(leadId) }, update);
        await db.collection('seyu_leads').updateOne({ _id: new (await import('mongodb')).ObjectId(leadId) }, update);
      }
    }

    return NextResponse.json({ success: true, id: result.insertedId, log });
  } catch (error) {
    console.error('Error creating outcome log:', error);
    return NextResponse.json({ error: 'Failed to create outcome log' }, { status: 500 });
  }
}
