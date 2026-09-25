import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb';
import { resolveBrand, type Brand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { resolveSessionFromIdToken } from '@/lib/session';
import { getTenantId } from '@/lib/tenant';
import { markQuoteSigned, getQuoteByIdForTenant } from '@/app/lib/quotes-store';

async function getBrand(request: Request): Promise<Brand | null> {
  const url = new URL(request.url);
  const brandParam = url.searchParams.get('brand') || 'cogmap';
  return await resolveBrand(brandParam);
}

// Deals: Quote generation — "Mark as signed" (issue #211). A plain manual
// action, authenticated, rep-only — no automated verification behind it in
// v1 (see the issue's own §17/§18 e-signature scope). Requires status to
// already be 'sent' or 'viewed'; 409 on an already-signed quote (idempotent-
// safe to check, but never silently re-accepted as a fresh action) and on a
// draft that was never sent.
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

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const tenantId = getTenantId(request);
    const idToken = request.cookies.get('sso_id_token')?.value;
    const claims = await resolveSessionFromIdToken(idToken);
    const actorId = claims?.email || 'webapp-user';

    const client = await getClientPromise();
    const db = client.db();

    const existing = await getQuoteByIdForTenant(db, quoteId, tenantId);
    if (!existing || existing.leadId !== leadId) {
      return NextResponse.json({ error: 'Quote not found' }, { status: 404 });
    }

    const result = await markQuoteSigned(db, quoteId, tenantId, actorId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json({ quote: { status: result.quote.status, signedAt: result.quote.signedAt, signedBy: result.quote.signedBy } });
  } catch (error: any) {
    console.error('POST /api/leads/[id]/quotes/[quoteId]/mark-signed Error:', error);
    return NextResponse.json({ error: 'Failed to mark quote as signed', details: error.message }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
