import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminSession } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { tenantFilter } from '@/lib/tenant';
import { getBrandConfig, resolveBrand } from '@/app/lib/brand';
import { findCandidatePairs } from '@/lib/near-duplicate';

// Issue #107: findCandidatePairs() is O(n^2) over whatever it's given. This
// route previously fetched every lead in the brand/tenant with no limit —
// fine at hundreds of leads, a real timeout/DoS risk at tens of thousands.
// Capped at the count where O(n^2) bigram comparisons stay a
// sub-few-second, in-process scan; sorted by createdAt desc (newest first)
// so a truncated scan is at least deterministic across repeated runs rather
// than depending on Mongo's unspecified natural order.
// Issue #137: raised from 2000 once CogMap outgrew it (the newest-first cap
// meant its oldest leads were never compared at all). Measured locally with
// every lead in one sport (the worst case, since the sport gate is what
// normally skips most comparisons): ~1s at 2000, ~8s at 5000 — hence the
// explicit maxDuration below rather than relying on the platform default.
const MAX_SCAN_SIZE = 5000;
export const maxDuration = 60;

// A pair's identity is order-independent. findCandidatePairs() already
// emits sorted ids, but stored rows can be unsorted: a merge repoints the
// losing lead's id to the primary's on whichever side it sat (issue #137),
// so the lookup key is sorted on both sides rather than trusting either.
function pairKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

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
  const brand = await resolveBrand(body.brand);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
  const tenantId = (body.tenantId || 'default').trim() || 'default';
  const config = await getBrandConfig(brand);
  if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

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
    .find({ tenantId, brand }, { projection: { leadIdA: 1, leadIdB: 1, status: 1 } })
    .toArray();
  const alreadySeen = new Set(existing.map((r: any) => pairKey(String(r.leadIdA), String(r.leadIdB))));
  const decided = new Set(
    existing
      .filter((r: any) => r.status && r.status !== 'pending')
      .map((r: any) => pairKey(String(r.leadIdA), String(r.leadIdB)))
  );

  const newRows = pairs
    .filter((pair) => !alreadySeen.has(pairKey(pair.leadIdA, pair.leadIdB)))
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
    // Issue #137: candidatesFound also counts pairs a human already
    // dismissed or confirmed, and newPairs is 0 on every re-scan, so neither
    // shows whether the duplicate backlog is shrinking. This is the number
    // of candidate pairs found now that nobody has decided yet.
    unresolvedPairs: pairs.filter((pair) => !decided.has(pairKey(pair.leadIdA, pair.leadIdB))).length,
  });
}
