import { NextRequest, NextResponse } from 'next/server';
import { resolveSessionFromIdToken } from '@/lib/session';
import clientPromise, { isMongoConfigured } from '@/lib/mongodb';
import {
  getUserAccess,
  isPreferredStartScreen,
  setUserPreferences,
  type PreferredStartScreen,
} from '@/lib/sso-access';

export async function GET(request: NextRequest) {
  const claims = await resolveSessionFromIdToken(request.cookies.get('sso_id_token')?.value);
  if (!claims) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isMongoConfigured()) {
    return NextResponse.json({ preferredStartScreen: null, hideNeedsReplyByBrand: {} });
  }

  const client = await clientPromise;
  const db = client.db();
  const record = await getUserAccess(db, claims.sub);
  return NextResponse.json({
    preferredStartScreen: record?.preferredStartScreen ?? null,
    hideNeedsReplyByBrand: record?.hideNeedsReplyByBrand ?? {},
  });
}

export async function PATCH(request: NextRequest) {
  const claims = await resolveSessionFromIdToken(request.cookies.get('sso_id_token')?.value);
  if (!claims) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const updates: {
    preferredStartScreen?: PreferredStartScreen | null;
    hideNeedsReplyBrand?: { brand: string; hide: boolean };
  } = {};

  if ('preferredStartScreen' in body) {
    if (body.preferredStartScreen === null || body.preferredStartScreen === '') {
      updates.preferredStartScreen = null;
    } else if (isPreferredStartScreen(body.preferredStartScreen)) {
      updates.preferredStartScreen = body.preferredStartScreen;
    } else {
      return NextResponse.json(
        { error: 'preferredStartScreen must be one of today, sales, inbox, or null' },
        { status: 400 }
      );
    }
  }

  if (body.hideNeedsReply && typeof body.hideNeedsReply === 'object') {
    const brand = typeof body.hideNeedsReply.brand === 'string' ? body.hideNeedsReply.brand.trim() : '';
    const hide = Boolean(body.hideNeedsReply.hide);
    if (!brand) {
      return NextResponse.json({ error: 'hideNeedsReply.brand is required' }, { status: 400 });
    }
    updates.hideNeedsReplyBrand = { brand, hide };
  }

  const client = await clientPromise;
  const db = client.db();
  const updated = await setUserPreferences(db, claims.sub, updates);
  return NextResponse.json({
    preferredStartScreen: updated?.preferredStartScreen ?? null,
    hideNeedsReplyByBrand: updated?.hideNeedsReplyByBrand ?? {},
  });
}

export const dynamic = 'force-dynamic';
