import { describe, it, expect, afterEach, vi } from 'vitest';
import crypto from 'crypto';

const ORIGINAL_ENV = {
  SSO_BASE_URL: process.env.SSO_BASE_URL,
  SSO_CLIENT_ID: process.env.SSO_CLIENT_ID,
  SSO_CLIENT_SECRET: process.env.SSO_CLIENT_SECRET,
  SSO_REDIRECT_URI: process.env.SSO_REDIRECT_URI,
};

// lib/sso.ts reads process.env into module-level constants at import time
// (same constraint documented in tests/lib/api-auth.test.ts) — env vars must
// be set before each dynamic import, not before a static top-of-file one.
async function loadSso() {
  vi.resetModules();
  return import('../../lib/sso');
}

function restoreEnvKey(key: string, value: string | undefined) {
  // `process.env.KEY = undefined` coerces to the *string* "undefined" in
  // Node, not an actual delete — silently breaking any later test in the
  // same file that relies on the key being genuinely unset.
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('lib/sso', () => {
  afterEach(() => {
    restoreEnvKey('SSO_BASE_URL', ORIGINAL_ENV.SSO_BASE_URL);
    restoreEnvKey('SSO_CLIENT_ID', ORIGINAL_ENV.SSO_CLIENT_ID);
    restoreEnvKey('SSO_CLIENT_SECRET', ORIGINAL_ENV.SSO_CLIENT_SECRET);
    restoreEnvKey('SSO_REDIRECT_URI', ORIGINAL_ENV.SSO_REDIRECT_URI);
  });

  describe('isSsoConfigured', () => {
    it('is false when client credentials are unset (the current real state — issue #102 is blocked on manual registration)', async () => {
      delete process.env.SSO_CLIENT_ID;
      delete process.env.SSO_CLIENT_SECRET;
      delete process.env.SSO_REDIRECT_URI;
      const { isSsoConfigured } = await loadSso();
      expect(isSsoConfigured()).toBe(false);
    });

    it('is true once all three are set', async () => {
      process.env.SSO_CLIENT_ID = 'client-123';
      process.env.SSO_CLIENT_SECRET = 'secret-abc';
      process.env.SSO_REDIRECT_URI = 'https://example.com/api/auth/callback';
      const { isSsoConfigured } = await loadSso();
      expect(isSsoConfigured()).toBe(true);
    });
  });

  describe('PKCE helpers', () => {
    it('generateCodeVerifier produces distinct, URL-safe values', async () => {
      const { generateCodeVerifier } = await loadSso();
      const a = generateCodeVerifier();
      const b = generateCodeVerifier();
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(a.length).toBeGreaterThanOrEqual(43); // RFC 7636 minimum verifier length
    });

    it('generateCodeChallenge computes the real RFC 7636 S256 transform, not a placeholder', async () => {
      const { generateCodeChallenge } = await loadSso();
      const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'; // RFC 7636 Appendix B example
      const expected = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'; // RFC 7636 Appendix B expected output
      expect(generateCodeChallenge(verifier)).toBe(expected);
    });

    it('generateCodeChallenge is deterministic for the same verifier', async () => {
      const { generateCodeChallenge } = await loadSso();
      const verifier = crypto.randomBytes(32).toString('base64url');
      expect(generateCodeChallenge(verifier)).toBe(generateCodeChallenge(verifier));
    });

    it('generateState produces distinct, URL-safe values', async () => {
      const { generateState } = await loadSso();
      const a = generateState();
      const b = generateState();
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  describe('buildAuthorizeUrl', () => {
    it('builds a real /api/oauth/authorize URL with PKCE S256 and the configured client/redirect', async () => {
      process.env.SSO_BASE_URL = 'https://sso.doneisbetter.com';
      process.env.SSO_CLIENT_ID = 'client-123';
      process.env.SSO_CLIENT_SECRET = 'secret-abc';
      process.env.SSO_REDIRECT_URI = 'https://salesleadgenerator.vercel.app/api/auth/callback';
      const { buildAuthorizeUrl } = await loadSso();

      const url = new URL(buildAuthorizeUrl({ state: 'state-xyz', codeChallenge: 'challenge-xyz' }));
      expect(url.origin).toBe('https://sso.doneisbetter.com');
      expect(url.pathname).toBe('/api/oauth/authorize');
      expect(url.searchParams.get('client_id')).toBe('client-123');
      expect(url.searchParams.get('redirect_uri')).toBe('https://salesleadgenerator.vercel.app/api/auth/callback');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('openid profile email');
      expect(url.searchParams.get('state')).toBe('state-xyz');
      expect(url.searchParams.get('code_challenge')).toBe('challenge-xyz');
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    });

    it('accepts a custom scope override', async () => {
      process.env.SSO_CLIENT_ID = 'client-123';
      process.env.SSO_REDIRECT_URI = 'https://example.com/callback';
      const { buildAuthorizeUrl } = await loadSso();
      const url = new URL(buildAuthorizeUrl({ state: 's', codeChallenge: 'c', scope: 'openid' }));
      expect(url.searchParams.get('scope')).toBe('openid');
    });
  });
});
