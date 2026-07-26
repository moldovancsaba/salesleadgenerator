import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminSession } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { setUserOrgAccess, type OrgRole } from '@/lib/sso-access';
import { BRAND_CONFIG, type Brand } from '@/app/lib/brand';

const VALID_ROLES: OrgRole[] = ['admin', 'user'];

export async function PUT(request: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  const { userId } = await params;
  const body = await request.json().catch(() => ({}));
  const brand = body.brand as string | undefined;
  const role = body.role as OrgRole | null | undefined;

  if (!brand || !(brand in BRAND_CONFIG)) {
    return NextResponse.json({ error: `brand must be one of: ${Object.keys(BRAND_CONFIG).join(', ')}` }, { status: 400 });
  }
  if (role !== null && (typeof role !== 'string' || !VALID_ROLES.includes(role))) {
    return NextResponse.json({ error: `role must be null or one of: ${VALID_ROLES.join(', ')}` }, { status: 400 });
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const db = client.db();
  const updated = await setUserOrgAccess(db, userId, brand as Brand, role ?? null);

  if (!updated) {
    return NextResponse.json({ error: 'User not found — they must sign in at least once before access can be granted' }, { status: 404 });
  }

  return NextResponse.json({ user: updated });
}
