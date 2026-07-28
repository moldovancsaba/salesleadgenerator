import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminSession } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { tenantFilter } from '@/lib/tenant';
import { BRAND_CONFIG, resolveBrand } from '@/app/lib/brand';
import { findCandidatePairs } from '@/lib/near-duplicate';

// Issue #107: findCandidatePairs() is O(n^2) over whatever it's given. This
// route previously fetched every lead in the brand/tenant with no limit —
// fine at hundreds of leads, a real timeout/DoS risk at tens of thousands.
// Capped at the count where O(n^2) bigram comparisons stay a
// sub-few-second, in-process scan; sorted by createdAt desc (newest first)
// so a truncated scan is at least deterministic across repeated runs rather
// than depending on Mongo's unspecified natural order.
const MAX_SCAN_SIZE = 2000;

// Session-based (not x-api-key), matching app/api/admin/users/*: this is a
// human clicking "Scan for duplicates" in a browser at /admin/duplicates,
// not the external research agent — the browser has no safe way to hold an
// API key, the same constraint documented elsewhere in this repo (e.g. PUT
// /api/sales-settings/[brand]).
export async function POST(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const brand = resolveBrand(body.brand);
  const tenantId = (body.tenantId || 'default').trim() || 'default';
  const config = BRAND_CONFIG[brand];

  const client = await clientPromise;
  const db = client.db();
  const filter = tenantFilter(tenantId);

  const totalAvailable = await db.collection(config.dbCollection).countDocuments(filter);

  const leads = await db.collection(config.dbCollection)
    .find(filter, { projection: { _id: 1, entity_name: 1, url: 1, sport_or_sector: 1, sportCode: 1 } })
    .sort({ createdAt: -1 })
    .limit(MAX_SCAN_SIZE)
    .toArray();

  const candidates = leads.map((l: any) => ({
    _id: l._id.toString(), entity_name: l.entity_name, url: l.url,
    sport_or_sector: l.sport_or_sector, sportCode: l.sportCode,
  }));
  const pairs = findCandidatePairs(candidates);

  // Every prior scan's rows (any status) mark a pair as already reviewed —
  // avoids re-inserting a duplicate row for a pair a human already
  // dismissed or confirmed on an earlier scan (issue #73's own requirement
  // that a dismissal decision doesn't resurface on a later scan).
  const existing = await db.collection('duplicate_reviews')
    .find({ tenantId, brand }, { projection: { leadIdA: 1, leadIdB: 1 } })
    .toArray();
  const alreadySeen = new Set(existing.map((r: any) => `${r.leadIdA}:${r.leadIdB}`));

  const newRows = pairs
    .filter((pair) => !alreadySeen.has(`${pair.leadIdA}:${pair.leadIdB}`))
    .map((pair) => ({
      tenantId,
      brand,
      leadIdA: pair.leadIdA,
      leadIdB: pair.leadIdB,
      score: pair.score,
      matchedOn: pair.matchedOn,
      status: 'pending' as const,
      createdAt: new Date(),
    }));

  if (newRows.length > 0) {
    await db.collection('duplicate_reviews').insertMany(newRows);
  }

  return NextResponse.json({
    scanned: leads.length,
    totalAvailable,
    truncated: totalAvailable > leads.length,
    candidatesFound: pairs.length,
    newPairs: newRows.length,
  });
}
