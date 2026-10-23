import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb';
import {
  getPublicQuotePortalData,
  acceptQuoteByBuyer,
  checkQuoteViewRateLimit,
} from '@/app/lib/quotes-store';
import { validateBuyerAcceptanceInput } from '@/lib/quotes';

// Interactive Public Quote Portal & Buyer Self-Service E-Signature (issue #276).
// Unauthenticated, token-gated endpoint:
// - GET returns sanitized quote portal metadata and transitions status 'sent' -> 'viewed'.
// - POST validates buyer acceptance fields (signerName, signerEmail, signerTitle,
//   purchaseOrderNumber, signatureText), transitions quote to 'signed', and records
//   audit trail in activityLog.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId } = await params;
    const token = new URL(request.url).searchParams.get('token') || '';

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    if (!/^[0-9a-f]{24}$/i.test(quoteId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const client = await getClientPromise();
    const db = client.db();

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const allowed = await checkQuoteViewRateLimit(db, quoteId, clientIp);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const result = await getPublicQuotePortalData(db, quoteId, token);
    if (!result.ok) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(
      { portal: result.portal },
      {
        status: 200,
        headers: {
          'X-Robots-Tag': 'noindex, nofollow',
          'Cache-Control': 'private, no-store',
        },
      }
    );
  } catch (error: any) {
    console.error('GET /api/quotes/[quoteId]/accept Error:', error);
    return NextResponse.json({ error: 'Failed to load quote portal' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId } = await params;
    const body = await request.json().catch(() => ({}));
    const token = typeof body.token === 'string'
      ? body.token.trim()
      : new URL(request.url).searchParams.get('token') || '';

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    if (!/^[0-9a-f]{24}$/i.test(quoteId)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const validated = validateBuyerAcceptanceInput(body);
    if (!validated.ok) {
      return NextResponse.json({ error: validated.error }, { status: 400 });
    }

    const client = await getClientPromise();
    const db = client.db();

    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const allowed = await checkQuoteViewRateLimit(db, quoteId, clientIp);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const result = await acceptQuoteByBuyer(db, quoteId, token, validated.data, clientIp);
    if (!result.ok) {
      const status = result.status === 403 ? 404 : result.status;
      return NextResponse.json({ error: status === 404 ? 'Not found' : result.error }, { status });
    }

    return NextResponse.json({
      ok: true,
      quote: {
        status: result.quote.status,
        signedAt: result.quote.signedAt,
        signerName: result.quote.signerName,
        signerTitle: result.quote.signerTitle,
        signerEmail: result.quote.signerEmail,
        purchaseOrderNumber: result.quote.purchaseOrderNumber,
      },
    });
  } catch (error: any) {
    console.error('POST /api/quotes/[quoteId]/accept Error:', error);
    return NextResponse.json({ error: 'Failed to sign quote' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
