import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '@/lib/mongodb';
import { resolveBrand, type Brand } from '@/app/lib/brand';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import { resolveSessionFromIdToken } from '@/lib/session';
import { getUserAccess, getRoleForBrand } from '@/lib/sso-access';
import { getSavedFilterById, setSavedFilterSharing, deleteSavedFilter } from '@/lib/saved-filters-store';

async function resolveBrandFrom(request: NextRequest): Promise<Brand | null> {
  const brandParam = new URL(request.url).searchParams.get('brand');
  return brandParam ? await resolveBrand(brandParam) : null;
}

async function requireCallerSsoUserId(request: NextRequest): Promise<{ ssoUserId: string; email: string } | NextResponse> {
  const idToken = request.cookies.get('sso_id_token')?.value;
  const claims = await resolveSessionFromIdToken(idToken);
  if (!claims?.sub || !claims.email) {
    return NextResponse.json({ error: 'Saved filters require an authenticated session' }, { status: 401 });
  }
  return { ssoUserId: claims.sub, email: claims.email };
}

// Owner-only on every mutating route below (issue #214 §10/§17) — even a
// super admin cannot re-share or delete another user's saved filter; the
// super-admin bypass applies to brand *access* (requireBrandAccessApi),
// never to impersonating another user's *ownership* of their own record.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  if (typeof body.sharedWithBrand !== 'boolean') {
    return NextResponse.json({ error: 'sharedWithBrand (boolean) is required' }, { status: 400 });
  }

  const client = await getClientPromise();
  const db = client.db();

  const existing = await getSavedFilterById(db, id);
  if (!existing || existing.brand !== brand) {
    return NextResponse.json({ error: 'Saved filter not found' }, { status: 404 });
  }
  if (existing.ssoUserId !== caller.ssoUserId) {
    return NextResponse.json({ error: 'Only the owner can change a saved filter’s sharing' }, { status: 403 });
  }

  if (body.sharedWithBrand === true) {
    const actorRecord = await getUserAccess(db, caller.ssoUserId);
    const canShare = getRoleForBrand(caller.email, actorRecord?.orgAccess, brand) === 'admin';
    if (!canShare) {
      return NextResponse.json({ error: 'Only brand admins can share a saved filter with the team' }, { status: 403 });
    }
  }

  const updated = await setSavedFilterSharing(db, id, body.sharedWithBrand);
  if (!updated) return NextResponse.json({ error: 'Saved filter not found' }, { status: 404 });
  return NextResponse.json({ savedFilter: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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

  const existing = await getSavedFilterById(db, id);
  if (!existing || existing.brand !== brand) {
    return NextResponse.json({ error: 'Saved filter not found' }, { status: 404 });
  }
  if (existing.ssoUserId !== caller.ssoUserId) {
    return NextResponse.json({ error: 'Only the owner can delete a saved filter' }, { status: 403 });
  }

  const deleted = await deleteSavedFilter(db, id);
  if (!deleted) return NextResponse.json({ error: 'Saved filter not found' }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
