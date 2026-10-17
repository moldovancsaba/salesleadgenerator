import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '../../../../lib/mongodb';
import { resolveBrand } from '../../../lib/brand';
import { requireBrandAccessApi } from '../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../lib/tenant';
import { resolveSessionFromIdToken } from '../../../../lib/session';
import { seedStarterReports, reportDocToDefinition } from '../../../lib/report-store';

// Issue #253: Endpoint to seed the starter report templates into the brand's workspace.
// Idempotently skips any template whose name already exists in the workspace.
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const brand = await resolveBrand(searchParams.get('brand') || undefined);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    const tenantId = getTenantId(request);

    if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

    let createdBy = 'system';
    try {
      const claims = await resolveSessionFromIdToken(request.cookies.get('sso_id_token')?.value);
      if (claims?.email) createdBy = claims.email;
    } catch {
      // Non-fatal
    }

    const client = await getClientPromise();
    const db = client.db();
    const seeded = await seedStarterReports(db, brand, tenantId, createdBy);

    return NextResponse.json({
      ok: true,
      seededCount: seeded.length,
      reports: seeded.map(reportDocToDefinition),
    });
  } catch (error: any) {
    console.error('POST /api/reports/seed Error:', error);
    return NextResponse.json({ error: 'Failed to seed starter reports' }, { status: 500 });
  }
}

export const dynamic = 'force-dynamic';
