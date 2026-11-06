import { NextResponse } from 'next/server';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import { requireCronOrApiKey } from '@/lib/api-auth';
import { FALLBACK_BRAND_CONFIG } from '@/app/lib/brand-constants';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const authError = requireCronOrApiKey(request);
  if (authError) return authError;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'MongoDB not configured' }, { status: 503 });
  }

  try {
    const client = await clientPromise;
    const db = client.db();
    const brandsColl = db.collection('brands');
    const ssoColl = db.collection('sso_user_access');

    // 1. Delete legacy 'padel-africa' from brands collection
    await brandsColl.deleteOne({ slug: 'padel-africa' });

    // 2. Ensure 'racket-land' exists in brands collection with label "Racket.land"
    const racketConfig = FALLBACK_BRAND_CONFIG['racket-land'];
    await brandsColl.updateOne(
      { slug: 'racket-land' },
      {
        $set: {
          slug: 'racket-land',
          ...racketConfig,
          label: 'Racket.land',
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );

    // 3. In sso_user_access, remove orgAccess['padel-africa'] and ensure orgAccess['racket-land'] = 'admin'
    await ssoColl.updateMany(
      {},
      {
        $unset: { 'orgAccess.padel-africa': '' },
      }
    );
    await ssoColl.updateMany(
      {
        $or: [
          { email: 'moldovancsaba@gmail.com' },
          { aliases: 'moldovancsaba@gmail.com' },
        ],
      },
      {
        $set: { 'orgAccess.racket-land': 'admin' },
      }
    );

    const brands = await brandsColl.find({}).toArray();
    const users = await ssoColl.find({}).toArray();

    return NextResponse.json({
      success: true,
      remainingBrands: brands.map((b) => ({ slug: b.slug, label: b.label })),
      userAccess: users.map((u) => ({ email: u.email, orgAccess: u.orgAccess })),
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message }, { status: 500 });
  }
}
