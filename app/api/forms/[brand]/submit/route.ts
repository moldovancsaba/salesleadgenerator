import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { resolveBrand, getBrandConfig } from '../../../../lib/brand';
import { checkAndRecordRateLimit } from '../../../../lib/scheduling-store';
import { buildFingerprint } from '../../../../../lib/fingerprint';
import { computeTicketSizeForLead } from '../../../../lib/ticket-size-store';
import { dedupeContacts, deriveContactEmails } from '../../../../../lib/contacts';
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes, truncateBody } from '../../../../lib/activity-log-store';
import { validateInboundFormSubmission, buildInboundLeadRecord } from '../../../../../lib/inbound-lead-form';

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ brand: string }> }
) {
  try {
    const { brand: brandParam } = await params;
    const brand = await resolveBrand(brandParam);
    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    const config = await getBrandConfig(brand);
    if (!config) {
      return NextResponse.json({ error: 'Brand configuration not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const validation = validateInboundFormSubmission(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const { data: submission } = validation;

    // Silent success for honeypot-triggered bot submissions
    if (submission.honeypotTriggered) {
      return NextResponse.json({ submitted: true }, { status: 201 });
    }

    if (!isMongoConfigured()) {
      return NextResponse.json(
        { error: 'Lead capture service is temporarily unavailable' },
        { status: 503 }
      );
    }

    const client = await clientPromise;
    const db = client.db();
    const tenantId = 'default';

    const allowed = await checkAndRecordRateLimit(db, `${clientIp(request)}|${brand}|inbound-form`);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many submissions — please try again in a few minutes' },
        { status: 429 }
      );
    }

    const fingerprint = buildFingerprint(
      submission.entityName,
      submission.websiteUrl,
      submission.region
    );

    const collection = db.collection(config.dbCollection);

    // Check if lead already exists by fingerprint or contact email
    const existing = await collection.findOne({
      $and: [
        { $or: [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: 'default' }] },
        {
          $or: [
            { fingerprint },
            { contactEmails: submission.contactEmail },
          ],
        },
      ],
    });

    let leadId: string;
    const now = new Date();
    const nowIso = now.toISOString();

    if (existing) {
      leadId = existing._id.toString();
      const mergedContacts = dedupeContacts(
        [
          ...(Array.isArray(existing.contacts) ? existing.contacts : []),
          {
            name: submission.contactName,
            title: submission.contactTitle,
            email: submission.contactEmail,
            ...(submission.contactPhone ? { phone: submission.contactPhone } : {}),
            isDecisionMaker: true,
            buyingRole: 'champion',
            lastVerifiedAt: nowIso,
          },
        ],
        { verify: true }
      );
      const contactEmails = deriveContactEmails(mergedContacts);
      const noteLine = submission.message
        ? `[Inbound Form ${nowIso.slice(0, 10)}] ${submission.contactName}: ${submission.message}`
        : `[Inbound Form ${nowIso.slice(0, 10)}] Repeat inquiry from ${submission.contactName} (${submission.contactEmail}).`;
      const updatedNotes = existing.notes ? `${existing.notes}\n${noteLine}` : noteLine;

      await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            contacts: mergedContacts,
            contactEmails,
            notes: updatedNotes,
            nextActionDueAt: nowIso,
            nextActionNote: `Follow up on inbound form inquiry from ${submission.contactName}`,
            updatedAt: now,
          },
        }
      );
    } else {
      // Look up default deal owner from sales settings if configured
      let assignedTo: string | undefined;
      try {
        const settingsDoc = await db.collection('company_settings').findOne({ brand, tenantId });
        const defaultOwnerEmail = settingsDoc?.defaultDealOwnerEmail;
        if (defaultOwnerEmail && typeof defaultOwnerEmail === 'string') {
          const ownerUser = await db.collection('user_access').findOne({
            email: { $regex: `^${defaultOwnerEmail.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
          });
          if (ownerUser?.ssoUserId) {
            assignedTo = ownerUser.ssoUserId;
          }
        }
      } catch {
        // Non-fatal
      }

      const ticketSizeEstimate = await computeTicketSizeForLead(db, brand, tenantId, {
        size: submission.organizationSize || undefined,
        region: submission.region,
      });

      const count = await collection.countDocuments({ kanbanColumn: 'DISCOVERED', tenantId });
      const newLead = buildInboundLeadRecord({
        submission,
        tenantId,
        fingerprint,
        sortOrder: count * 100,
        ticketSizeEstimate,
        assignedTo,
        now,
      });

      const insertResult = await collection.insertOne(newLead);
      leadId = insertResult.insertedId.toString();

      try {
        const { evaluateEventRules } = await import('../../../../lib/automation-store');
        await evaluateEventRules(db, brand, tenantId, 'lead_created', leadId, config.dbCollection);
      } catch (err) {
        console.error('[API:forms/submit] automation evaluation failed', err);
      }

      try {
        const { emitWebhookEvent } = await import('../../../../lib/webhook-store');
        await emitWebhookEvent(db, brand, 'lead.created', {
          leadId,
          tenantId,
          lead: { ...newLead, _id: leadId },
        });
      } catch (err) {
        console.error('[API:forms/submit] webhook emission failed', err);
      }
    }

    // Record inbound-form activity in activityLog
    try {
      await ensureActivityLogIndexes(db);
      await db.collection(ACTIVITY_LOG_COLLECTION).insertOne({
        leadId,
        tenantId,
        brand,
        type: 'note',
        direction: 'inbound',
        fromAddress: submission.contactEmail,
        subject: `Inbound Web Form: ${submission.entityName}`,
        bodyExcerpt: truncateBody(
          submission.message
            ? `${submission.contactName} (${submission.contactTitle}): ${submission.message}`
            : `Inbound inquiry submitted by ${submission.contactName} (${submission.contactEmail}).`
        ),
        matchedContactKey: submission.contactEmail,
        source: 'manual',
        createdAt: now,
      });
    } catch (err) {
      console.error('[API:forms/submit] activityLog write failed', err);
    }

    return NextResponse.json(
      {
        submitted: true,
        leadId,
        deduplicated: Boolean(existing),
      },
      { status: 201 }
    );
  } catch (error: any) {
    console.error('[API:forms/submit] POST error:', error);
    return NextResponse.json({ error: 'Failed to submit inquiry' }, { status: 500 });
  }
}
