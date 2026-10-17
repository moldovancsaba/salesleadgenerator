import { NextRequest, NextResponse } from 'next/server';
import { getClientPromise, isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand, getBrandConfig, type Brand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { getTenantId } from '@/lib/tenant';
import { normalizeLead } from '@/app/lib/normalize-lead';
import { dedupeContacts, deriveContactEmails } from '@/lib/contacts';
import { buildFingerprint } from '@/lib/fingerprint';
import { computeIceScore, buildScoreProfile } from '@/lib/score-profile';
import { computeTicketSizeForLead } from '@/app/lib/ticket-size-store';
import { normalizeCountryToIso } from '@/lib/crm-lead-exchange';
import type { Lead, KanbanColumn } from '@/app/types';

export const dynamic = 'force-dynamic';

function computeEase(lead: Partial<Lead>): number {
  const contacts: any[] = Array.isArray(lead.contacts) ? lead.contacts : [];
  const effectiveNamed = contacts.some((c: any) => typeof c?.name === 'string' && c.name.trim().length > 0);
  const effectiveEmail = contacts.some((c: any) => typeof c?.email === 'string' && c.email.trim().length > 0);
  const effectivePhone = contacts.some((c: any) => typeof c?.phone === 'string' && c.phone.trim().length > 0);
  const effectiveAddress = !!lead.address;

  if (!effectiveNamed && !effectiveEmail) return 1;
  if (effectiveNamed && !effectiveEmail && !effectivePhone) return 3;
  if (effectiveNamed && effectiveAddress && !effectiveEmail && !effectivePhone) return 4;
  if (effectiveNamed && (effectiveEmail || effectivePhone) && !effectiveAddress) return 5;
  if (effectiveNamed && effectiveAddress && (effectiveEmail || effectivePhone) && !(effectiveEmail && effectivePhone)) return 6;
  if (effectiveNamed && effectiveAddress && effectiveEmail && effectivePhone) return 7;
  return 4;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const brandParam = body.brand || new URL(request.url).searchParams.get('brand') || 'seyu';
    const brand = await resolveBrand(brandParam);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const tenantId = body.tenantId || getTenantId(request) || 'default';
    const leadsInput: Partial<Lead>[] = Array.isArray(body.leads) ? body.leads : [];
    const preset = body.preset || 'google_sheets';
    const deduplicationPolicy = body.deduplicationPolicy || 'skip'; // 'skip' | 'update' | 'create_all'
    const defaultStage: KanbanColumn = body.defaultStage || 'DISCOVERED';

    if (leadsInput.length === 0) {
      return NextResponse.json({ error: 'No leads provided for import' }, { status: 400 });
    }

    const client = await getClientPromise();
    const db = client.db();
    const config = (await getBrandConfig(brand))!;
    const collection = db.collection(config.dbCollection);

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: Array<{ index: number; name?: string; error: string }> = [];

    const now = new Date().toISOString();

    for (let i = 0; i < leadsInput.length; i++) {
      const input = leadsInput[i];
      const entityName = (input.entity_name || '').trim();

      if (!entityName) {
        errors.push({ index: i, error: 'Missing organization or company name' });
        continue;
      }

      const country = normalizeCountryToIso(input.country);
      const url = input.url ? input.url.trim() : '';
      const region = input.region || (input.cityName ? `${input.cityName}, ${country}` : country);

      // Deduplicate and normalize contacts
      const contacts = dedupeContacts(input.contacts || [], { verify: true });
      const contactEmails = deriveContactEmails(contacts);

      const fingerprint = buildFingerprint(entityName, url, region);

      // Check if lead exists
      const existing = await collection.findOne({
        $or: [
          { fingerprint, tenantId },
          { fingerprint, tenantId: { $exists: false } },
          ...(contactEmails.length > 0 ? [{ contactEmails: { $in: contactEmails }, tenantId }] : []),
        ],
      });

      if (existing) {
        if (deduplicationPolicy === 'skip') {
          skipped++;
          continue;
        }

        if (deduplicationPolicy === 'update') {
          const updateFields: any = { updatedAt: now };

          if (!existing.url && url) updateFields.url = url;
          if (!existing.country && country) updateFields.country = country;
          if (!existing.cityName && input.cityName) updateFields.cityName = input.cityName;
          if (!existing.address && input.address) updateFields.address = input.address;
          if (!existing.industry && input.industry) updateFields.industry = input.industry;
          if (!existing.sport_or_sector && input.sport_or_sector) updateFields.sport_or_sector = input.sport_or_sector;
          if (!existing.notes && input.notes) updateFields.notes = input.notes;
          if (!existing.value_proposition && input.value_proposition) updateFields.value_proposition = input.value_proposition;

          // Merge tags
          const existingTags: string[] = Array.isArray(existing.tags) ? existing.tags : [];
          const newTags: string[] = Array.isArray(input.tags) ? input.tags : [];
          const mergedTags = Array.from(new Set([...existingTags, ...newTags, 'crm-import', `source:${preset}`]));
          updateFields.tags = mergedTags;

          // Merge contacts
          if (contacts.length > 0) {
            const mergedContacts = dedupeContacts([...(existing.contacts || []), ...contacts]);
            updateFields.contacts = mergedContacts;
            updateFields.contactEmails = deriveContactEmails(mergedContacts);
          }

          await collection.updateOne({ _id: existing._id }, { $set: updateFields });
          updated++;
          continue;
        }
      }

      // Create new lead
      const impact = input.ice?.impact || 5;
      const confidence = input.ice?.confidence || 5;
      const ease = input.ice?.ease || computeEase({ ...input, contacts });
      const iceScore = computeIceScore(impact, confidence, ease);
      const scoreProfile = buildScoreProfile(impact, confidence, ease);

      const kanbanColumn: KanbanColumn = input.kanbanColumn || defaultStage;

      const count = await collection.countDocuments({ kanbanColumn, tenantId });

      const ticketSizeEstimate = await computeTicketSizeForLead(db, brand, tenantId, {
        size: input.size,
        estimated_participants: Number(input.estimated_participants) || undefined,
        region,
      });

      const tags = Array.from(new Set([...(input.tags || []), 'crm-import', `source:${preset}`]));

      const doc = {
        id: Date.now() + i,
        region,
        country,
        entity_name: entityName,
        url: url || `https://${entityName.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`,
        contacts,
        contactEmails,
        address: input.address || '',
        cityName: input.cityName || '',
        general_contact: input.general_contact || '',
        size: input.size || '',
        industry: input.industry || '',
        sport_or_sector: input.sport_or_sector || '',
        level_league: input.level_league || '',
        pro_for_organization: input.pro_for_organization || [],
        con_for_organization: input.con_for_organization || [],
        value_proposition: input.value_proposition || '',
        estimated_annual_revenue_usd: input.estimated_annual_revenue_usd || 0,
        ticketSizeEstimate,
        status: 'new',
        notes: input.notes || '',
        tags,
        deals: [],
        checklist: [],
        source: `crm_import_${preset}`,
        kanbanColumn,
        sortOrder: count * 100,
        fingerprint,
        tenantId,
        ice: { impact, confidence, ease },
        iceScore,
        scoreProfile,
        createdAt: now,
        updatedAt: now,
      };

      await collection.insertOne(doc);
      created++;
    }

    return NextResponse.json({
      success: true,
      total: leadsInput.length,
      created,
      updated,
      skipped,
      errors,
    });
  } catch (error: any) {
    console.error('[leads/import POST] Error:', error);
    return NextResponse.json({ error: error?.message || 'Import failed' }, { status: 500 });
  }
}
