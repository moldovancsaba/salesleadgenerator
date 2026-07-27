import { NextRequest, NextResponse } from 'next/server';
import { requireApiKey } from '@/lib/api-auth';
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb';
import { BRAND_CONFIG, resolveBrand, PRO_FIELD, CON_FIELD } from '@/app/lib/brand';
import { normalizeLead } from '@/app/lib/normalize-lead';
import { validateLeadPayload } from '@/lib/validate-lead';
import { dedupeContacts } from '@/lib/contacts';
import { buildFingerprint } from '@/lib/fingerprint';
import { computeTicketSizeForLead } from '@/app/lib/ticket-size-store';
import { computeIceScore, buildScoreProfile } from '@/lib/score-profile';

// TEMPORARY, one-time-use route — owner-directed bulk import of a curated
// CSV of discovery-stage soccer accounts with no known contact yet (2026-07-27
// session). To be removed from the codebase in the same session once the
// import has run; not a permanent admin capability (owner explicitly chose
// "one-off script, then remove it" over a reusable bulk-import tool).
//
// Mirrors app/api/leads/route.ts's real POST creation logic exactly —
// normalization, fingerprint-based dedup, ticket-size computation, ICE
// scoring — with exactly one deliberate difference: it does NOT enforce
// POST's creation-time quality gate ("very low ease/confidence requires a
// verified decision-maker contact"). That gate exists to stop the
// autonomous research agent from writing low-signal garbage; it isn't
// designed for a human-curated, explicitly-contact-less discovery-stage
// import, which is exactly what this dataset is. Every other real
// validation/dedup rule still applies.
//
// computeEase is duplicated (not imported) from app/api/leads/route.ts's
// private helper — deliberately, since this file is temporary and about to
// be deleted; extracting a new shared module for code with a days-long
// lifespan isn't worth the permanent refactor surface.
function computeEase(body: any): number {
  const contacts: any[] = Array.isArray(body.contacts) ? body.contacts : [];
  const effectiveNamed = contacts.some((c: any) => typeof c?.name === 'string' && c.name.trim().length > 0);
  const effectiveEmail = contacts.some((c: any) => typeof c?.email === 'string' && c.email.trim().length > 0);
  const effectivePhone = contacts.some((c: any) => typeof c?.phone === 'string' && c.phone.trim().length > 0);
  const effectiveAddress = !!body.address;
  const hasGeneral = !!body.general_contact;

  if (!effectiveNamed && !hasGeneral) return 1;
  if (!effectiveNamed && hasGeneral) return 2;
  if (effectiveNamed && !effectiveEmail && !effectivePhone) return 3;
  if (effectiveNamed && effectiveAddress && !effectiveEmail && !effectivePhone) return 4;
  if (effectiveNamed && (effectiveEmail || effectivePhone) && !effectiveAddress) return 5;
  if (effectiveNamed && effectiveAddress && (effectiveEmail || effectivePhone) && !(effectiveEmail && effectivePhone)) return 6;
  if (effectiveNamed && effectiveAddress && effectiveEmail && effectivePhone) return 7;
  return 4;
}

type ImportResult =
  | { index: number; status: 'created'; id: string; entity_name: string }
  | { index: number; status: 'duplicate'; entity_name: string; existingId: string }
  | { index: number; status: 'error'; entity_name: string; error: string };

export async function POST(request: NextRequest) {
  const authError = requireApiKey(request);
  if (authError) return authError;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const brand = resolveBrand(body.brand);
  const tenantId = (body.tenantId || 'default').trim() || 'default';
  const items: any[] = Array.isArray(body.leads) ? body.leads : [];
  if (items.length === 0) {
    return NextResponse.json({ error: 'leads must be a non-empty array' }, { status: 400 });
  }
  if (items.length > 200) {
    return NextResponse.json({ error: 'Max 200 leads per request — batch the import client-side' }, { status: 400 });
  }

  const config = BRAND_CONFIG[brand];
  const client = await getClientPromise();
  const db = client.db();
  const collection = db.collection(config.dbCollection);

  const results: ImportResult[] = [];
  const seenFingerprints = new Set<string>();

  for (let index = 0; index < items.length; index++) {
    const raw = items[index];
    const entityNameForReport = String(raw?.entity_name || raw?.name || `(row ${index})`);
    try {
      const validation = validateLeadPayload(raw, brand);
      if (!validation.valid) {
        results.push({ index, status: 'error', entity_name: entityNameForReport, error: validation.errors.join('; ') });
        continue;
      }

      const normalizedBody = normalizeLead(raw);
      normalizedBody.contacts = dedupeContacts(normalizedBody.contacts || [], { verify: true });

      const fingerprint = buildFingerprint(
        normalizedBody.entity_name || normalizedBody.name || '',
        normalizedBody.url || '',
        normalizedBody.region || 'US'
      );

      if (seenFingerprints.has(fingerprint)) {
        results.push({ index, status: 'duplicate', entity_name: entityNameForReport, existingId: '(duplicate within this import)' });
        continue;
      }

      const existing = await collection.findOne({
        fingerprint,
        $or: [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: 'default' }],
      });
      if (existing) {
        results.push({ index, status: 'duplicate', entity_name: entityNameForReport, existingId: existing._id.toString() });
        continue;
      }
      seenFingerprints.add(fingerprint);

      const impact = normalizedBody.ice?.impact || normalizedBody.impact || 5;
      const confidence = normalizedBody.ice?.confidence || normalizedBody.confidence || 5;
      const ease = computeEase(normalizedBody);
      const iceScore = computeIceScore(impact, confidence, ease);
      const scoreProfile = buildScoreProfile(impact, confidence, ease);

      const kanbanColumn = normalizedBody.kanbanColumn || 'DISCOVERED';
      const count = await collection.countDocuments({ kanbanColumn, tenantId });

      const ticketSizeEstimate = await computeTicketSizeForLead(db, brand, tenantId, {
        size: normalizedBody.size,
        estimated_participants: Number(normalizedBody.estimated_participants) || undefined,
        region: normalizedBody.region,
      });

      const newLead = {
        id: Date.now() + index,
        region: normalizedBody.region || 'US',
        entity_name: normalizedBody.entity_name || normalizedBody.name,
        url: normalizedBody.url || '',
        contacts: normalizedBody.contacts || [],
        address: normalizedBody.address || '',
        general_contact: normalizedBody.general_contact || '',
        size: normalizedBody.size || '',
        industry: normalizedBody.industry || '',
        sport_or_sector: normalizedBody.sport_or_sector || '',
        level_league: normalizedBody.level_league || '',
        [PRO_FIELD]: normalizedBody[PRO_FIELD] || [],
        [CON_FIELD]: normalizedBody[CON_FIELD] || [],
        value_proposition: normalizedBody.value_proposition || '',
        recommended_tier: normalizedBody.recommended_tier || '',
        estimated_participants: Number(normalizedBody.estimated_participants) || 0,
        estimated_annual_revenue_usd: Number(normalizedBody.estimated_annual_revenue_usd) || 0,
        revenue_model: normalizedBody.revenue_model || '',
        product_fit_notes: normalizedBody.product_fit_notes || '',
        pricingByCompany: normalizedBody.pricingByCompany || {},
        ticketSizeEstimate,
        status: normalizedBody.status || 'new',
        notes: normalizedBody.notes || '',
        tags: normalizedBody.tags || [],
        deals: [],
        checklist: [],
        source: typeof normalizedBody.source === 'string' && normalizedBody.source.trim() ? normalizedBody.source.trim() : 'csv_import',
        kanbanColumn,
        sortOrder: count * 100,
        fingerprint,
        tenantId,
        ice: { impact, confidence, ease },
        scoreProfile,
        qualityStatus: 'DRAFT',
        feedbackScore: 0,
        declineCount: 0,
        acceptanceCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const inserted = await collection.insertOne(newLead);
      results.push({ index, status: 'created', id: inserted.insertedId.toString(), entity_name: entityNameForReport });
    } catch (err: any) {
      results.push({ index, status: 'error', entity_name: entityNameForReport, error: err?.message || 'Unknown error' });
    }
  }

  const summary = {
    created: results.filter((r) => r.status === 'created').length,
    duplicate: results.filter((r) => r.status === 'duplicate').length,
    error: results.filter((r) => r.status === 'error').length,
  };

  return NextResponse.json({ summary, results });
}
