import { NextResponse, type NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { getBrandConfig, resolveBrand } from '../../../../lib/brand';
import type { Brand, CurrencyCode } from '../../../../lib/brand';
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../../lib/tenant';
import { resolveSessionFromIdToken } from '../../../../../lib/session';
import { ACTIVITY_LOG_COLLECTION } from '../../../../lib/activity-log-store';
import {
  normalizeContact,
  dedupeContacts,
  deriveContactEmails,
  type NormalizedContact,
  type BuyingRole,
} from '../../../../../lib/contacts';
import { sanitizeDeal, type Deal } from '../../../../../lib/deals';
import { buildFingerprint } from '../../../../../lib/fingerprint';
import { computeIceScore } from '../../../../../lib/score-profile';
import {
  extractContactsFromEmailMessage,
  inferCompanyFromEmail,
  inferCountryFromDomain,
  formatLocalPartAsName,
} from '../../../../../lib/email-contact-extractor';
import { mergeContactsIntoLead } from '../../../../../lib/email-contact-merge';

export const dynamic = 'force-dynamic';

export interface ConvertInboxLeadRequest {
  threadId: string;
  action: 'create_lead' | 'add_deal' | 'attach_lead';
  existingLeadId?: string;
  lead?: {
    entity_name?: string;
    url?: string;
    country?: string;
    kanbanColumn?: string;
    industry?: string;
    notes?: string;
    contact?: {
      name?: string;
      email: string;
      title?: string;
      phone?: string;
      buyingRole?: BuyingRole;
      isDecisionMaker?: boolean;
    };
  };
  deal?: {
    createDeal?: boolean;
    value?: number;
    currency?: CurrencyCode;
    label?: string;
    pipelineId?: string;
    stageId?: string;
    expectedCloseDate?: string;
    probability?: number;
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ brand: string }> }
) {
  try {
    const { brand: rawBrand } = await params;
    const brand = await resolveBrand(rawBrand);
    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const tenantId = getTenantId(request);
    const body: ConvertInboxLeadRequest = await request.json().catch(() => ({}));
    const { threadId, action = 'create_lead', existingLeadId, lead, deal } = body;

    if (!threadId) {
      return NextResponse.json({ error: 'threadId is required' }, { status: 400 });
    }

    const client = await clientPromise;
    const db = client.db();
    const brandConfig = await getBrandConfig(brand);
    if (!brandConfig) {
      return NextResponse.json({ error: 'Brand configuration not found' }, { status: 404 });
    }
    const leadsCollection = brandConfig.dbCollection || 'leads';

    // 1. Fetch conversation messages for thread to harvest all contacts
    const [activityDocs, outreachDocs] = await Promise.all([
      db.collection(ACTIVITY_LOG_COLLECTION)
        .find({
          brand,
          tenantId,
          $or: [
            { threadId },
            { externalId: threadId },
            ...(threadId.startsWith('lead:') ? [{ leadId: threadId.replace(/^lead:/, '') }] : []),
          ],
        })
        .toArray()
        .catch(() => []),
      db.collection('outreach_logs')
        .find({
          brand,
          tenantId,
          $or: [{ gmailThreadId: threadId }, { resendEmailId: threadId }],
        })
        .toArray()
        .catch(() => []),
    ]);

    const harvestedContactsMap = new Map<string, NormalizedContact>();
    for (const doc of activityDocs) {
      const extracted = extractContactsFromEmailMessage(
        { from: doc.fromAddress || doc.from, to: doc.toAddresses || doc.to, cc: doc.ccAddresses, body: doc.bodyExcerpt },
        { brand }
      );
      for (const c of extracted) {
        if (!harvestedContactsMap.has(c.email)) harvestedContactsMap.set(c.email, c);
      }
    }
    for (const log of outreachDocs) {
      const extracted = extractContactsFromEmailMessage(
        { from: log.from, to: log.to ? [log.to] : undefined, body: log.body },
        { brand }
      );
      for (const c of extracted) {
        if (!harvestedContactsMap.has(c.email)) harvestedContactsMap.set(c.email, c);
      }
    }

    // ACTION: ADD DEAL TO EXISTING LEAD
    if (action === 'add_deal' || (action === 'attach_lead' && existingLeadId)) {
      const targetLeadId = existingLeadId || (threadId.startsWith('lead:') ? threadId.replace(/^lead:/, '') : undefined);
      if (!targetLeadId) {
        return NextResponse.json({ error: 'existingLeadId is required to attach or add deal' }, { status: 400 });
      }

      let leadObjId: ObjectId | null = null;
      const orClauses: any[] = [{ id: targetLeadId }];
      const num = Number(targetLeadId);
      if (!Number.isNaN(num)) orClauses.push({ id: num });
      if (ObjectId.isValid(targetLeadId)) {
        try {
          leadObjId = new ObjectId(targetLeadId);
          orClauses.push({ _id: leadObjId });
        } catch {
          // ignore
        }
      }

      const existingLead = await db.collection(leadsCollection).findOne({
        $or: orClauses,
        tenantId,
      });

      if (!existingLead) {
        return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
      }

      if (lead?.contact?.email) {
        const directContact = normalizeContact({
          name: lead.contact.name || formatLocalPartAsName(lead.contact.email.split('@')[0]),
          email: lead.contact.email,
          title: lead.contact.title,
          phone: lead.contact.phone,
          buyingRole: lead.contact.buyingRole || 'decision_maker',
          isDecisionMaker: lead.contact.isDecisionMaker ?? true,
          crmStatus: 'lead',
        });
        harvestedContactsMap.set(directContact.email, directContact);
      }

      // Auto-merge all harvested thread contacts into the existing lead
      const allHarvested = Array.from(harvestedContactsMap.values());
      if (allHarvested.length > 0) {
        await mergeContactsIntoLead(db, brand, tenantId, targetLeadId, allHarvested);
      }

      // Sanitize deal if provided
      let newDeal: Deal | null = null;
      const currentDeals: Deal[] = Array.isArray(existingLead.deals) ? [...existingLead.deals] : [];

      if (deal && deal.value && Number(deal.value) > 0) {
        newDeal = sanitizeDeal({
          value: deal.value,
          currency: deal.currency || 'USD',
          label: deal.label || `${existingLead.entity_name} - Deal`,
          pipelineId: deal.pipelineId,
          stageId: deal.stageId,
          expectedCloseDate: deal.expectedCloseDate,
          probability: deal.probability,
        });

        if (newDeal) {
          currentDeals.push(newDeal);
          await db.collection(leadsCollection).updateOne(
            { _id: existingLead._id },
            { $set: { deals: currentDeals, updatedAt: new Date() } }
          );
        }
      }

      // Re-link thread messages in activityLog & outreach_logs to this leadId
      const targetIdStr = existingLead._id.toString();
      await Promise.all([
        db.collection(ACTIVITY_LOG_COLLECTION).updateMany(
          {
            brand,
            tenantId,
            $or: [{ threadId }, { externalId: threadId }],
          },
          { $set: { leadId: targetIdStr } }
        ),
        db.collection('outreach_logs').updateMany(
          {
            brand,
            tenantId,
            $or: [{ gmailThreadId: threadId }, { resendEmailId: threadId }],
          },
          { $set: { leadId: targetIdStr } }
        ),
      ]);

      return NextResponse.json({
        ok: true,
        action,
        leadId: targetIdStr,
        deal: newDeal,
        deals: currentDeals,
      });
    }

    // ACTION: CREATE NEW LEAD (& DEAL)
    const primaryContactEmail = lead?.contact?.email || Array.from(harvestedContactsMap.keys())[0];
    if (!primaryContactEmail) {
      return NextResponse.json({ error: 'A primary contact email is required to convert to a lead' }, { status: 400 });
    }

    const companyInference = inferCompanyFromEmail(primaryContactEmail);
    const domain = companyInference?.domain || '';
    const inferredCompanyName = companyInference?.companyName || 'Inbound Prospect';
    const entityName = lead?.entity_name?.trim() || inferredCompanyName;
    const finalUrl = lead?.url?.trim() || (domain ? `https://${domain}` : `https://example.com`);
    const finalCountry = lead?.country?.trim().toUpperCase() || inferCountryFromDomain(domain);

    // Build contacts list: explicitly sent contact + all harvested email participants
    const contactsList: NormalizedContact[] = [];

    if (lead?.contact?.email) {
      contactsList.push(
        normalizeContact({
          name: lead.contact.name || formatLocalPartAsName(lead.contact.email.split('@')[0]),
          email: lead.contact.email,
          title: lead.contact.title || '',
          phone: lead.contact.phone || '',
          buyingRole: lead.contact.buyingRole || 'decision_maker',
          isDecisionMaker: lead.contact.isDecisionMaker !== false,
          crmStatus: 'lead',
        })
      );
    }

    for (const harvested of harvestedContactsMap.values()) {
      contactsList.push(harvested);
    }

    const finalContacts = dedupeContacts(contactsList, { verify: true });
    const contactEmails = deriveContactEmails(finalContacts);

    // Sanitize Deal if requested
    const dealsList: Deal[] = [];
    let createdDeal: Deal | null = null;
    if (deal && (deal.createDeal || deal.createDeal === undefined) && deal.value && Number(deal.value) > 0) {
      createdDeal = sanitizeDeal({
        value: deal.value,
        currency: deal.currency || 'USD',
        label: deal.label || `${entityName} - Initial Deal`,
        pipelineId: deal.pipelineId,
        stageId: deal.stageId,
        expectedCloseDate: deal.expectedCloseDate,
        probability: deal.probability,
      });
      if (createdDeal) {
        dealsList.push(createdDeal);
      }
    }

    const fingerprint = buildFingerprint(entityName, finalUrl, finalCountry);

    // Check for existing lead with identical fingerprint
    const existing = await db.collection(leadsCollection).findOne({
      fingerprint,
      $or: [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: 'default' }],
    });

    if (existing) {
      return NextResponse.json(
        {
          error: 'Duplicate lead detected for this organization',
          duplicate: true,
          existingLead: {
            id: existing._id.toString(),
            entity_name: existing.entity_name,
          },
        },
        { status: 409 }
      );
    }

    const now = new Date();
    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const repEmail = claims?.email;

    const newLeadDoc: Record<string, any> = {
      entity_name: entityName,
      url: finalUrl,
      country: finalCountry,
      kanbanColumn: lead?.kanbanColumn || 'IDENTIFIED',
      status: lead?.kanbanColumn || 'IDENTIFIED',
      industry: lead?.industry || '',
      notes: lead?.notes || `Converted from Inbox thread: ${threadId}`,
      contacts: finalContacts,
      contactEmails,
      deals: dealsList,
      fingerprint,
      tenantId,
      source: 'inbox_conversion',
      ice: {
        impact: 7,
        confidence: 7,
        ease: 7,
        score: computeIceScore(7, 7, 7),
      },
      assignedToEmail: repEmail || undefined,
      createdAt: now,
      updatedAt: now,
    };

    const insertResult = await db.collection(leadsCollection).insertOne(newLeadDoc as any);
    const newLeadId = insertResult.insertedId.toString();

    // Re-link all thread messages in activityLog and outreach_logs to this new lead
    await Promise.all([
      db.collection(ACTIVITY_LOG_COLLECTION).updateMany(
        {
          brand,
          tenantId,
          $or: [{ threadId }, { externalId: threadId }],
        },
        { $set: { leadId: newLeadId } }
      ),
      db.collection('outreach_logs').updateMany(
        {
          brand,
          tenantId,
          $or: [{ gmailThreadId: threadId }, { resendEmailId: threadId }],
        },
        { $set: { leadId: newLeadId } }
      ),
    ]);

    return NextResponse.json({
      ok: true,
      action: 'create_lead',
      leadId: newLeadId,
      lead: { ...newLeadDoc, _id: newLeadId },
      deal: createdDeal,
    });
  } catch (error: any) {
    console.error('POST /api/inbox/[brand]/convert Error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to convert email to lead and deal' }, { status: 500 });
  }
}
