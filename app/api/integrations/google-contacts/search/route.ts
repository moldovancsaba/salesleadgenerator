import { NextResponse, type NextRequest } from 'next/server';
import clientPromise, { isMongoConfigured } from '../../../../../lib/mongodb';
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api';
import { resolveBrand } from '../../../../lib/brand';
import { getTenantId } from '../../../../../lib/tenant';
import { searchGoogleContacts } from '../../../../lib/google-contacts-store';

// Issue #216 §10 — rep-initiated, read-only search against the rep's own
// Google Contacts. Guarded by requireBrandAccessApi (the same guard
// GET /api/leads/[id]/activity already uses), per the issue's own explicit
// instruction — unlike issue #217's hub-management routes, this consumes
// an already-established connection rather than creating/revoking one, so
// the machine-caller (x-api-key) path is legitimate here too.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const brand = await resolveBrand(searchParams.get('brand') || undefined);
  if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });

  const authResponse = await requireBrandAccessApi(request, brand);
  if (authResponse) return authResponse;

  const query = (searchParams.get('q') || '').trim();
  if (!query) return NextResponse.json({ results: [] });

  if (!isMongoConfigured()) return NextResponse.json({ error: 'Database not configured' }, { status: 503 });

  const tenantId = getTenantId(request);
  const client = await clientPromise;
  const db = client.db();
  const result = await searchGoogleContacts(db, brand, tenantId, query);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ results: result.results });
}

export const dynamic = 'force-dynamic';
