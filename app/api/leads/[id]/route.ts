import { NextResponse, type NextRequest } from 'next/server'
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb'
import { BRAND_CONFIG, resolveBrand, PRO_FIELD, CON_FIELD } from '../../../lib/brand'
import type { Brand } from '../../../lib/brand'
import { normalizeLead } from '../../../lib/normalize-lead'
import { requireApiKey } from '../../../../lib/api-auth'
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api'
import { validateLeadPayload } from '../../../../lib/validate-lead'
import { deriveKanbanColumn, isAutoManagedColumn } from '../../../../lib/kanban-column'
import { dedupeContacts, deriveContactEmails } from '../../../../lib/contacts'
import { verifyLeadContactsAsync } from '../../../lib/email-verification-store'
import { computeTicketSizeForLead } from '../../../lib/ticket-size-store'
import { getTenantId, tenantFilter as buildTenantFilter } from '../../../../lib/tenant'
import { generateClassificationTags, buildMergeKey } from '../../../../lib/lead-classification'
import { decodeHtmlEntities, decodeHtmlEntitiesInArray } from '../../../../lib/text-sanitize'

function getBrand(request: Request): Brand | null {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || url.searchParams.get('board') || 'cogmap';
  return resolveBrand(brandParam);
}

async function tryFindLead(db: any, config: any, tenantId: string, rawId: string) {
  const trimmed = rawId.trim();
  const filter = buildTenantFilter(tenantId);

  try {
    const lead = await db.collection(config.dbCollection).findOne({
      _id: new (await import('mongodb')).ObjectId(trimmed),
      ...filter,
    });
    if (lead) return lead;
  } catch {
    // not a valid ObjectId; fall through
  }

  const numericId = Number(trimmed);
  if (Number.isFinite(numericId)) {
    return db.collection(config.dbCollection).findOne({
      id: numericId,
      ...filter,
    });
  }

  // $and, not a sibling $or + ...filter spread — buildTenantFilter('default')
  // itself returns an object whose own top-level key is $or ({$or: [{tenantId:
  // 'default'}, {tenantId: {$exists: false}}]}). Spreading it alongside a
  // second, differently-intentioned $or key silently overwrote the first
  // (JS object spread — the later key wins), so this branch's actual id/_id
  // match was discarded for the 'default' tenant (the common case in this
  // app) and the query degraded to "any document in this tenant." A request
  // for a genuinely nonexistent id then returned a random other lead instead
  // of null — confirmed live (not assumed) via a real GET immediately after
  // a real DELETE, which returned an unrelated lead instead of 404.
  return db.collection(config.dbCollection).findOne({
    $and: [
      { $or: [{ id: trimmed }, { _id: trimmed }] },
      filter,
    ],
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const brand = getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const config = BRAND_CONFIG[brand];
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const clientPromise = getClientPromise()
    let lead: any = null

    try {
      const client = await clientPromise
      const db = client.db()
      lead = await tryFindLead(db, config, tenantId, id)
      if (lead) {
        lead = normalizeLead({ ...lead, _id: lead._id.toString() });
      }
    } catch {
      lead = null;
    }

    if (!lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    return NextResponse.json(lead)
  } catch (error: any) {
    console.error('GET lead/:id Error:', error)
    return NextResponse.json({ error: 'Failed to fetch lead', details: error.message }, { status: 500 })
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  try {
    const { id } = await params;
    const brand = getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const config = BRAND_CONFIG[brand];
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const body = await request.json();
    const clientPromise = getClientPromise()
    const db = clientPromise.then(client => client.db())
    const dbInstance = await db

    const existing = await tryFindLead(dbInstance, config, tenantId, id)
    if (!existing) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    const validation = validateLeadPayload(body, brand, { partial: true });
    if (!validation.valid) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 })
    }

    const updateData: Record<string, any> = {
      updatedAt: new Date(),
    };

    const allowedFields = [
      'entity_name', 'url', 'region', 'country', 'address', 'general_contact', 'size', 'industry',
      'sport_or_sector', 'level_league', 'value_proposition', 'notes', 'tags',
      'kanbanColumn', 'sortOrder', 'status', 'ice', 'iceScore',
      PRO_FIELD, CON_FIELD, 'contacts', 'qualityStatus',
      'recommended_tier', 'estimated_participants', 'estimated_annual_revenue_usd',
      'revenue_model', 'product_fit_notes', 'pricingByCompany',
      // Controlled sports-industry taxonomy (rulebook v1.0, 2026-07-28) —
      // classificationTags/mergeKey are deliberately excluded here: both are
      // always server-generated from the fields below (lib/lead-classification.ts),
      // never accepted as raw client input, so they can't silently drift
      // from what the other fields actually say.
      'sportCode', 'orgTypeCode', 'businessUnitCode', 'genderCode',
      'demographicCodes', 'competitionLevelCode', 'cityName',
      'parentOrgId', 'parentOrgName', 'relationshipToParent',
      'canonicalLeadName', 'classificationConfidence', 'classificationEvidence',
    ];

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    // Unlike POST (which runs the whole body through normalizeLead()'s
    // sanitizeString(), which decodes HTML-entity artifacts like "&amp;"),
    // this route copies these fields from the request body verbatim. The
    // agent-enrichment path (this route's most frequent caller) has
    // repeatedly produced literal "&amp;"/"&gt;"/"&lt;" instead of the plain
    // character across many separate real batches (issue #132) — decoding
    // here closes that at the storage boundary instead of relying on manual
    // per-batch catch-and-fix.
    if (typeof updateData.value_proposition === 'string') {
      updateData.value_proposition = decodeHtmlEntities(updateData.value_proposition);
    }
    if (typeof updateData.notes === 'string') {
      updateData.notes = decodeHtmlEntities(updateData.notes);
    }
    if (Array.isArray(updateData[PRO_FIELD])) {
      updateData[PRO_FIELD] = decodeHtmlEntitiesInArray(updateData[PRO_FIELD]);
    }
    if (Array.isArray(updateData[CON_FIELD])) {
      updateData[CON_FIELD] = decodeHtmlEntitiesInArray(updateData[CON_FIELD]);
    }

    // Unlike POST (which runs the whole body through normalizeLead()'s
    // ensureNumber() coercion), this loop copies `ice` from the request
    // body verbatim. validateLeadPayload only range-checks via Number(),
    // it never mutates the stored value — so a request with numerically
    // valid but string-typed ice fields (e.g. "8" instead of 8) would pass
    // validation and get persisted as strings, which then breaks the
    // ICE-score sort aggregation ($multiply requires numeric types).
    // Coerce here so every write path stores real numbers.
    if (body.ice !== undefined && typeof body.ice === 'object' && body.ice !== null) {
      updateData.ice = {
        impact: Number(body.ice.impact),
        confidence: Number(body.ice.confidence),
        ease: Number(body.ice.ease),
      };
    }

    // Shared with POST and PATCH MODIFY (lib/contacts.ts) — previously this route
    // had its own inline normalization and never deduped, unlike POST. Using the
    // same dedupeContacts() here closes that divergence (issue #45).
    // { verify: true } stamps lastVerifiedAt unconditionally for every contact in
    // the payload — this is the agent enrichment path ("PUT only changed
    // fields"), so a contact appearing here has just been confirmed (issue #66).
    if (body.contacts && Array.isArray(body.contacts)) {
      updateData.contacts = dedupeContacts(body.contacts, { verify: true });
      // Issue #142 — kept in sync alongside contacts[] on every write path.
      updateData.contactEmails = deriveContactEmails(updateData.contacts);
    }

    // Discovered/Qualified are auto-managed by ICE score alone: a score change
    // re-derives the column. Every other column is exclusively user-managed —
    // once a lead has been moved out (or an explicit kanbanColumn is sent in
    // the same request), it's never auto-reclassified again.
    if (body.ice !== undefined && body.kanbanColumn === undefined && isAutoManagedColumn(existing.kanbanColumn)) {
      const newIceScore = Number(body.ice.impact) * Number(body.ice.confidence) * Number(body.ice.ease);
      updateData.kanbanColumn = deriveKanbanColumn(newIceScore);
    }

    // Firmographic-tiered ticket-size estimate (issue #79) — recomputed on
    // every PUT (the agent enrichment path's most frequent write) using the
    // effective post-update size/participant count, so an update that first
    // sets `size` or `estimated_participants` immediately gets a real
    // estimate rather than waiting for a separate recalculation pass.
    // Skipped entirely when a rep has set a manual override (issue #86) —
    // an override permanently exempts the lead from this recompute, the
    // same guard lib/backfill-ticket-size.ts applies for its own triggers.
    if (existing.ticketSizeEstimate?.method !== 'manual_override') {
      updateData.ticketSizeEstimate = await computeTicketSizeForLead(dbInstance, brand, tenantId, {
        size: updateData.size !== undefined ? updateData.size : existing.size,
        estimated_participants: Number(
          updateData.estimated_participants !== undefined ? updateData.estimated_participants : existing.estimated_participants
        ) || undefined,
        region: updateData.region !== undefined ? updateData.region : existing.region,
      })
    }

    // classificationTags/mergeKey are always server-generated, never
    // accepted as raw input (see the allowedFields comment above) —
    // recomputed here from the effective post-update state (existing
    // fields merged with whatever this request just changed), the same
    // "always recompute the derived value on every write of its source
    // fields" convention this route already applies to ticketSizeEstimate
    // above and fingerprint/scoreProfile do elsewhere in this codebase.
    // Only actually generated once at least one classification field is
    // present (on this update or already stored) — a lead with none of
    // this taxonomy populated yet gets no tags/key rather than an
    // all-"unknown" placeholder that looks meaningful but isn't.
    const effectiveClassification = {
      parentOrgName: updateData.parentOrgName ?? existing.parentOrgName,
      sportCode: updateData.sportCode ?? existing.sportCode,
      orgTypeCode: updateData.orgTypeCode ?? existing.orgTypeCode,
      businessUnitCode: updateData.businessUnitCode ?? existing.businessUnitCode,
      genderCode: updateData.genderCode ?? existing.genderCode,
      demographicCodes: updateData.demographicCodes ?? existing.demographicCodes,
      country: updateData.country ?? existing.country,
      cityName: updateData.cityName ?? existing.cityName,
    };
    const hasAnyClassification = Boolean(
      effectiveClassification.sportCode || effectiveClassification.orgTypeCode
      || effectiveClassification.businessUnitCode || effectiveClassification.genderCode
      || (effectiveClassification.demographicCodes && effectiveClassification.demographicCodes.length > 0)
      || effectiveClassification.cityName || effectiveClassification.parentOrgName
    );
    if (hasAnyClassification) {
      updateData.classificationTags = generateClassificationTags(effectiveClassification);
      updateData.mergeKey = buildMergeKey(effectiveClassification);
    }

    // Issue #124/#149: Lead.activeCadence's own doc comment (app/types.ts)
    // promises auto-cancel on DECLINE/LOST — this direct-write path
    // (the agent enrichment path's `kanbanColumn` field) can also move a
    // lead to LOST, same as app/lib/lead-actions.ts's DECLINE/COLUMN_MOVE.
    if (updateData.kanbanColumn === 'LOST' && existing.activeCadence) {
      updateData.activeCadence = null;
    }

    const result = await dbInstance.collection(config.dbCollection).findOneAndUpdate(
      { _id: existing._id, ...buildTenantFilter(tenantId) },
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) {
      return NextResponse.json({ error: 'Lead not found after update' }, { status: 404 })
    }
    const updatedLead = result;

    // Only re-check emails that are new or changed vs. what was already
    // stored — re-verifying every contact on every PUT would waste DNS
    // lookups on emails whose domain-deliverability result hasn't gone
    // stale, and PUT is the agent enrichment path's most frequent write
    // (issue #67). Fire-and-forget, same as the CREATE path.
    if (updateData.contacts !== undefined) {
      const existingEmails = new Set(
        (existing.contacts || [])
          .map((c: any) => (typeof c?.email === 'string' ? c.email.toLowerCase().trim() : ''))
          .filter(Boolean)
      );
      const changedEmails = (updateData.contacts as Array<{ email?: string }>)
        .map((c) => c.email)
        .filter((email): email is string => !!email && !existingEmails.has(email.toLowerCase()));
      if (changedEmails.length > 0) {
        void verifyLeadContactsAsync(dbInstance, config.dbCollection, existing._id, changedEmails);
      }
    }

    // Every other kanbanColumn-changing path (ACCEPT/DECLINE/PIN/COLUMN_MOVE
    // in app/lib/lead-actions.ts, CREATE in app/api/leads/route.ts) writes an
    // outcomelogs entry; this PUT path previously didn't, making any lead
    // moved via PUT invisible to stage-transition analysis (issue #56).
    if (updateData.kanbanColumn !== undefined && updateData.kanbanColumn !== existing.kanbanColumn) {
      await dbInstance.collection('outcomelogs').insertOne({
        leadId: existing._id.toString(),
        action: 'PUT_COLUMN_CHANGE',
        outcomeType: 'PUT_COLUMN_CHANGE',
        outcomeValue: `Moved to ${updateData.kanbanColumn}`,
        actorType: 'USER',
        actedBy: 'webapp-user',
        beforeState: { kanbanColumn: existing.kanbanColumn, status: existing.status },
        afterState: { kanbanColumn: updateData.kanbanColumn, status: updateData.status ?? existing.status },
        createdAt: new Date(),
        tenantId,
      });
    }

    return NextResponse.json(normalizeLead({ ...updatedLead, _id: updatedLead._id.toString() }))
  } catch (error: any) {
    console.error('PUT lead/:id Error:', error)
    return NextResponse.json({ error: 'Failed to update lead', details: error.message }, { status: 500 })
  }
}

// No requireApiKey guard here, deliberately (issue #91's investigation):
// this is the browser's own Delete action (app/detail.tsx -> app/sales/
// [brand]/sales-page-client.tsx's handleDelete) — same "browser can't hold
// this secret safely" reasoning as PATCH /api/leads above and PUT
// /api/sales-settings/[brand]. Issue #104: gated by requireBrandAccessApi
// instead. PUT stays on its own separate requireApiKey guard — it's the
// external research agent's enrichment write path, never called from the
// browser (verified via grep, not assumed).
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const brand = getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const config = BRAND_CONFIG[brand];
    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 })
    }

    const clientPromise = getClientPromise()
    const db = await clientPromise.then(client => client.db())

    const existing = await tryFindLead(db, config, tenantId, id)
    if (!existing) {
      return NextResponse.json(
        { error: 'Lead not found' },
        { status: 404 }
      )
    }

    const result = await db.collection(config.dbCollection).deleteOne({
      _id: existing._id,
      ...buildTenantFilter(tenantId),
    })

    if (result.deletedCount === 0) {
      return NextResponse.json(
        { error: 'Lead not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE Error:', error)
    return NextResponse.json(
      { error: 'Failed to delete lead', details: error.message },
      { status: 500 }
    )
  }
}

export const dynamic = 'force-dynamic';
