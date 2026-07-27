import { NextRequest, NextResponse } from 'next/server';
import { ObjectId, type Db } from 'mongodb';
import { requireSuperAdminSession } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { BRAND_CONFIG } from '@/app/lib/brand';
import { diffLeads, buildMergedLead, suggestPrimaryId } from '@/lib/lead-merge';
import type { Lead } from '@/app/types';

// Issue #129 — merges two confirmed-duplicate leads (issue #73's review
// queue, issue #128's diff/merge-rule engine). Session-gated, matching every
// other /admin/duplicates-adjacent route (app/api/duplicate-reviews/route.ts,
// app/api/admin/duplicate-scan/route.ts) — this is a human super admin
// action in the browser, never a machine caller.

type LoadReviewResult =
  | { error: NextResponse }
  | { db: Db; review: any; config: { label: string; dbCollection: string; apiPrefix: string }; leadA: Lead; leadB: Lead };

async function loadReviewAndLeads(reviewId: string): Promise<LoadReviewResult> {
  const client = await clientPromise;
  const db = client.db();

  let reviewObjectId: ObjectId;
  try {
    reviewObjectId = new ObjectId(reviewId);
  } catch {
    return { error: NextResponse.json({ error: 'Invalid reviewId' }, { status: 400 }) };
  }

  const review = await db.collection('duplicate_reviews').findOne({ _id: reviewObjectId });
  if (!review) {
    return { error: NextResponse.json({ error: 'Review not found' }, { status: 404 }) };
  }

  const config = BRAND_CONFIG[review.brand];
  if (!config) {
    return { error: NextResponse.json({ error: `Unknown brand on review row: ${review.brand}` }, { status: 400 }) };
  }

  const [leadADoc, leadBDoc] = await Promise.all([
    db.collection(config.dbCollection).findOne({ _id: new ObjectId(review.leadIdA) }),
    db.collection(config.dbCollection).findOne({ _id: new ObjectId(review.leadIdB) }),
  ]);

  if (!leadADoc || !leadBDoc) {
    return {
      error: NextResponse.json(
        { error: 'One or both leads in this pair no longer exist — they may have already been merged or deleted.' },
        { status: 404 }
      ),
    };
  }

  const leadA = { ...leadADoc, _id: leadADoc._id.toString() } as unknown as Lead;
  const leadB = { ...leadBDoc, _id: leadBDoc._id.toString() } as unknown as Lead;

  return { db, review, config, leadA, leadB };
}

// Preview only — never writes. Powers the merge UI's conflict picker before
// the operator commits anything.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const reviewId = (searchParams.get('reviewId') || '').trim();
  if (!reviewId) {
    return NextResponse.json({ error: 'reviewId is required' }, { status: 400 });
  }

  const loaded = await loadReviewAndLeads(reviewId);
  if ('error' in loaded) return loaded.error;
  const { review, leadA, leadB } = loaded;

  const classifications = diffLeads(leadA, leadB);

  return NextResponse.json({
    reviewId,
    status: review.status,
    leadA: { id: leadA._id, entity_name: leadA.entity_name, url: leadA.url, kanbanColumn: leadA.kanbanColumn, updatedAt: leadA.updatedAt },
    leadB: { id: leadB._id, entity_name: leadB.entity_name, url: leadB.url, kanbanColumn: leadB.kanbanColumn, updatedAt: leadB.updatedAt },
    suggestedPrimaryId: suggestPrimaryId(leadA, leadB),
    classifications,
  });
}

// Commits the merge: builds the merged document, repoints every collection
// that references the losing lead by _id, hard-deletes it, and closes out
// the driving duplicate_reviews row. Not reversible — see
// docs/ARCHITECTURE.md's "Duplicate Lead Merge" section for the owner's own
// confirmed choice of hard delete over soft-archive.
export async function POST(request: NextRequest): Promise<NextResponse> {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const reviewId = String(body.reviewId || '').trim();
  const primaryId = String(body.primaryId || '').trim();
  const resolutions: Record<string, 'A' | 'B'> = body.resolutions && typeof body.resolutions === 'object' ? body.resolutions : {};

  if (!reviewId || !primaryId) {
    return NextResponse.json({ error: 'reviewId and primaryId are required' }, { status: 400 });
  }

  const loaded = await loadReviewAndLeads(reviewId);
  if ('error' in loaded) return loaded.error;
  const { db, review, config, leadA, leadB } = loaded;

  // Merging is a special case of confirming a pair is genuinely a duplicate
  // — enforced server-side, not just by the UI only showing "Merge" on a
  // confirmed pair (a client-side-only gate is trivially bypassable).
  if (review.status !== 'confirmed') {
    return NextResponse.json({ error: 'Only a confirmed duplicate pair can be merged. Confirm the pair first.' }, { status: 400 });
  }

  if (primaryId !== leadA._id && primaryId !== leadB._id) {
    return NextResponse.json({ error: 'primaryId must be one of the two leads in this pair' }, { status: 400 });
  }

  let merged: Lead;
  try {
    // Re-diffed here, not trusting the client's claimed conflict list — the
    // lead may have changed since the preview GET, and this is the actual
    // safety net for that (a stale resolutions map now missing a real
    // conflict throws below, caught as a clean 400).
    merged = buildMergedLead(leadA, leadB, primaryId, resolutions);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Merge failed validation' }, { status: 400 });
  }

  const secondaryId = primaryId === leadA._id ? leadB._id : leadA._id;

  const { _id: _mergedId, ...mergedFields } = merged as any;
  await db.collection(config.dbCollection).updateOne(
    { _id: new ObjectId(primaryId) },
    { $set: mergedFields }
  );

  // Repoint every collection that references the losing lead by _id, so
  // nothing is silently orphaned by the delete below — see
  // docs/ARCHITECTURE.md for the full list this was audited against.
  await Promise.all([
    db.collection('outcomelogs').updateMany({ leadId: secondaryId }, { $set: { leadId: primaryId } }),
    db.collection('outreach_logs').updateMany({ leadId: secondaryId }, { $set: { leadId: primaryId } }),
    db.collection('duplicate_reviews').updateMany(
      { _id: { $ne: review._id }, leadIdA: secondaryId },
      { $set: { leadIdA: primaryId } }
    ),
    db.collection('duplicate_reviews').updateMany(
      { _id: { $ne: review._id }, leadIdB: secondaryId },
      { $set: { leadIdB: primaryId } }
    ),
  ]);

  // A different pair that referenced both the primary and secondary from
  // opposite sides now names the same lead on both sides — no longer a
  // meaningful "candidate duplicate pair," so it's removed rather than left
  // around as a row nothing can ever act on.
  await db.collection('duplicate_reviews').deleteMany({
    _id: { $ne: review._id },
    $expr: { $eq: ['$leadIdA', '$leadIdB'] },
  });

  await db.collection(config.dbCollection).deleteOne({ _id: new ObjectId(secondaryId) });

  await db.collection('duplicate_reviews').updateOne(
    { _id: review._id },
    { $set: { status: 'merged', reviewedAt: new Date(), reviewedBy: claimsOrResponse.email, mergedInto: primaryId } }
  );

  return NextResponse.json({ success: true, primaryId, secondaryId });
}
