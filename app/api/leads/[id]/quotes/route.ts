import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb';
import { resolveBrand, type Brand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { resolveSessionFromIdToken } from '@/lib/session';
import { getTenantId } from '@/lib/tenant';
import { createQuote, listQuotesForLead } from '@/app/lib/quotes-store';
import { toPublicQuote } from '@/lib/quotes';
import { isBlobConfigured } from '@/lib/blob-storage';
import { isResendSendConfigured } from '@/lib/outreach-send';

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || 'cogmap';
  return await resolveBrand(brandParam);
}

function viewUrl(origin: string, quoteId: string, shareToken: string): string {
  return `${origin}/api/quotes/${quoteId}/view?token=${shareToken}`;
}

// Deals: Quote generation (issue #211). GET lists a lead's quotes (newest
// first) plus canGenerate/canSend feature-detection flags — an additive
// field beyond the issue's own literal §10 response shape, needed so
// app/detail.tsx can render "Generate Quote"/"Send" disabled (not merely
// error-prone) per CLAUDE.md Rule 7 without re-deriving config-detection
// logic client-side.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const tenantId = getTenantId(request);
    const client = await getClientPromise();
    const db = client.db();
    const quotes = await listQuotesForLead(db, tenantId, id);
    const origin = new URL(request.url).origin;

    return NextResponse.json({
      quotes: quotes.map((q) => toPublicQuote(q, viewUrl(origin, q._id, q.shareToken))),
      canGenerate: isBlobConfigured(),
      canSend: isResendSendConfigured(),
    });
  } catch (error: any) {
    console.error('GET /api/leads/[id]/quotes Error:', error);
    return NextResponse.json({ error: 'Failed to fetch quotes' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const brand = await getBrand(request);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isBlobConfigured()) {
      return NextResponse.json({ error: 'File storage is not configured' }, { status: 503 });
    }
    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const body = await request.json().catch(() => ({}));
    const dealId = typeof body.dealId === 'string' ? body.dealId : '';
    if (!dealId) {
      return NextResponse.json({ error: 'dealId is required' }, { status: 400 });
    }

    const tenantId = getTenantId(request);
    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const actorId = claims?.email || 'webapp-user';

    const client = await getClientPromise();
    const db = client.db();
    const result = await createQuote(db, { brand, tenantId, leadId: id, dealId, actorId });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const origin = new URL(request.url).origin;
    return NextResponse.json(
      { quote: toPublicQuote(result.quote, viewUrl(origin, result.quote._id, result.quote.shareToken)) },
      { status: result.status }
    );
  } catch (error: any) {
    console.error('POST /api/leads/[id]/quotes Error:', error);
    return NextResponse.json({ error: 'Failed to generate quote' }, { status: 500 });
  }
}

// Node.js serverless runtime only — @react-pdf/renderer (via createQuote ->
// renderQuotePdf) depends on Node APIs and is not Edge-compatible. Never
// set `export const runtime = 'edge'` here.
export const dynamic = 'force-dynamic';
