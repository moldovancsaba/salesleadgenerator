import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireSuperAdminSession } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { getBrandConfig, resolveBrand } from '@/app/lib/brand';

// Session-based, matching app/api/admin/duplicate-scan and
// app/api/admin/users/* — a human super admin reviewing pairs in the
// browser at /admin/duplicates.
export async function GET(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const brand = await resolveBrand(searchParams.get('brand') || undefined);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
  const tenantId = (searchParams.get('tenantId') || 'default').trim() || 'default';
  const status = (searchParams.get('status') || 'pending').trim();
  const config = await getBrandConfig(brand);
  if (!config) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  const client = await clientPromise;
  const db = client.db();

  const reviews = await db.collection('duplicate_reviews')
    .find({ tenantId, brand, status })
    .sort({ createdAt: -1 })
    .toArray();

  const leadIds = Array.from(new Set(reviews.flatMap((r: any) => [r.leadIdA, r.leadIdB])));
  const leadDocs = leadIds.length
    ? await db.collection(config.dbCollection)
        .find({ _id: { $in: leadIds.map((id) => new ObjectId(id)) } }, { projection: { entity_name: 1, url: 1, kanbanColumn: 1 } })
        .toArray()
    : [];
  const leadById = new Map(leadDocs.map((l: any) => [l._id.toString(), { entity_name: l.entity_name, url: l.url, kanbanColumn: l.kanbanColumn }]));

  return NextResponse.json({
    reviews: reviews.map((r: any) => ({
      id: r._id.toString(),
      leadA: { id: r.leadIdA, ...(leadById.get(r.leadIdA) || { entity_name: '(deleted lead)', url: undefined, kanbanColumn: undefined }) },
      leadB: { id: r.leadIdB, ...(leadById.get(r.leadIdB) || { entity_name: '(deleted lead)', url: undefined, kanbanColumn: undefined }) },
      score: r.score,
      matchedOn: r.matchedOn,
      status: r.status,
      createdAt: r.createdAt,
      reviewedAt: r.reviewedAt || null,
      reviewedBy: r.reviewedBy || null,
    })),
  });
}

export async function PATCH(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const reviewId = String(body.reviewId || '').trim();
  const status = String(body.status || '').trim();

  if (!reviewId || !['dismissed', 'confirmed'].includes(status)) {
    return NextResponse.json({ error: 'reviewId and a status of dismissed or confirmed are required' }, { status: 400 });
  }

  const client = await clientPromise;
  const db = client.db();

  const result = await db.collection('duplicate_reviews').findOneAndUpdate(
    { _id: new ObjectId(reviewId) },
    { $set: { status, reviewedAt: new Date(), reviewedBy: claimsOrResponse.email } },
    { returnDocument: 'after' }
  );

  if (!result) {
    return NextResponse.json({ error: 'Review not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, id: result._id.toString(), status: result.status });
}
