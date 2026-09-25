import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminSession } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { listTeamsForBrand, createTeam } from '@/lib/teams';
import { getBrandConfig, getAllBrandConfigs, type Brand } from '@/app/lib/brand';

// Team visibility (issue: CRM Team visibility) — team CRUD is super-admin-
// only, session-based, matching every other write under /admin/users today
// (app/api/admin/users/route.ts, app/api/admin/users/[userId]/access/route.ts).
// No x-api-key path — a team is a human-curated admin concept, never
// touched by the research agent.
export async function GET(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  const brand = new URL(request.url).searchParams.get('brand') || undefined;
  const brandConfig = brand ? await getBrandConfig(brand) : null;
  if (!brand || !brandConfig) {
    return NextResponse.json({ error: `brand must be one of: ${Object.keys(await getAllBrandConfigs()).join(', ')}` }, { status: 400 });
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const db = client.db();
  const teams = await listTeamsForBrand(db, brand as Brand);
  return NextResponse.json({ teams });
}

export async function POST(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  const body = await request.json().catch(() => ({}));
  const brand = typeof body.brand === 'string' ? body.brand : undefined;
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  const brandConfig = brand ? await getBrandConfig(brand) : null;
  if (!brand || !brandConfig) {
    return NextResponse.json({ error: `brand must be one of: ${Object.keys(await getAllBrandConfigs()).join(', ')}` }, { status: 400 });
  }
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const db = client.db();
  const team = await createTeam(db, brand as Brand, name);
  return NextResponse.json({ team }, { status: 201 });
}
