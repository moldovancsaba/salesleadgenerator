import { NextRequest, NextResponse } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { getTenantId, tenantFilter } from '@/lib/tenant';
import { mergeEnrichedContacts, dedupeContacts, deriveContactEmails } from '@/lib/contacts';
import { buildFingerprint } from '@/lib/fingerprint';
import { computeIceScore, buildScoreProfile } from '@/lib/score-profile';
import { computeTicketSizeForLead } from '@/app/lib/ticket-size-store';
import { normalizeCountryToIso } from '@/lib/crm-lead-exchange';
import { mapApolloPersonToLead, type ApolloRawPerson, type MappedApolloCandidate } from '@/lib/apollo-import';
import type { KanbanColumn } from '@/app/types';

export const dynamic = 'force-dynamic';

function extractHostname(rawUrl?: string | null): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  try {
    const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function computeEase(contacts: Array<{ name?: string; email?: string; phone?: string }>, hasAddress: boolean): number {
  const effectiveNamed = contacts.some((c) => Boolean(c.name && c.name.trim()));
  const effectiveEmail = contacts.some((c) => Boolean(c.email && c.email.trim()));
  const effectivePhone = contacts.some((c) => Boolean(c.phone && c.phone.trim()));
  if (!effectiveNamed && !effectiveEmail) return 1;
  if (effectiveNamed && !effectiveEmail && !effectivePhone) return 3;
  if (effectiveNamed && (effectiveEmail || effectivePhone) && !hasAddress) return 5;
  if (effectiveNamed && hasAddress && effectiveEmail && effectivePhone) return 7;
  return 5;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json().catch(() => ({}));
    const rawBrand = body.brand || new URL(request.url).searchParams.get('brand') || 'cogmap';
    const brand = await resolveBrand(rawBrand);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const tenantId = body.tenantId || getTenantId(request) || 'default';
    const deduplicationPolicy: 'skip' | 'update' = body.deduplicationPolicy === 'skip' ? 'skip' : 'update';
    const defaultStage: KanbanColumn = body.defaultStage || 'DISCOVERED';

    // Accept either already-mapped candidates (`candidates`) or raw Apollo person objects (`people`)
    const rawCandidates: MappedApolloCandidate[] = Array.isArray(body.candidates)
      ? body.candidates
      : Array.isArray(body.people)
      ? (body.people as ApolloRawPerson[]).map(mapApolloPersonToLead)
      : [];

    if (rawCandidates.length === 0) {
      return NextResponse.json({ error: 'No Apollo contacts provided for import' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const config = (await getBrandConfig(brand))!;
    const collection = db.collection(config.dbCollection);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const results: Array<{
      apolloPersonId: string;
      name: string;
      companyName: string;
      action: 'created' | 'updated' | 'skipped' | 'error';
      leadId?: string;
      missingFields: string[];
      error?: string;
    }> = [];

    const now = new Date().toISOString();
    const tFilter = tenantFilter(tenantId);

    for (let i = 0; i < rawCandidates.length; i++) {
      const candidate = rawCandidates[i];
      const payload = candidate.leadPayload || {};
      const entityName = (payload.entity_name || candidate.companyName || '').trim();

      if (!entityName) {
        results.push({
          apolloPersonId: candidate.apolloPersonId || String(i),
          name: candidate.name || '',
          companyName: '',
          action: 'error',
          missingFields: candidate.missingFields || [],
          error: 'Missing company/organization name',
        });
        continue;
      }

      const country = normalizeCountryToIso(payload.country || candidate.country);
      const url = (payload.url || candidate.companyWebsite || '').trim();
      const companyLinkedin = (payload.companyLinkedin || candidate.companyLinkedin || '').trim();
      const companyPhone = (payload.companyPhone || candidate.companyPhone || '').trim();
      const cityName = (payload.cityName || candidate.cityName || '').trim();
      const region = payload.region || (cityName ? `${cityName}, ${country}` : country);
      const industry = (payload.industry || candidate.industry || '').trim();

      const incomingContacts = dedupeContacts(payload.contacts || [], { verify: true });
      const contactEmails = deriveContactEmails(incomingContacts);
      const contactLinkedins = incomingContacts
        .map((c) => c.linkedin.trim())
        .filter(Boolean);

      const fingerprint = buildFingerprint(entityName, url, region);
      const host = extractHostname(url);

      const matchOr: Record<string, any>[] = [{ fingerprint }];
      if (contactEmails.length > 0) {
        matchOr.push({ contactEmails: { $in: contactEmails } });
      }
      if (contactLinkedins.length > 0) {
        matchOr.push({ 'contacts.linkedin': { $in: contactLinkedins } });
      }
      if (companyLinkedin) {
        matchOr.push({ companyLinkedin });
      }
      if (host) {
        matchOr.push({ url: { $regex: escapeRegex(host), $options: 'i' } });
      }

      const existing = await collection.findOne({
        $and: [tFilter, { $or: matchOr }],
      });

      if (existing) {
        const existingId = existing._id.toString();
        if (deduplicationPolicy === 'skip') {
          skipped++;
          results.push({
            apolloPersonId: candidate.apolloPersonId,
            name: candidate.name,
            companyName: entityName,
            action: 'skipped',
            leadId: existingId,
            missingFields: candidate.missingFields || [],
          });
          continue;
        }

        const mergedContacts = mergeEnrichedContacts(existing.contacts || [], incomingContacts, {
          verify: true,
        });
        const mergedEmails = deriveContactEmails(mergedContacts);

        // Check whether anything actually changed versus existing record (idempotent repeat check)
        const prevContactJson = JSON.stringify(dedupeContacts(existing.contacts || []));
        const nextContactJson = JSON.stringify(mergedContacts);
        const needsLeadFieldFill =
          (!existing.url && Boolean(url)) ||
          (!existing.companyLinkedin && Boolean(companyLinkedin)) ||
          (!existing.companyPhone && Boolean(companyPhone)) ||
          (!existing.industry && Boolean(industry)) ||
          (!existing.cityName && Boolean(cityName));

        if (prevContactJson === nextContactJson && !needsLeadFieldFill) {
          skipped++;
          results.push({
            apolloPersonId: candidate.apolloPersonId,
            name: candidate.name,
            companyName: entityName,
            action: 'skipped',
            leadId: existingId,
            missingFields: candidate.missingFields || [],
          });
          continue;
        }

        const updateFields: Record<string, any> = {
          contacts: mergedContacts,
          contactEmails: mergedEmails,
          updatedAt: now,
        };
        if (!existing.url && url) updateFields.url = url;
        if (!existing.companyLinkedin && companyLinkedin) updateFields.companyLinkedin = companyLinkedin;
        if (!existing.companyPhone && companyPhone) updateFields.companyPhone = companyPhone;
        if (!existing.industry && industry) updateFields.industry = industry;
        if (!existing.sport_or_sector && industry) updateFields.sport_or_sector = industry;
        if (!existing.cityName && cityName) updateFields.cityName = cityName;

        const existingTags = Array.isArray(existing.tags) ? existing.tags : [];
        updateFields.tags = Array.from(new Set([...existingTags, 'apollo-import', 'source:apollo']));

        await collection.updateOne({ _id: existing._id }, { $set: updateFields });
        updated++;
        results.push({
          apolloPersonId: candidate.apolloPersonId,
          name: candidate.name,
          companyName: entityName,
          action: 'updated',
          leadId: existingId,
          missingFields: candidate.missingFields || [],
        });
        continue;
      }

      const impact = 6;
      const confidence = 6;
      const ease = computeEase(incomingContacts, Boolean(cityName));
      const iceScore = computeIceScore(impact, confidence, ease);
      const scoreProfile = buildScoreProfile(impact, confidence, ease);
      const count = await collection.countDocuments({ kanbanColumn: defaultStage, tenantId });
      const ticketSizeEstimate = await computeTicketSizeForLead(db, brand, tenantId, {
        region,
      });

      const doc = {
        id: Date.now() + i,
        region,
        country,
        entity_name: entityName,
        url: url || `https://${entityName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
        companyLinkedin: companyLinkedin || '',
        companyPhone: companyPhone || '',
        contacts: incomingContacts,
        contactEmails,
        address: '',
        cityName,
        general_contact: '',
        size: '',
        industry,
        sport_or_sector: industry,
        level_league: '',
        pro_for_organization: [],
        con_for_organization: [],
        value_proposition: '',
        estimated_annual_revenue_usd: 0,
        ticketSizeEstimate,
        status: 'new',
        notes: '',
        tags: ['apollo-import', 'source:apollo'],
        deals: [],
        checklist: [],
        source: 'apollo',
        kanbanColumn: defaultStage,
        sortOrder: count * 100,
        fingerprint,
        tenantId,
        ice: { impact, confidence, ease },
        iceScore,
        scoreProfile,
        createdAt: now,
        updatedAt: now,
      };

      const insertRes = await collection.insertOne(doc);
      created++;
      results.push({
        apolloPersonId: candidate.apolloPersonId,
        name: candidate.name,
        companyName: entityName,
        action: 'created',
        leadId: insertRes.insertedId.toString(),
        missingFields: candidate.missingFields || [],
      });
    }

    return NextResponse.json({
      success: true,
      source: 'apollo',
      total: rawCandidates.length,
      created,
      updated,
      skipped,
      results,
    });
  } catch (error: any) {
    console.error('[API:integrations/apollo/import] POST error:', error);
    return NextResponse.json({ error: error?.message || 'Apollo import failed' }, { status: 500 });
  }
}
