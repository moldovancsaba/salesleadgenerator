import { NextRequest, NextResponse } from 'next/server';
import { requireBrandAccessApi } from '@/lib/require-brand-access-api';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { resolveBrand } from '@/app/lib/brand';
import { getTenantId } from '@/lib/tenant';

// Issue 271: Admin-managed Inbox Scoping & Privacy Policy
// Allows admins to toggle between Strict Mailbox Only vs Include Assigned Lead Emails.
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rawBrand = searchParams.get('brand') || 'seyu';
  const brand = await resolveBrand(rawBrand);
  if (!brand) {
    return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
  }

  const authError = await requireBrandAccessApi(request, brand);
  if (authError) return authError;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const tenantId = getTenantId(request);
  const client = await clientPromise;
  const db = client.db();

  const doc = await db.collection('company_settings')
    .findOne({ brand, ...(tenantId ? { tenantId } : {}) })
    .catch(() => null);

  const includeAssignedLeadThreads = Boolean(
    (doc as any)?.inboxSettings?.includeAssignedLeadThreads
  );
  const includeCcThreads = Boolean(
    (doc as any)?.inboxSettings?.includeCcThreads
  );

  return NextResponse.json({
    brand,
    tenantId,
    includeAssignedLeadThreads,
    includeCcThreads,
  });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const rawBrand = body.brand || 'seyu';
  const brand = await resolveBrand(rawBrand);
  if (!brand) {
    return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
  }

  const authError = await requireBrandAccessApi(request, brand);
  if (authError) return authError;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const tenantId = getTenantId(request);
  const client = await clientPromise;
  const db = client.db();

  const setFields: Record<string, any> = {
    updatedAt: new Date().toISOString(),
  };

  if (body.includeAssignedLeadThreads !== undefined) {
    setFields['inboxSettings.includeAssignedLeadThreads'] = Boolean(body.includeAssignedLeadThreads);
  }
  if (body.includeCcThreads !== undefined) {
    setFields['inboxSettings.includeCcThreads'] = Boolean(body.includeCcThreads);
  }

  await db.collection('company_settings').updateOne(
    { brand, ...(tenantId ? { tenantId } : {}) },
    { $set: setFields },
    { upsert: true }
  );

  const updatedDoc = await db.collection('company_settings')
    .findOne({ brand, ...(tenantId ? { tenantId } : {}) })
    .catch(() => null);

  return NextResponse.json({
    ok: true,
    brand,
    tenantId,
    includeAssignedLeadThreads: Boolean((updatedDoc as any)?.inboxSettings?.includeAssignedLeadThreads),
    includeCcThreads: Boolean((updatedDoc as any)?.inboxSettings?.includeCcThreads),
  });
}
