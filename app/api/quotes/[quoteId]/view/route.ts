import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb';
import { recordQuoteView, fetchQuotePdfBytes, checkQuoteViewRateLimit } from '@/app/lib/quotes-store';

// Deals: Quote generation — the public quote share view (issue #211). The
// first genuinely unauthenticated route in this repo (§17 of the issue) —
// deliberately NOT gated by requireBrandAccessApi. Gates exclusively on the
// random shareToken query param, never on quoteId alone (a Mongo ObjectId
// is not a secret). Fetches the PDF bytes server-side and streams them back
// — the raw Vercel Blob location is never exposed to this route's caller,
// whether or not their token is valid.
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

    const client = await getClientPromise();
    const db = client.db();

    const allowed = await checkQuoteViewRateLimit(db, quoteId);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const result = await recordQuoteView(db, quoteId, token);
    if (!result.ok) {
      if (result.status === 403) {
        console.warn('[GET /api/quotes/[quoteId]/view] invalid token attempt', { quoteId });
      }
      return NextResponse.json({ error: 'Not found' }, { status: result.status });
    }

    const pdfBytes = await fetchQuotePdfBytes(result.quote);
    if (!pdfBytes) {
      console.error('[GET /api/quotes/[quoteId]/view] blob fetch returned no bytes', { quoteId });
      return NextResponse.json({ error: 'Failed to load quote document' }, { status: 502 });
    }

    return new NextResponse(new Uint8Array(pdfBytes), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        // A quote contains real deal values and company-identifying
        // information — it must never be indexed by a search engine
        // (issue #211 §17).
        'X-Robots-Tag': 'noindex, nofollow',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error: any) {
    console.error('GET /api/quotes/[quoteId]/view Error:', error);
    return NextResponse.json({ error: 'Failed to load quote', details: error.message }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
