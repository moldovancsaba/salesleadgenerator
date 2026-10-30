import { NextRequest, NextResponse } from 'next/server';
import { getClientPromise, isMongoConfigured } from '@/lib/mongodb';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { resolveBrand } from '@/app/lib/brand';
import { getTenantId } from '@/lib/tenant';
import { issueProformaForQuote } from '@/lib/szamlazz-service';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ quoteId: string }> }
) {
  try {
    const { quoteId } = await params;
    const { searchParams } = new URL(req.url);
    const brandParam = searchParams.get('brand') || 'cogmap';
    const brand = await resolveBrand(brandParam);

    if (!brand) {
      return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    }

    const authError = await requireBrandAccessApi(req, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const tenantId = getTenantId(req);
    const client = await getClientPromise();
    const db = client.db();

    const result = await issueProformaForQuote(db, {
      quoteId,
      brand,
      tenantId,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error || 'Failed to issue proforma' }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      quoteId,
      invoiceNumber: result.invoiceNumber,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
  }
}
