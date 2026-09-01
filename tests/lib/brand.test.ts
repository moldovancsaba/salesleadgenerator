import { describe, it, expect } from 'vitest';
import { FALLBACK_BRAND_CONFIG, CURRENCY_CODES, CURRENCY_CODE_OPTIONS, resolveBrand, getBrandConfig, getAllBrandConfigs, getForbiddenTermsFor } from '../../app/lib/brand';

// Issue #195 — BRAND_CONFIG was renamed FALLBACK_BRAND_CONFIG: it's no
// longer the live source of truth (a Mongo `brands` collection is), only
// the seed/fallback used when that collection is empty (e.g. this bare
// unit-test run, with no MONGODB_URI set — isMongoConfigured() is false,
// so every accessor below transparently falls back to these same fixture
// values, unchanged from the original 3-brand static object). Issue #145's
// original point (one source of truth for brand->currency) still holds,
// it just moved.
describe('FALLBACK_BRAND_CONFIG currency', () => {
  it('reports CogMap in USD and Seyu in EUR — zero behavior change for existing brands', () => {
    expect(FALLBACK_BRAND_CONFIG.cogmap.currency).toBe('USD');
    expect(FALLBACK_BRAND_CONFIG.seyu.currency).toBe('EUR');
  });

  it('reports DVSC in EUR (issue #147)', () => {
    expect(FALLBACK_BRAND_CONFIG.dvsc.currency).toBe('EUR');
  });

  it('every FALLBACK_BRAND_CONFIG entry has a currency drawn from CURRENCY_CODES', () => {
    for (const config of Object.values(FALLBACK_BRAND_CONFIG)) {
      expect(CURRENCY_CODES).toContain(config.currency);
    }
  });
});

describe('CURRENCY_CODE_OPTIONS / CURRENCY_CODES', () => {
  it('CURRENCY_CODES is derived from CURRENCY_CODE_OPTIONS, not a separate hand-maintained list', () => {
    expect(CURRENCY_CODES).toEqual(CURRENCY_CODE_OPTIONS.map((o) => o.value));
  });

  it('includes both currencies this app currently uses', () => {
    expect(CURRENCY_CODES).toEqual(expect.arrayContaining(['USD', 'EUR']));
  });
});

// Issue #147 — resolveBrand()'s single highest-priority fix: a genuinely
// unrecognized, non-empty brand value previously silently resolved to
// 'cogmap' (a real, silent wrong-brand-read/write risk). It now returns
// null, distinct from the legitimate "no brand specified at all" default.
// Issue #195 — resolveBrand is now async (reads the Mongo-backed registry,
// falling back to FALLBACK_BRAND_CONFIG here since no DB is configured in
// this unit-test run) — same behavior otherwise, every assertion below is
// unchanged from before the migration except for the added `await`.
describe('resolveBrand', () => {
  it('resolves all 3 known brand keys and their *sales aliases', async () => {
    expect(await resolveBrand('cogmap')).toBe('cogmap');
    expect(await resolveBrand('cogmapsales')).toBe('cogmap');
    expect(await resolveBrand('seyu')).toBe('seyu');
    expect(await resolveBrand('seyusales')).toBe('seyu');
    expect(await resolveBrand('dvsc')).toBe('dvsc');
    expect(await resolveBrand('dvscsales')).toBe('dvsc');
  });

  it('is case-insensitive', async () => {
    expect(await resolveBrand('DVSC')).toBe('dvsc');
    expect(await resolveBrand('CogMap')).toBe('cogmap');
  });

  it('still defaults to cogmap for a genuinely empty/absent value (distinct from an invalid one)', async () => {
    expect(await resolveBrand(undefined)).toBe('cogmap');
    expect(await resolveBrand(null)).toBe('cogmap');
    expect(await resolveBrand('')).toBe('cogmap');
  });

  it('returns null — never a silently guessed brand — for a genuinely unrecognized, non-empty value', async () => {
    expect(await resolveBrand('not_a_real_brand')).toBeNull();
    expect(await resolveBrand('cogmap; DROP TABLE leads')).toBeNull();
    expect(await resolveBrand('seyuu')).toBeNull();
  });
});

describe('getBrandConfig / getAllBrandConfigs (issue #195)', () => {
  it('getBrandConfig returns the fallback config for a known brand when the brands collection is unavailable', async () => {
    const config = await getBrandConfig('cogmap');
    expect(config?.label).toBe('CogMap');
    expect(config?.dbCollection).toBe('leads');
  });

  it('getBrandConfig returns null for an unknown brand', async () => {
    expect(await getBrandConfig('not_a_real_brand')).toBeNull();
  });

  it('getAllBrandConfigs returns exactly the 3 fallback brands when the collection is empty/unavailable', async () => {
    const all = await getAllBrandConfigs();
    expect(Object.keys(all).sort()).toEqual(['cogmap', 'dvsc', 'seyu']);
  });
});

// Issue #195 — the hand-maintained, must-stay-symmetric FORBIDDEN_BRAND_TERMS
// map (lib/validate-lead.ts) was replaced by this derived function: for
// brand X, the union of every *other* brand's own ownNameTerms. This is
// the same real-world symmetry tests/lib/validate-battlecard.test.ts used
// to assert directly against the old static map, now proven as a property
// of the derivation instead of a hand-authored list.
describe('getForbiddenTermsFor (issue #195, formerly FORBIDDEN_BRAND_TERMS)', () => {
  it('every brand is forbidden from mentioning either other brand\'s own name', async () => {
    expect(await getForbiddenTermsFor('cogmap')).toEqual(expect.arrayContaining(['seyu', 'dvsc']));
    expect(await getForbiddenTermsFor('seyu')).toEqual(expect.arrayContaining(['cogmap', 'dvsc']));
    expect(await getForbiddenTermsFor('dvsc')).toEqual(expect.arrayContaining(['cogmap', 'seyu']));
  });

  it('never includes the brand\'s own terms in its own forbidden set', async () => {
    const cogmapForbidden = await getForbiddenTermsFor('cogmap');
    expect(cogmapForbidden).not.toContain('cognitive assessment');
    const seyuForbidden = await getForbiddenTermsFor('seyu');
    expect(seyuForbidden).not.toContain('fan selfie');
  });

  it('DVSC\'s derived forbidden set is now the full union (fixes a real pre-#195 gap where its hand list was missing several terms)', async () => {
    const dvscForbidden = await getForbiddenTermsFor('dvsc');
    expect(dvscForbidden).toEqual(expect.arrayContaining([
      'cognitive assessment', 'player performance analytics', 'decision-making profiling',
      'sports science', 'situational awareness',
      'fan selfie', 'led screen', 'jumbotron', 'sponsor activation', 'revenue-share', 'revenue share', 'second screen', 'second-screen',
    ]));
  });

  it('an unrecognized brand gets every other brand\'s terms, since none are excluded as "its own"', async () => {
    const unknown = await getForbiddenTermsFor('not_a_real_brand');
    expect(unknown).toEqual(expect.arrayContaining(['cogmap', 'seyu', 'dvsc']));
  });
});
