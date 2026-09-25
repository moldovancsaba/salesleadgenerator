import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb';
import { resolveBrand, type Brand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { resolveSessionFromIdToken } from '@/lib/session';
import { importLocalFilters } from '@/lib/saved-filters-store';

async function resolveBrandFrom(request: NextRequest): Promise<Brand | null> {
  const body = await request.clone().json().catch(() => ({}));
  return typeof body.brand === 'string' ? await resolveBrand(body.brand) : null;
}

// One-time, explicit, self-serve migration of a browser's existing
// localStorage saved filters (issue #214 §8/§13/§15) — never automatic,
// never triggered without the user clicking "Import" in the Filters
// drawer's migration banner. A single bulk round trip rather than N
// sequential POST /api/saved-filters calls.
export async function POST(request: NextRequest) {
  const brand = await resolveBrandFrom(request);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
  const authError = await requireBrandAccessApi(request, brand);
  if (authError) return authError;

  const idToken = request.cookies.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);
  if (!claims?.sub) {
    return NextResponse.json({ error: 'Saved filters require an authenticated session' }, { status: 401 });
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const filters = Array.isArray(body.filters) ? body.filters : [];

  const client = await getClientPromise();
  const db = client.db();
  const result = await importLocalFilters(db, brand, claims.sub, filters);
  return NextResponse.json(result);
}
