import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb';
import { resolveBrand, getBrandConfig, type Brand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { getTenantId, tenantFilter } from '@/lib/tenant';
import { getQuoteByIdForTenant, markQuoteSent } from '@/app/lib/quotes-store';
import { isResendSendConfigured, sendQuoteEmail, type LeadForSend } from '@/lib/outreach-send';

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || 'cogmap';
  return await resolveBrand(brandParam);
}

// Deals: Quote generation — "Send" (issue #211). Requires status === 'draft'
// (a re-send of an already-sent quote is not this route's job — the same
// PDF stays valid, only the status/timestamp trail must not be re-stamped).
// Mirrors sendAutomatedEmail()'s/sendManualEmail()'s never-throw contract:
// a Resend-side failure returns { sent: false, reason } without mutating
// the quote's status, never a raw 500.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; quoteId: string }> }
) {
  try {
    const { id: leadId, quoteId } = await params;
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isResendSendConfigured()) {
      return NextResponse.json({ error: 'Email sending is not configured for this environment' }, { status: 503 });
    }
    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    // Client-generated once per Send click (crypto.randomUUID(), never
    // server-generated) — same convention as POST /api/outreach-send, so a
    // genuine network-level retry of the same click reuses the same key.
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : '';
    if (!idempotencyKey) {
      return NextResponse.json({ error: 'idempotencyKey is required' }, { status: 400 });
    }

    const tenantId = getTenantId(request);
    const client = await getClientPromise();
    const db = client.db();

    const quote = await getQuoteByIdForTenant(db, quoteId, tenantId);
    if (!quote || quote.leadId !== leadId) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    }
    if (quote.status !== 'draft') {
      return NextResponse.json({ error: `Cannot send a quote with status "${quote.status}"` }, { status: 409 });
    }

    const brandConfig = (await getBrandConfig(brand))!;
    const { ObjectId } = await import('mongodb');
    let leadDoc: any = null;
    try {
      leadDoc = await db.collection(brandConfig.dbCollection).findOne({ _id: new ObjectId(leadId), ...tenantFilter(tenantId) });
    } catch {
      leadDoc = null;
    }
    if (!leadDoc) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    }

    const lead: LeadForSend = {
      _id: leadId,
      entity_name: leadDoc.entity_name,
      contacts: leadDoc.contacts,
      url: leadDoc.url,
    };

    const origin = new URL(request.url).origin;
    const viewUrl = `${origin}/api/quotes/${quote._id}/view?token=${quote.shareToken}`;

    const result = await sendQuoteEmail(
      db,
      lead,
      { quoteId: quote._id, viewUrl, brandLabel: brandConfig.label, idempotencyKey },
      { brand, tenantId }
    );

    if (!result.sent) {
      return NextResponse.json({ sent: false, reason: result.reason }, { status: 200 });
    }

    const updated = await markQuoteSent(db, quote._id);
    return NextResponse.json({ sent: true, quote: updated ? { status: updated.status, sentAt: updated.sentAt } : { status: 'sent' } });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/quotes/[quoteId]/send Error:', error);
    return NextResponse.json({ error: 'Failed to send quote' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
