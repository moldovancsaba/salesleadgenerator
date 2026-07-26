import crypto from 'crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

// DoneIsBetter SSO integration (issue #102). All endpoint shapes, the PKCE
// requirement, and the two-layer permission model (SSO-level pending/
// approved/revoked, app-level user/admin role) are verified against the real
// published docs at https://sso.doneisbetter.com/docs and its live OIDC
// discovery document (https://sso.doneisbetter.com/.well-known/
// openid-configuration), not assumed. Their own published React example
// omits PKCE despite their quickstart requiring it — implemented properly
// here rather than following the incomplete example.

const SSO_BASE_URL = process.env.SSO_BASE_URL || 'https://sso.doneisbetter.com';
const SSO_CLIENT_ID = process.env.SSO_CLIENT_ID || '';
const SSO_CLIENT_SECRET = process.env.SSO_CLIENT_SECRET || '';
const SSO_REDIRECT_URI = process.env.SSO_REDIRECT_URI || '';

export function isSsoConfigured(): boolean {
  return Boolean(SSO_CLIENT_ID && SSO_CLIENT_SECRET && SSO_REDIRECT_URI);
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

export function generateCodeChallenge(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

export function generateState(): string {
  return base64url(crypto.randomBytes(16));
}

export function buildAuthorizeUrl({
  state,
  codeChallenge,
  scope = 'openid profile email',
}: {
  state: string;
  codeChallenge: string;
  scope?: string;
}): string {
  const url = new URL('/api/oauth/authorize', SSO_BASE_URL);
  url.searchParams.set('client_id', SSO_CLIENT_ID);
  url.searchParams.set('redirect_uri', SSO_REDIRECT_URI);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scope);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export type SsoTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  id_token: string;
};

export async function exchangeCodeForTokens(code: string, codeVerifier: string): Promise<SsoTokenResponse> {
  const res = await fetch(`${SSO_BASE_URL}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code,
      redirect_uri: SSO_REDIRECT_URI,
      client_id: SSO_CLIENT_ID,
      client_secret: SSO_CLIENT_SECRET,
      code_verifier: codeVerifier,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error_description || body.error || `Token exchange failed: ${res.status}`);
  }
  return res.json();
}

export async function refreshTokens(refreshToken: string): Promise<SsoTokenResponse> {
  const res = await fetch(`${SSO_BASE_URL}/api/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: SSO_CLIENT_ID,
      client_secret: SSO_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error_description || body.error || `Token refresh failed: ${res.status}`);
  }
  return res.json();
}

// Cached across warm invocations by `jose` itself — createRemoteJWKSet keeps
// its own internal fetch/cache, so this module-level singleton is safe to
// reuse rather than re-fetching the JWKS on every verification.
const JWKS = createRemoteJWKSet(new URL('/.well-known/jwks.json', SSO_BASE_URL));

export type SsoIdTokenClaims = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  [claim: string]: unknown;
};

// iss/jwks_uri verified against the real, live discovery document
// (https://sso.doneisbetter.com/.well-known/openid-configuration) rather
// than assumed to equal SSO_BASE_URL.
export async function verifyIdToken(idToken: string): Promise<SsoIdTokenClaims> {
  const { payload } = await jwtVerify(idToken, JWKS, {
    issuer: SSO_BASE_URL,
    audience: SSO_CLIENT_ID,
  });
  return payload as SsoIdTokenClaims;
}

export type SsoPermissionStatus = 'pending' | 'approved' | 'revoked';
export type SsoAppRole = 'user' | 'admin';

export type SsoPermission = {
  status: SsoPermissionStatus;
  role: SsoAppRole | null;
} | null;

// Their own docs are explicit that ID token claims are identity only, never
// authorization — this is the mandatory second call ("always check
// backend-derived permission status before granting access").
export async function getPermission(userId: string, accessToken: string): Promise<SsoPermission> {
  const url = `${SSO_BASE_URL}/api/users/${encodeURIComponent(userId)}/apps/${encodeURIComponent(SSO_CLIENT_ID)}/permissions`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Permission lookup failed: ${res.status}`);
  }
  return res.json();
}

export { SSO_BASE_URL };
