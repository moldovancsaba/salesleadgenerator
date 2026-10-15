import { NextResponse, type NextRequest } from 'next/server';
import { isMongoConfigured, getClientPromise } from '../../../../../lib/mongodb';
import { resolveBrand } from '../../../../lib/brand';
import { requireBrandAccessApi } from '../../../../../lib/require-brand-access-api';
import { getTenantId } from '../../../../../lib/tenant';
import { resolveLeadThreadContext } from '../../../../../lib/gmail-threading';

// Issue #243: Query endpoint to resolve prior conversation threading context
// (RFC 2822 Message-ID, In-Reply-To, References, and Gmail threadId) for a lead.

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const brandParam = new URL(request.url).searchParams.get('brand') || 'cogmap';
    const brand = await resolveBrand(brandParam);
    if (!brand) return NextResponse.json({ error: 'Invalid brand' }, { status: 400 });
    const authError = await requireBrandAccessApi(request, brand);
    if (authError) return authError;

    if (!isMongoConfigured()) {
      return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
    }

    const tenantId = getTenantId(request);
    const client = await getClientPromise();
    const db = client.db();

    const threadContext = await resolveLeadThreadContext(db, id, brand, tenantId);

    return NextResponse.json({
      threadContext,
      threadAvailable: Boolean(threadContext && (threadContext.threadId || threadContext.inReplyTo)),
    });
  } catch (error: any) {
    console.error('[API:leads:thread-context] GET error:', error);
    return NextResponse.json({ error: 'Failed to resolve lead thread context' }, { status: 500 });
  }
}
