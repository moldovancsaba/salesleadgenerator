import { NextResponse, type NextRequest } from 'next/server';
import { resolveBrand } from '../../../lib/brand';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { REPORT_TEMPLATES } from '../../../../lib/report-templates';

// Issue #253: Endpoint returning the curated report templates catalog.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brand = await resolveBrand(searchParams.get('brand') || undefined);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    return NextResponse.json({ templates: REPORT_TEMPLATES });
  } catch (error: any) {
    console.error('GET /api/reports/templates Error:', error);
    return NextResponse.json({ error: 'Failed to fetch report templates' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
