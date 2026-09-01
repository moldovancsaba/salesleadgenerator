import 'server-only';
import clientPromise, { isMongoConfigured } from '../../lib/mongodb';
import { FALLBACK_BRAND_CONFIG, type BrandConfig, type BrandRecord, type Brand } from './brand-constants';

export * from './brand-constants';

// This file is server-only (imports lib/mongodb.ts) as of issue #195 — a
// Client Component must import types/constants from ./brand-constants
// directly (or rely on TypeScript's automatic erasure of `import type`,
// which is safe from either file) rather than a runtime *value* from this
// file. The `server-only` import above turns an accidental client import of
// this file into an explicit, clear build-time error instead of the
// confusing "Module not found: net" webpack failure that motivated this split.

const BRANDS_COLLECTION = 'brands';

// Deliberately reads clientPromise itself rather than taking a `db: Db`
// parameter (unlike e.g. lib/pipeline-weights.ts's getPipelineWeights) —
// brand config is resolved on nearly every request, including many call
// sites (route-matching in a Server Component, resolveBrand() before any
// other DB work) that today do no DB work at all just to look up a brand.
// Requiring every caller to first open a `db` handle would be a much bigger
// diff than the "add await" this migration is meant to be, and would open a
// Mongo connection eagerly in places that currently don't need one.
async function loadAllBrandDocs(): Promise<BrandRecord[] | null> {
  if (!isMongoConfigured()) return null;
  try {
    const client = await clientPromise;
    const db = client.db();
    return await db.collection<BrandRecord>(BRANDS_COLLECTION).find({}).toArray();
  } catch {
    return null;
  }
}

let indexesEnsured = false;
// Idempotent, lazy-ensured — same pattern as app/lib/forecast-snapshot.ts's
// own indexesEnsured flag. Unique on `slug`; unique multikey on `aliases`
// (each brand's own slug is included in its own aliases array, so a new
// brand's alias can never collide with an existing brand's slug either).
async function ensureBrandIndexes(): Promise<void> {
  if (indexesEnsured || !isMongoConfigured()) return;
  try {
    const client = await clientPromise;
    const db = client.db();
    await db.collection(BRANDS_COLLECTION).createIndex({ slug: 1 }, { unique: true });
    await db.collection(BRANDS_COLLECTION).createIndex({ aliases: 1 }, { unique: true });
    indexesEnsured = true;
  } catch {
    // Best-effort — a transient failure here just means the next call retries.
  }
}

export async function getAllBrandConfigs(): Promise<Record<string, BrandConfig>> {
  const docs = await loadAllBrandDocs();
  if (!docs || docs.length === 0) return FALLBACK_BRAND_CONFIG;
  const result: Record<string, BrandConfig> = {};
  for (const { slug, createdAt, createdBy, updatedAt, ...config } of docs) {
    result[slug] = config;
  }
  return result;
}

export async function getBrandConfig(slug: string): Promise<BrandConfig | null> {
  const all = await getAllBrandConfigs();
  return all[slug] ?? null;
}

// Issue #147's own resolveBrand contract, preserved exactly: an empty/missing
// value (no brand specified at all) still resolves to 'cogmap' — every
// existing caller either supplies a real dynamic-route brand segment (never
// empty) or explicitly relies on this default for a legitimate
// no-brand-specified request. A genuinely unrecognized, non-empty value
// returns `null` (not a guessed brand) — callers handle that explicitly
// (404/400), same as before.
export async function resolveBrand(value: string | undefined | null): Promise<Brand | null> {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return 'cogmap';
  const all = await getAllBrandConfigs();
  for (const [slug, config] of Object.entries(all)) {
    if (config.aliases.includes(normalized)) return slug;
  }
  return null;
}

// The derived replacement for the old hand-maintained, must-stay-symmetric
// FORBIDDEN_BRAND_TERMS map (lib/validate-lead.ts) — the forbidden set for
// `brand` is simply the union of every *other* brand's own ownNameTerms.
// Adding a brand here automatically and correctly extends every existing
// brand's protection with zero manual list edits.
export async function getForbiddenTermsFor(brand: string): Promise<string[]> {
  const normalized = String(brand || '').toLowerCase();
  const all = await getAllBrandConfigs();
  const terms = new Set<string>();
  for (const [slug, config] of Object.entries(all)) {
    if (slug === normalized) continue;
    for (const term of config.ownNameTerms) terms.add(term);
  }
  return Array.from(terms);
}

export async function createBrand(record: BrandRecord): Promise<void> {
  await ensureBrandIndexes();
  const client = await clientPromise;
  const db = client.db();
  await db.collection<BrandRecord>(BRANDS_COLLECTION).insertOne(record);
}
