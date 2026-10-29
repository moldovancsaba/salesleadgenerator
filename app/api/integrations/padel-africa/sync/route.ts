import { NextRequest, NextResponse } from 'next/server';
import { getClientPromise, isMongoConfigured } from '@/lib/mongodb';
import { syncPadelListingsToLeads } from '@/lib/padel-sync-service';
import { requireApiKey } from '@/lib/api-auth';

export async function POST(req: NextRequest) {
  const authDenied = requireApiKey(req);
  if (authDenied) {
    return authDenied;
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  try {
    const client = await getClientPromise();
    const db = client.db();
    const result = await syncPadelListingsToLeads(db);

    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Sync failed' }, { status: 500 });
  }
}
