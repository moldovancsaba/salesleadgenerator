import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand, getBrandConfig } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { capturePayloadSchema, parseLinkedInLocation } from '@/lib/capture';
import { buildFingerprint } from '@/lib/fingerprint';
import { dedupeContacts, deriveContactEmails } from '@/lib/contacts';
import { computeTicketSizeForLead } from '@/app/lib/ticket-size-store';
import { ACTIVITY_LOG_COLLECTION, ensureActivityLogIndexes, truncateBody } from '@/app/lib/activity-log-store';
import { checkAndRecordRateLimit } from '@/app/lib/scheduling-store';

export const dynamic = 'force-dynamic';

function clientIp(request: NextRequest): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json().catch(() => ({}));
    const parseResult = capturePayloadSchema.safeParse(rawBody);

    if (!parseResult.success) {
      return NextResponse.json(
        {
          error: 'Invalid capture payload',
          issues: parseResult.error.issues.map((i: any) => ({ field: i.path.join('.'), message: i.message })),
        },
        { status: 400 }
      );
    }

    const payload = parseResult.data;
    const brand = await resolveBrand(payload.brand);
    if (!brand) {
      return NextResponse.json({ error: `Invalid brand: ${payload.brand}` }, { status: 400 });
    }

    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const client = await clientPromise;
    const db = client.db();
    const config = await getBrandConfig(brand);
    if (!config) {
      return NextResponse.json({ error: 'Brand configuration missing' }, { status: 500 });
    }

    // Rate limiting
    const ip = clientIp(request);
    const rateLimitAllowed = await checkAndRecordRateLimit(db, `${ip}|${brand}|linkedin-capture`);
    if (!rateLimitAllowed) {
      return NextResponse.json(
        { error: 'Too many captures — please slow down' },
        { status: 429 }
      );
    }

    const tenantId = 'default';
    const collection = db.collection(config.dbCollection);

    const now = new Date();
    const nowIso = now.toISOString();

    const companyName = payload.companyName || (payload.name ? `${payload.name}'s Organization` : 'Prospect Organization');
    const locationInfo = parseLinkedInLocation(payload.location);
    const country = locationInfo.country || 'HU';
    const region = locationInfo.region || locationInfo.city || 'EMEA';

    const normalizedLinkedin = payload.url.trim().replace(/\/+$/, '');
    const cleanEmail = payload.email?.toLowerCase().trim();

    // Check duplicate by LinkedIn URL across contacts, contacts.email, or company fingerprint
    const fingerprint = buildFingerprint(companyName, payload.websiteUrl || '', region);

    const orClauses: any[] = [
      { 'contacts.linkedin': { $regex: `^${normalizedLinkedin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
      { linkedin_url: { $regex: `^${normalizedLinkedin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
    ];
    if (cleanEmail) {
      orClauses.push({ contactEmails: cleanEmail });
    }
    orClauses.push({ fingerprint });

    const existing = await collection.findOne({
      $and: [
        { $or: [{ tenantId }, { tenantId: { $exists: false } }, { tenantId: 'default' }] },
        { $or: orClauses },
      ],
    });

    const newContact = {
      name: payload.name || 'Decision Maker',
      title: payload.jobTitle || payload.headline || 'Executive',
      email: cleanEmail || '',
      phone: payload.phone || '',
      linkedin: normalizedLinkedin,
      role: payload.headline || payload.jobTitle || 'Decision Maker',
      buyingRole: payload.buyingRole,
      isDecisionMaker: true,
      lastVerifiedAt: nowIso,
    };

    let leadId: string;
    let isCreated = false;

    if (existing) {
      leadId = existing._id.toString();
      const existingContacts = Array.isArray(existing.contacts) ? existing.contacts : [];
      const mergedContacts = dedupeContacts([...existingContacts, newContact], { verify: true });
      const contactEmails = deriveContactEmails(mergedContacts);

      const captureNote = `[LinkedIn Capture ${nowIso.slice(0, 10)}] ${payload.name || 'Profile'} (${payload.jobTitle || payload.headline || 'Contact'}): ${payload.url}` +
        (payload.bio ? `\nAbout: ${payload.bio}` : '') +
        (payload.notes ? `\nNotes: ${payload.notes}` : '');

      const updatedNotes = existing.notes ? `${existing.notes}\n\n${captureNote}` : captureNote;

      await collection.updateOne(
        { _id: existing._id },
        {
          $set: {
            contacts: mergedContacts,
            contactEmails,
            notes: updatedNotes,
            updatedAt: now,
          },
        }
      );
    } else {
      isCreated = true;
      const initialContacts = dedupeContacts([newContact], { verify: true });
      const contactEmails = deriveContactEmails(initialContacts);

      const ticketSizeEstimate = await computeTicketSizeForLead(db, brand, tenantId, {
        region,
      });

      const count = await collection.countDocuments({ kanbanColumn: 'DISCOVERED', tenantId });

      const newLeadDoc: any = {
        name: companyName,
        industry: 'Sports & Entertainment',
        country,
        region,
        address: payload.location || '',
        website: payload.websiteUrl || '',
        linkedin_url: normalizedLinkedin,
        contacts: initialContacts,
        contactEmails,
        notes: (payload.bio ? `About: ${payload.bio}\n` : '') +
               (payload.notes ? `Notes: ${payload.notes}\n` : '') +
               `Captured via LinkedIn Extension on ${nowIso.slice(0, 10)}.`,
        kanbanColumn: 'DISCOVERED',
        source: 'LINKEDIN_EXTENSION',
        tenantId,
        fingerprint,
        sortOrder: count * 100,
        ticketSizeEstimate,
        createdAt: now,
        updatedAt: now,
      };

      const result = await collection.insertOne(newLeadDoc);
      leadId = result.insertedId.toString();

      try {
        const { evaluateEventRules } = await import('@/app/lib/automation-store');
        await evaluateEventRules(db, brand, tenantId, 'lead_created', leadId, config.dbCollection);
      } catch (err) {
        console.error('[API:capture] automation evaluation failed', err);
      }

      try {
        const { emitWebhookEvent } = await import('@/app/lib/webhook-store');
        await emitWebhookEvent(db, brand, 'lead.created', {
          leadId,
          tenantId,
          lead: { ...newLeadDoc, _id: leadId },
        });
      } catch (err) {
        console.error('[API:capture] webhook emission failed', err);
      }
    }

    // Write activity log
    try {
      await ensureActivityLogIndexes(db);
      await db.collection(ACTIVITY_LOG_COLLECTION).insertOne({
        leadId,
        tenantId,
        brand,
        type: 'note',
        direction: 'inbound',
        fromAddress: cleanEmail || normalizedLinkedin,
        subject: `LinkedIn Lead Capture: ${payload.name || companyName}`,
        bodyExcerpt: truncateBody(
          `${payload.name || 'Decision Maker'} (${payload.jobTitle || payload.headline || 'Profile'})\n${normalizedLinkedin}`
        ),
        matchedContactKey: cleanEmail || normalizedLinkedin,
        source: 'manual',
        createdAt: now,
      });
    } catch (err) {
      console.error('[API:capture] activityLog insertion failed', err);
    }

    return NextResponse.json(
      {
        ok: true,
        leadId,
        created: isCreated,
        updated: !isCreated,
        brand,
        name: payload.name || companyName,
      },
      { status: isCreated ? 201 : 200 }
    );
  } catch (error: any) {
    console.error('[API:capture] Error:', error);
    return NextResponse.json({ error: 'Failed to process capture' }, { status: 500 });
  }
}
