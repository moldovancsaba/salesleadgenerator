import { describe, it, expect, afterEach } from 'vitest';
import {
  isSuperAdminEmail,
  getAccessibleBrands,
  hasAccessToBrand,
  getRoleForBrand,
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
      expect(getAccessibleBrands('moldovancsaba@gmail.com', undefined).sort()).toEqual(['cogmap', 'seyu']);
      expect(getAccessibleBrands('moldovancsaba@gmail.com', {}).sort()).toEqual(['cogmap', 'seyu']);
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
});
