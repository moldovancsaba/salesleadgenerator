import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

// Issue #195 — the live, Mongo-backed half of the brand-registry migration.
// tests/lib/brand.test.ts covers the pure/no-DB accessor behavior (which,
// run without MONGODB_URI, exercises exactly the same "collection empty/
// unavailable -> FALLBACK_BRAND_CONFIG" path this file also has to cover,
// just via a different mechanism); this file covers what only a real
// MongoDB instance can prove: a populated `brands` collection becoming
// fully authoritative, and the slug/alias uniqueness index.

let mongod: MongoMemoryServer;
let getBrandConfig: typeof import('../../app/lib/brand').getBrandConfig;
let getAllBrandConfigs: typeof import('../../app/lib/brand').getAllBrandConfigs;
let resolveBrand: typeof import('../../app/lib/brand').resolveBrand;
let getForbiddenTermsFor: typeof import('../../app/lib/brand').getForbiddenTermsFor;
let createBrand: typeof import('../../app/lib/brand').createBrand;
let clientPromise: typeof import('../../lib/mongodb').default;

beforeAll(async () => {
  mongod = await startTestMongo();
  const brandMod = await import('../../app/lib/brand');
  getBrandConfig = brandMod.getBrandConfig;
  getAllBrandConfigs = brandMod.getAllBrandConfigs;
  resolveBrand = brandMod.resolveBrand;
  getForbiddenTermsFor = brandMod.getForbiddenTermsFor;
  createBrand = brandMod.createBrand;
  clientPromise = (await import('../../lib/mongodb')).default;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

beforeEach(async () => {
  const client = await clientPromise;
  await client.db().collection('brands').deleteMany({});
});

function testBrandRecord(overrides: Partial<Parameters<typeof createBrand>[0]> = {}) {
  const now = new Date().toISOString();
  return {
    slug: 'testco',
    label: 'TestCo',
    dbCollection: 'testco_leads',
    apiPrefix: '/api/leads',
    currency: 'USD' as const,
    aliases: ['testco', 'testcosales'],
    ownNameTerms: ['testco'],
    forecastModel: 'dealSizeBand' as const,
    createdAt: now,
    createdBy: 'test@example.com',
    updatedAt: now,
    ...overrides,
  };
}

describe('brands collection empty/unavailable — fallback behavior', () => {
  it('getAllBrandConfigs returns the 3 fallback brands when the collection is genuinely empty', async () => {
    const all = await getAllBrandConfigs();
    expect(Object.keys(all).sort()).toEqual(['cogmap', 'dvsc', 'seyu']);
  });

  it('getBrandConfig returns the fallback entry for a known brand', async () => {
    const config = await getBrandConfig('cogmap');
    expect(config?.label).toBe('CogMap');
  });
});

describe('brands collection populated — Mongo becomes fully authoritative', () => {
  it('a newly created brand is immediately readable via getBrandConfig', async () => {
    await createBrand(testBrandRecord());
    const config = await getBrandConfig('testco');
    expect(config?.label).toBe('TestCo');
    expect(config?.dbCollection).toBe('testco_leads');
    expect(config?.currency).toBe('USD');
  });

  // Real, deliberate design point: once ANY document exists in `brands`,
  // FALLBACK_BRAND_CONFIG is no longer consulted at all — getAllBrandConfigs
  // returns exactly what's in Mongo, not a merge with the fallback's other
  // entries. A fresh environment is expected to run the migration script
  // (scripts/migrate-brands-to-mongo.ts) to seed cogmap/seyu/dvsc before
  // this state is reached in production.
  it('getAllBrandConfigs returns exactly what is in Mongo once populated, not merged with the fallback', async () => {
    await createBrand(testBrandRecord());
    const all = await getAllBrandConfigs();
    expect(Object.keys(all)).toEqual(['testco']);
  });

  it('resolveBrand finds a Mongo-backed brand by its slug and by its alias', async () => {
    await createBrand(testBrandRecord());
    expect(await resolveBrand('testco')).toBe('testco');
    expect(await resolveBrand('testcosales')).toBe('testco');
    expect(await resolveBrand('TESTCO')).toBe('testco');
  });

  it('resolveBrand still returns null for a genuinely unrecognized value', async () => {
    await createBrand(testBrandRecord());
    expect(await resolveBrand('not_a_real_brand')).toBeNull();
  });

  it('getBrandConfig returns null (not the fallback) for a brand missing from a populated collection', async () => {
    await createBrand(testBrandRecord());
    expect(await getBrandConfig('cogmap')).toBeNull();
  });
});

describe('slug/alias uniqueness (issue #195 Risk D — TOCTOU on concurrent create)', () => {
  it('rejects a second brand with a duplicate slug', async () => {
    await createBrand(testBrandRecord());
    await expect(createBrand(testBrandRecord({ aliases: ['testco2'] }))).rejects.toThrow(/E11000|duplicate key/);
  });

  it('rejects a second brand whose alias collides with an existing brand\'s own slug', async () => {
    await createBrand(testBrandRecord());
    await expect(
      createBrand(testBrandRecord({ slug: 'othersales', aliases: ['othersales', 'testco'] }))
    ).rejects.toThrow(/E11000|duplicate key/);
  });
});

describe('getForbiddenTermsFor — derived from real Mongo-backed brand records', () => {
  it('is the union of every OTHER brand\'s own ownNameTerms, excluding the queried brand\'s own', async () => {
    await createBrand(testBrandRecord({ slug: 'alpha', aliases: ['alpha'], ownNameTerms: ['alpha', 'alpha-only-term'] }));
    await createBrand(testBrandRecord({ slug: 'beta', aliases: ['beta'], ownNameTerms: ['beta', 'beta-only-term'] }));

    const alphaForbidden = await getForbiddenTermsFor('alpha');
    expect(alphaForbidden).toEqual(expect.arrayContaining(['beta', 'beta-only-term']));
    expect(alphaForbidden).not.toContain('alpha-only-term');

    const betaForbidden = await getForbiddenTermsFor('beta');
    expect(betaForbidden).toEqual(expect.arrayContaining(['alpha', 'alpha-only-term']));
    expect(betaForbidden).not.toContain('beta-only-term');
  });

  it('adding a third brand automatically extends the other two\'s forbidden sets with zero manual edits', async () => {
    await createBrand(testBrandRecord({ slug: 'alpha', aliases: ['alpha'], ownNameTerms: ['alpha'] }));
    await createBrand(testBrandRecord({ slug: 'beta', aliases: ['beta'], ownNameTerms: ['beta'] }));
    expect(await getForbiddenTermsFor('alpha')).toEqual(['beta']);

    await createBrand(testBrandRecord({ slug: 'gamma', aliases: ['gamma'], ownNameTerms: ['gamma'] }));
    expect(await getForbiddenTermsFor('alpha')).toEqual(expect.arrayContaining(['beta', 'gamma']));
  });
});
