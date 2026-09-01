import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminSession } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { getAccessibleBrands, isSuperAdminEmail, listAllUserAccess } from '@/lib/sso-access';
import { getAllBrandConfigs } from '@/app/lib/brand';

// Super-admin-only, session-based (not x-api-key) — the admin UI at
// /admin/users is a human clicking around in a browser with a real SSO
// session, not the external research agent, so it authenticates the same
// way every other page a human uses does.
export async function GET(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const db = client.db();
  const records = await listAllUserAccess(db);
  const allBrands = Object.keys(await getAllBrandConfigs());

  return NextResponse.json({
    users: records.map((r) => ({
      ssoUserId: r.ssoUserId,
      email: r.email,
      name: r.name,
      orgAccess: r.orgAccess,
      isSuperAdmin: isSuperAdminEmail(r.email),
      accessibleBrands: getAccessibleBrands(r.email, r.orgAccess, allBrands),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    })),
  });
}
