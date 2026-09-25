import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminSession } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { updateTeam, deleteTeam } from '@/lib/teams';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  const { teamId } = await params;
  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === 'string' ? body.name.trim() : undefined;
  if (name !== undefined && !name) {
    return NextResponse.json({ error: 'name cannot be blank' }, { status: 400 });
  }
  const memberIds = Array.isArray(body.memberIds) ? body.memberIds.map(String) : undefined;
  const managerIds = Array.isArray(body.managerIds) ? body.managerIds.map(String) : undefined;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const db = client.db();

  let updated;
  try {
    updated = await updateTeam(db, teamId, { name, memberIds, managerIds });
  } catch (error: any) {
    // Thrown by updateTeam for a memberId/managerId with no sso_user_access
    // record — a real validation failure, not a server error.
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (!updated) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  return NextResponse.json({ team: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  const { teamId } = await params;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const client = await clientPromise;
  const db = client.db();
  const deleted = await deleteTeam(db, teamId);

  if (!deleted) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  return new NextResponse(null, { status: 204 });
}
