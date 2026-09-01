import { NextRequest, NextResponse } from 'next/server';
import { requireSuperAdminSession } from '@/lib/session';
import { isMongoConfigured } from '@/lib/mongodb';
import {
  getAllBrandConfigs, createBrand, CURRENCY_CODES,
  type BrandRecord, type CurrencyCode, type ForecastModel, type BrandSalesVocabulary,
} from '@/app/lib/brand';

// Issue #196 — the actual "add a client" surface on top of issue #195's
// Mongo-backed brand registry. Super-admin-only, session-based (a human
// clicking around /admin/clients), same requireSuperAdminSession gate as
// every other /api/admin/* route a human uses.

// 2-32 chars, lowercase letters/digits/hyphens, must start with a letter —
// short enough to read comfortably in a URL segment and a Mongo collection
// name (`${slug}_leads`), permissive enough for a real company name
// ("rmbd", "acme-fc").
const SLUG_RE = /^[a-z][a-z0-9-]{1,31}$/;
const FORECAST_MODELS: ForecastModel[] = ['dealSizeBand', 'custom'];

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(
    value.filter((v): v is string => typeof v === 'string').map((v) => v.trim().toLowerCase()).filter(Boolean)
  ));
}

export async function GET(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const all = await getAllBrandConfigs();
  const brands = Object.entries(all)
    .map(([slug, config]) => ({ slug, ...config }))
    .sort((a, b) => a.slug.localeCompare(b.slug));

  return NextResponse.json({ brands });
}

export async function POST(request: NextRequest) {
  const claimsOrResponse = await requireSuperAdminSession(request);
  if (claimsOrResponse instanceof NextResponse) return claimsOrResponse;

  if (!isMongoConfigured()) {
    return NextResponse.json({ error: 'Database not configured' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));

  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : '';
  if (!SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'slug must be 2-32 lowercase letters, numbers, or hyphens, starting with a letter' }, { status: 400 });
  }

  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 });
  }

  const currency = typeof body.currency === 'string' && (CURRENCY_CODES as string[]).includes(body.currency)
    ? (body.currency as CurrencyCode)
    : null;
  if (!currency) {
    return NextResponse.json({ error: `currency must be one of: ${CURRENCY_CODES.join(', ')}` }, { status: 400 });
  }

  const forecastModel: ForecastModel = FORECAST_MODELS.includes(body.forecastModel)
    ? body.forecastModel
    : 'dealSizeBand';

  // Own slug always included, whatever else the admin adds/removes — the
  // unique multikey index on `aliases` (app/lib/brand.ts's ensureBrandIndexes)
  // depends on every brand's own slug being present in its own aliases array.
  const aliases = Array.from(new Set([slug, ...sanitizeStringArray(body.aliases)]));
  const ownNameTerms = Array.from(new Set([slug, ...sanitizeStringArray(body.ownNameTerms)]));

  const fromEmail = typeof body.fromEmail === 'string' && body.fromEmail.trim() ? body.fromEmail.trim() : undefined;

  let salesVocabulary: BrandSalesVocabulary | undefined;
  if (body.salesVocabulary && typeof body.salesVocabulary === 'object') {
    salesVocabulary = {
      customerTypes: sanitizeStringArray(body.salesVocabulary.customerTypes),
      buyerRoles: sanitizeStringArray(body.salesVocabulary.buyerRoles),
    };
  }

  // Fast, friendly pre-check — the unique index below is the real
  // correctness guarantee under concurrent submissions (TOCTOU), this just
  // avoids a raw driver error for the common, non-racing case.
  const existing = await getAllBrandConfigs();
  if (existing[slug]) {
    return NextResponse.json({ error: `A brand with slug "${slug}" already exists` }, { status: 409 });
  }
  for (const [existingSlug, config] of Object.entries(existing)) {
    const collidingAlias = config.aliases.find((a) => aliases.includes(a));
    if (collidingAlias) {
      return NextResponse.json({ error: `Alias "${collidingAlias}" already belongs to brand "${existingSlug}"` }, { status: 409 });
    }
  }

  const now = new Date().toISOString();
  const record: BrandRecord = {
    slug,
    label,
    dbCollection: `${slug}_leads`,
    apiPrefix: '/api/leads',
    currency,
    aliases,
    ownNameTerms,
    forecastModel,
    ...(salesVocabulary ? { salesVocabulary } : {}),
    ...(fromEmail ? { fromEmail } : {}),
    createdAt: now,
    createdBy: claimsOrResponse.email || 'unknown',
    updatedAt: now,
  };

  try {
    await createBrand(record);
  } catch (err: any) {
    if (err?.code === 11000 || /E11000/.test(String(err?.message))) {
      return NextResponse.json({ error: 'Slug or alias already in use (a concurrent request created it first)' }, { status: 409 });
    }
    console.error('[API:admin/clients] POST error:', err);
    return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 });
  }

  return NextResponse.json({ brand: record }, { status: 201 });
}
