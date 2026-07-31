import { describe, it, expect, afterEach } from 'vitest';
import {
  isSuperAdminEmail,
  getAccessibleBrands,
  hasAccessToBrand,
  getRoleForBrand,
  resolveLoginDestination,
} from '../../lib/sso-access';

// isSuperAdminEmail reads process.env.SSO_SUPER_ADMIN_EMAILS fresh on every
// call (not into a module-level constant at import time), so — unlike
// tests/lib/sso.test.ts's env-dependent module — no vi.resetModules()/
// dynamic re-import dance is needed here; a plain assignment before each
// call is enough.
const ORIGINAL_SUPER_ADMINS = process.env.SSO_SUPER_ADMIN_EMAILS;

describe('lib/sso-access', () => {
  afterEach(() => {
    if (ORIGINAL_SUPER_ADMINS === undefined) delete process.env.SSO_SUPER_ADMIN_EMAILS;
    else process.env.SSO_SUPER_ADMIN_EMAILS = ORIGINAL_SUPER_ADMINS;
  });

  describe('isSuperAdminEmail', () => {
    it('is false when SSO_SUPER_ADMIN_EMAILS is unset', () => {
      delete process.env.SSO_SUPER_ADMIN_EMAILS;
      expect(isSuperAdminEmail('moldovancsaba@gmail.com')).toBe(false);
    });

    it('is true for an exact match', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = 'moldovancsaba@gmail.com';
      expect(isSuperAdminEmail('moldovancsaba@gmail.com')).toBe(true);
    });

    it('is case-insensitive', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = 'moldovancsaba@gmail.com';
      expect(isSuperAdminEmail('MoldovanCsaba@Gmail.com')).toBe(true);
    });

    it('supports a comma-separated list with surrounding whitespace', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = ' a@example.com , moldovancsaba@gmail.com ,b@example.com';
      expect(isSuperAdminEmail('moldovancsaba@gmail.com')).toBe(true);
      expect(isSuperAdminEmail('a@example.com')).toBe(true);
      expect(isSuperAdminEmail('b@example.com')).toBe(true);
    });

    it('is false for an unrelated email', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = 'moldovancsaba@gmail.com';
      expect(isSuperAdminEmail('someone-else@example.com')).toBe(false);
    });

    it('is false for undefined/null/empty email', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = 'moldovancsaba@gmail.com';
      expect(isSuperAdminEmail(undefined)).toBe(false);
      expect(isSuperAdminEmail(null)).toBe(false);
      expect(isSuperAdminEmail('')).toBe(false);
    });
  });

  describe('getAccessibleBrands', () => {
    it('returns every configured brand for a super admin regardless of orgAccess', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = 'moldovancsaba@gmail.com';
      // Deliberately empty/undefined orgAccess — this is the safety-net
      // scenario issue #103 exists to guarantee: a super admin is never
      // locked out by a bug or gap in the per-org assignment data.
      // Issue #147 — DVSC added as a third brand: a super admin now
      // legitimately sees all 3 configured brands, not just the original 2.
      expect(getAccessibleBrands('moldovancsaba@gmail.com', undefined).sort()).toEqual(['cogmap', 'dvsc', 'seyu']);
      expect(getAccessibleBrands('moldovancsaba@gmail.com', {}).sort()).toEqual(['cogmap', 'dvsc', 'seyu']);
    });

    it('returns only brands with a truthy role for a regular user', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      expect(getAccessibleBrands('user@example.com', { cogmap: 'user' })).toEqual(['cogmap']);
      expect(getAccessibleBrands('user@example.com', { cogmap: 'user', seyu: 'admin' }).sort()).toEqual(['cogmap', 'seyu']);
    });

    it('returns an empty array for a regular user with no orgAccess at all', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      expect(getAccessibleBrands('user@example.com', undefined)).toEqual([]);
      expect(getAccessibleBrands('user@example.com', {})).toEqual([]);
    });

    it("always returns BRAND_CONFIG's own canonical order (cogmap, seyu), never MongoDB's field-insertion order", () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      // seyu granted before cogmap — object key order would put seyu first
      // if this function trusted Object.keys(orgAccess) — order matters now
      // that resolveLoginDestination() picks accessibleBrands[0] as "first".
      expect(getAccessibleBrands('user@example.com', { seyu: 'user', cogmap: 'user' })).toEqual(['cogmap', 'seyu']);
    });
  });

  describe('hasAccessToBrand', () => {
    it('is always true for a super admin, any brand', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = 'moldovancsaba@gmail.com';
      expect(hasAccessToBrand('moldovancsaba@gmail.com', undefined, 'cogmap')).toBe(true);
      expect(hasAccessToBrand('moldovancsaba@gmail.com', {}, 'seyu')).toBe(true);
    });

    it('reflects orgAccess for a regular user', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      expect(hasAccessToBrand('user@example.com', { cogmap: 'user' }, 'cogmap')).toBe(true);
      expect(hasAccessToBrand('user@example.com', { cogmap: 'user' }, 'seyu')).toBe(false);
      expect(hasAccessToBrand('user@example.com', undefined, 'cogmap')).toBe(false);
    });
  });

  describe('getRoleForBrand', () => {
    it("is always 'admin' for a super admin, regardless of stored role", () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = 'moldovancsaba@gmail.com';
      expect(getRoleForBrand('moldovancsaba@gmail.com', { cogmap: 'user' }, 'cogmap')).toBe('admin');
      expect(getRoleForBrand('moldovancsaba@gmail.com', undefined, 'seyu')).toBe('admin');
    });

    it('returns the stored role for a regular user, or null if absent', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      expect(getRoleForBrand('user@example.com', { cogmap: 'admin' }, 'cogmap')).toBe('admin');
      expect(getRoleForBrand('user@example.com', { cogmap: 'user' }, 'seyu')).toBe(null);
      expect(getRoleForBrand('user@example.com', undefined, 'cogmap')).toBe(null);
    });
  });

  describe('resolveLoginDestination', () => {
    it("sends a DoneIsBetter-pending user to /access-pending regardless of orgAccess", () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      expect(resolveLoginDestination('pending', 'user@example.com', { cogmap: 'admin' })).toBe('/access-pending');
    });

    it("sends a DoneIsBetter-revoked user to /access-denied regardless of orgAccess", () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      expect(resolveLoginDestination('revoked', 'user@example.com', { cogmap: 'admin' })).toBe('/access-denied');
    });

    it("sends an approved user with zero brand access to /access-pending — the new 'welcome' state, not a login failure", () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      expect(resolveLoginDestination('approved', 'newperson@example.com', undefined)).toBe('/access-pending');
      expect(resolveLoginDestination('approved', 'newperson@example.com', {})).toBe('/access-pending');
    });

    it("sends an approved user with exactly one brand to that brand's Forecast page", () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      expect(resolveLoginDestination('approved', 'user@example.com', { cogmap: 'user' })).toBe('/forecast/cogmap');
      expect(resolveLoginDestination('approved', 'user@example.com', { seyu: 'admin' })).toBe('/forecast/seyu');
    });

    it("sends a user with both brands to the canonically-first brand's Forecast page (cogmap), regardless of grant order", () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      expect(resolveLoginDestination('approved', 'user@example.com', { cogmap: 'user', seyu: 'admin' })).toBe('/forecast/cogmap');
      expect(resolveLoginDestination('approved', 'user@example.com', { seyu: 'admin', cogmap: 'user' })).toBe('/forecast/cogmap');
    });

    it('treats a null/undefined DoneIsBetter permission (no record at all) the same as approved', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      expect(resolveLoginDestination(null, 'user@example.com', { cogmap: 'user' })).toBe('/forecast/cogmap');
      expect(resolveLoginDestination(undefined, 'newperson@example.com', undefined)).toBe('/access-pending');
    });

    it("sends a super admin to CogMap's Forecast page (their canonically-first brand), never /access-pending", () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = 'moldovancsaba@gmail.com';
      expect(resolveLoginDestination('approved', 'moldovancsaba@gmail.com', undefined)).toBe('/forecast/cogmap');
      expect(resolveLoginDestination(undefined, 'moldovancsaba@gmail.com', {})).toBe('/forecast/cogmap');
    });
  });
});
