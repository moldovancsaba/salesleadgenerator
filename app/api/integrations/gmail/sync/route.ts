import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { requireCronOrApiKey, requireApiKey } from '../../../../../lib/api-auth';
import { getAllBrandConfigs } from '../../../../lib/brand';
import { pollGmailForBrand } from '../../../../lib/gmail-sync-store';

const TENANT_ID = 'default'; // matches cadence-tick's own convention

// Issue #216 — periodic Gmail poll, one brand's single Gmail connection per
// tick (see app/lib/gmail-sync-store.ts's own header comment on why this is
// per-brand, not per-rep — a disclosed scope note against the issue's own
// "every rep" framing). Mirrors app/api/admin/cadence-tick/route.ts's exact
// shape: requireCronOrApiKey gate, a per-brand loop via getAllBrandConfigs(),
// and a failure in one brand never blocks another.
export async function GET(request: NextRequest) {
  const authResponse = requireCronOrApiKey(request);
  if (authResponse) return authResponse;
  return runSync();
}

export async function POST(request: NextRequest) {
  const authResponse = requireApiKey(request);
  if (authResponse) return authResponse;
  return runSync();
}

async function runSync() {
  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const client = await clientPromise;
  const db = client.db();
  const allBrandConfigs = await getAllBrandConfigs();

  let processed = 0;
  let ingested = 0;
  let skipped = 0;
  const failures: Array<{ brand: string; reason: string }> = [];

  for (const brand of Object.keys(allBrandConfigs)) {
    processed++;
    try {
      const result = await pollGmailForBrand(db, brand, TENANT_ID);
      ingested += result.ingested;
      skipped += result.skipped;
      if (result.failure) failures.push({ brand, reason: result.failure });
    } catch (error: any) {
      failures.push({ brand, reason: error?.message || 'unexpected_error' });
    }
  }

  return NextResponse.json({ ranAt: new Date().toISOString(), processed, ingested, skipped, failures });
}

export const dynamic = 'force-dynamic';
