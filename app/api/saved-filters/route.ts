import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb';
import { resolveBrand, type Brand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { resolveSessionFromIdToken } from '@/lib/session';
import { getUserAccess, getRoleForBrand } from '@/lib/sso-access';
import { listSavedFiltersForCaller, upsertSavedFilter } from '@/lib/saved-filters-store';

async function resolveBrandFrom(request: NextRequest): Promise<Brand | null> {
  const brandParam = new URL(request.url).searchParams.get('brand');
  return brandParam ? await resolveBrand(brandParam) : null;
}

// Saved filters are inherently a per-user feature (every record is owned by
// a real ssoUserId) — requireBrandAccessApi (issue #214 §7) also accepts a
// machine x-api-key caller, which has no session and therefore no
// ssoUserId to own a record under. Mirrors app/lib/lead-actions.ts's ASSIGN
// action, the one other action in this repo that's session-only by
// definition: gated by requireBrandAccessApi first (matching every other
// brand-scoped route), then a real session is required on top of that.
async function requireCallerSsoUserId(request: NextRequest): Promise<{ ssoUserId: string; email: string } | NextResponse> {
  const idToken = request.cookies.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);
  if (!claims?.sub || !claims.email) {
    return NextResponse.json({ error: 'Saved filters require an authenticated session' }, { status: 401 });
  }
  return { ssoUserId: claims.sub, email: claims.email };
}

export async function GET(request: NextRequest) {
  const brand = await resolveBrandFrom(request);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
  const authError = await requireBrandAccessApi(request, brand);
  if (authError) return authError;

  const caller = await requireCallerSsoUserId(request);
  if (caller instanceof NextResponse) return caller;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await getClientPromise();
  const db = client.db();
  const savedFilters = await listSavedFiltersForCaller(db, brand, caller.ssoUserId);

  const actorRecord = await getUserAccess(db, caller.ssoUserId);
  const canShare = getRoleForBrand(caller.email, actorRecord?.orgAccess, brand) === 'admin';

  return NextResponse.json({ savedFilters, canShare });
}

export async function POST(request: NextRequest) {
  const brand = await resolveBrandFrom(request);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
  const authError = await requireBrandAccessApi(request, brand);
  if (authError) return authError;

  const caller = await requireCallerSsoUserId(request);
  if (caller instanceof NextResponse) return caller;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name : '';
  const filter = body.filter && typeof body.filter === 'object' ? body.filter : {};
  const sharedWithBrand = typeof body.sharedWithBrand === 'boolean' ? body.sharedWithBrand : undefined;

  const client = await getClientPromise();
  const db = client.db();
  const actorRecord = await getUserAccess(db, caller.ssoUserId);
  const canShare = getRoleForBrand(caller.email, actorRecord?.orgAccess, brand) === 'admin';

  const result = await upsertSavedFilter(db, brand, caller.ssoUserId, name, filter, sharedWithBrand, canShare);
  if (result.ok) {
    return NextResponse.json({ savedFilter: result.savedFilter }, { status: result.status });
  }
  return NextResponse.json({ error: result.error }, { status: result.status });
}
