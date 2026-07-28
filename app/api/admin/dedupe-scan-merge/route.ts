import { NextRequest, NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { requireApiKey } from '@/lib/api-auth';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { tenantFilter } from '@/lib/tenant';
import { BRAND_CONFIG, resolveBrand } from '@/app/lib/brand';
import { findCandidatePairs } from '@/lib/near-duplicate';
import { diffLeads, buildMergedLead, suggestPrimaryId } from '@/lib/lead-merge';
import type { Lead } from '@/app/types';

// TEMPORARY, one-time-use admin route — owner request 2026-07-28, "run a
// full duplication search for all leads we have so far and merge all
// safely mergeable." x-api-key gated (not session), matching the same
// precedent as the 2026-07-27 CSV bulk-import temp route: the owner has no
// terminal/CLI/Vercel-dashboard access, and this session cannot fabricate a
// real signed SSO session token to call the existing session-only
// /api/admin/duplicate-scan, /api/duplicate-reviews, and
// /api/duplicate-reviews/merge routes directly. This route reuses those
// routes' own real logic (lib/near-duplicate.ts, lib/lead-merge.ts) rather
// than reimplementing it, and writes to the same `duplicate_reviews`
// collection those routes use, so /admin/duplicates shows a normal,
// consistent history afterward. Delete this route after use and record the
// deletion in CHANGELOG.md, per this repo's own established pattern.
//
// "Safely mergeable" = diffLeads() finds zero 'conflict'-kind field
// classifications — i.e. every field either matches, is present on only one
// side, or is auto-resolvable by a rule already built into the merge engine.
// This is the app's own existing definition of a merge that needs no human
// judgment call, not a new bar invented for this route.

const MAX_LEADS_PER_SCAN = 5000; // cogmap is ~2178 as of 2026-07-28; generous headroom
const MAX_MERGES_PER_CALL = 500; // safety valve, not expected to be hit

type MergedRecord = { leadIdA: string; leadIdB: string; primaryId: string; secondaryId: string; entityNameA: string; entityNameB: string; score: number; matchedOn: string };
type SkippedRecord = { leadIdA: string; leadIdB: string; entityNameA: string; entityNameB: string; score: number; matchedOn: string; conflictFields: string[] };

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const brand = resolveBrand(body.brand);
  const tenantId = 'default';
  const dryRun = body.dryRun !== false; // default true — a caller must explicitly pass dryRun:false to write anything
  const config = BRAND_CONFIG[brand];

  const client = await clientPromise;
  const db = client.db();
  const filter = tenantFilter(tenantId);

  const totalAvailable = await db.collection(config.dbCollection).countDocuments(filter);

  const scanDocs = await db.collection(config.dbCollection)
    .find(filter, { projection: { _id: 1, entity_name: 1, url: 1 } })
    .limit(MAX_LEADS_PER_SCAN)
    .toArray();

  const candidates = scanDocs.map((l: any) => ({ _id: l._id.toString(), entity_name: l.entity_name, url: l.url }));
  const pairs = findCandidatePairs(candidates);

  // Same "don't resurface an already-reviewed pair" rule the real scan route
  // uses, so re-running this (e.g. after fixing a bug) doesn't spam
  // duplicate_reviews with rows for pairs already merged/dismissed/pending.
  const existingReviews = await db.collection('duplicate_reviews')
    .find({ tenantId, brand }, { projection: { leadIdA: 1, leadIdB: 1 } })
    .toArray();
  const alreadySeen = new Set(existingReviews.map((r: any) => `${r.leadIdA}:${r.leadIdB}`));
  const newPairs = pairs.filter((p) => !alreadySeen.has(`${p.leadIdA}:${p.leadIdB}`));

  // Diagnostic short-circuit — returns immediately after the cheap counting
  // stage, skipping the batch fetch and per-pair loop entirely. Added
  // 2026-07-28 while isolating a real timeout against CogMap's ~2189 leads
  // that survived two separate performance fixes already in this route's
  // history (see CHANGELOG 2.4.105/2.4.106) — this tells us whether the
  // remaining cost is in candidate-pair volume itself or still downstream.
  if (body.diagnosticOnly === true) {
    return NextResponse.json({
      diagnosticOnly: true,
      brand,
      scanned: scanDocs.length,
      totalAvailable,
      truncatedScan: totalAvailable > scanDocs.length,
      candidatePairsFound: pairs.length,
      existingReviewRows: existingReviews.length,
      newPairsThisRun: newPairs.length,
    });
  }

  // Batch-fetch every lead referenced by any new candidate pair exactly
  // once, instead of two findOne() round-trips per pair (found while
  // running this against real CogMap data, 2026-07-28: with thousands of
  // new candidate pairs on a first-ever scan, that was thousands of
  // sequential network round-trips to MongoDB Atlas and the request never
  // completed within any reasonable timeout — a much bigger cost than the
  // O(n^2) bigram-computation fix in the same release). A lead referenced
  // by an earlier pair in this same run may get merged away (deleted) or
  // updated (become a merge's primary) — the map below is kept in sync as
  // merges happen, so a later pair sharing that lead sees its current
  // state without any further DB read.
  const referencedIds = new Set<string>();
  for (const p of newPairs) {
    referencedIds.add(p.leadIdA);
    referencedIds.add(p.leadIdB);
  }
  const leadDocs = referencedIds.size
    ? await db.collection(config.dbCollection)
        .find({ _id: { $in: Array.from(referencedIds).map((id) => new ObjectId(id)) } })
        .toArray()
    : [];
  const leadMap = new Map<string, Lead>(
    leadDocs.map((doc: any) => [doc._id.toString(), { ...doc, _id: doc._id.toString() } as unknown as Lead])
  );

  const merged: MergedRecord[] = [];
  const skippedForReview: SkippedRecord[] = [];
  const skippedAlreadyGone: Array<{ leadIdA: string; leadIdB: string }> = [];
  const pendingReviewRows: any[] = [];
  let mergeCount = 0;

  for (const pair of newPairs) {
    const leadA = leadMap.get(pair.leadIdA);
    const leadB = leadMap.get(pair.leadIdB);

    if (!leadA || !leadB) {
      skippedAlreadyGone.push({ leadIdA: pair.leadIdA, leadIdB: pair.leadIdB });
      continue;
    }

    const classifications = diffLeads(leadA, leadB);
    const conflicts = classifications.filter((c) => c.kind === 'conflict');

    if (conflicts.length > 0) {
      skippedForReview.push({
        leadIdA: pair.leadIdA,
        leadIdB: pair.leadIdB,
        entityNameA: leadA.entity_name,
        entityNameB: leadB.entity_name,
        score: pair.score,
        matchedOn: pair.matchedOn,
        conflictFields: conflicts.map((c) => c.field),
      });
      pendingReviewRows.push({
        tenantId, brand, leadIdA: pair.leadIdA, leadIdB: pair.leadIdB,
        score: pair.score, matchedOn: pair.matchedOn, status: 'pending', createdAt: new Date(),
      });
      continue;
    }

    // Zero conflicts — safe to auto-merge, same standard the real merge UI
    // uses to tell an operator "nothing here needs your judgment."
    const primaryId = suggestPrimaryId(leadA, leadB);
    const secondaryId = primaryId === leadA._id ? leadB._id : leadA._id;

    if (dryRun) {
      merged.push({
        leadIdA: pair.leadIdA, leadIdB: pair.leadIdB, primaryId, secondaryId,
        entityNameA: leadA.entity_name, entityNameB: leadB.entity_name,
        score: pair.score, matchedOn: pair.matchedOn,
      });
      continue;
    }

    if (mergeCount >= MAX_MERGES_PER_CALL) {
      // No silent truncation — record what didn't get processed this call.
      skippedForReview.push({
        leadIdA: pair.leadIdA, leadIdB: pair.leadIdB,
        entityNameA: leadA.entity_name, entityNameB: leadB.entity_name,
        score: pair.score, matchedOn: pair.matchedOn, conflictFields: [],
      });
      continue;
    }

    let mergedLead: Lead;
    try {
      mergedLead = buildMergedLead(leadA, leadB, primaryId, {});
    } catch (err: any) {
      // A pair diffLeads() found zero conflicts for should never throw here
      // — buildMergedLead's own conflict check is a redundant safety net,
      // not expected to fire, but if it somehow does, don't merge blind.
      skippedForReview.push({
        leadIdA: pair.leadIdA, leadIdB: pair.leadIdB,
        entityNameA: leadA.entity_name, entityNameB: leadB.entity_name,
        score: pair.score, matchedOn: pair.matchedOn, conflictFields: [`buildMergedLead threw: ${err?.message}`],
      });
      continue;
    }

    const { _id: _mergedId, ...mergedFields } = mergedLead as any;
    await db.collection(config.dbCollection).updateOne({ _id: new ObjectId(primaryId) }, { $set: mergedFields });

    await Promise.all([
      db.collection('outcomelogs').updateMany({ leadId: secondaryId }, { $set: { leadId: primaryId } }),
      db.collection('outreach_logs').updateMany({ leadId: secondaryId }, { $set: { leadId: primaryId } }),
      db.collection('duplicate_reviews').updateMany({ leadIdA: secondaryId }, { $set: { leadIdA: primaryId } }),
      db.collection('duplicate_reviews').updateMany({ leadIdB: secondaryId }, { $set: { leadIdB: primaryId } }),
    ]);
    await db.collection('duplicate_reviews').deleteMany({ $expr: { $eq: ['$leadIdA', '$leadIdB'] } });
    await db.collection(config.dbCollection).deleteOne({ _id: new ObjectId(secondaryId) });

    await db.collection('duplicate_reviews').insertOne({
      tenantId, brand, leadIdA: pair.leadIdA, leadIdB: pair.leadIdB,
      score: pair.score, matchedOn: pair.matchedOn, status: 'merged',
      createdAt: new Date(), reviewedAt: new Date(),
      reviewedBy: 'automated-dedupe-2026-07-28', mergedInto: primaryId,
    });

    // Keep the in-memory map consistent with what's now actually in the DB,
    // so a later pair in this same run that also references either lead
    // sees the merge's outcome without a further round-trip.
    leadMap.set(primaryId, mergedLead);
    leadMap.delete(secondaryId);

    merged.push({
      leadIdA: pair.leadIdA, leadIdB: pair.leadIdB, primaryId, secondaryId,
      entityNameA: leadA.entity_name, entityNameB: leadB.entity_name,
      score: pair.score, matchedOn: pair.matchedOn,
    });
    mergeCount += 1;
  }

  if (!dryRun && pendingReviewRows.length > 0) {
    await db.collection('duplicate_reviews').insertMany(pendingReviewRows);
  }

  return NextResponse.json({
    dryRun,
    brand,
    scanned: scanDocs.length,
    totalAvailable,
    truncatedScan: totalAvailable > scanDocs.length,
    candidatePairsFound: pairs.length,
    newPairsThisRun: newPairs.length,
    safelyMergeable: merged.length,
    needsHumanReview: skippedForReview.length,
    alreadyGone: skippedAlreadyGone.length,
    merged,
    needsReviewDetail: skippedForReview,
  });
}
