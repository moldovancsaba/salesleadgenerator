// Scoped API keys (issue #210, Phase 1 of 6 — see docs/ARCHITECTURE.md for
// which phases shipped and which were deliberately deferred). Pure logic +
// crypto (Node's built-in `crypto` module, already used the same way by
// lib/sso.ts — no new dependency): key generation/hashing and the
// brand/scope decision logic, independently unit-testable without a live
// database. app/lib/api-key-store.ts is the Mongo-aware layer that calls
// into this.

import { randomBytes, createHash } from 'crypto';

export type ApiKeyScope = 'read' | 'read-write';

export type ApiKeyRecord = {
  id: string;
  name: string;
  brand: string;
  scopes: ApiKeyScope[];
  hashedKey: string;
  keyPrefix: string;
  createdBy: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

const KEY_PREFIX_LENGTH = 8;
const MAX_NAME_LENGTH = 200;
const VALID_SCOPES: ApiKeyScope[] = ['read', 'read-write'];

// `slg_` + 32 random bytes, base64url-encoded — long enough to be
// infeasible to brute-force, short enough to be practical to paste into a
// .env file. Never persisted anywhere except this one generation moment;
// only its SHA-256 hash is ever stored (same "never store the raw secret"
// rule this repo already applies to session tokens, lib/session.ts).
export function generateRawApiKey(): string {
  return `slg_${randomBytes(32).toString('base64url')}`;
}

export function hashApiKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

export function keyPrefixOf(rawKey: string): string {
  return rawKey.slice(0, KEY_PREFIX_LENGTH);
}

function sanitizeName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').trim().slice(0, MAX_NAME_LENGTH);
}

export type CreateApiKeyValidationResult =
  | { valid: true; value: { name: string; brand: string; scopes: ApiKeyScope[] } }
  | { valid: false; errors: string[] };

// Brand validity itself is checked by the caller (route layer, via
// resolveBrand()) — this only validates the shape/name/scopes, mirroring
// every other sanitize/validate module's split in this repo.
export function validateCreateApiKeyInput(input: any, knownBrand: string | null): CreateApiKeyValidationResult {
  const errors: string[] = [];
  const name = sanitizeName(input?.name);
  if (!name) errors.push('name is required');
  if (!knownBrand) errors.push('a valid brand is required');

  const scopes: ApiKeyScope[] = Array.isArray(input?.scopes) ? input.scopes : [];
  if (scopes.length !== 1 || !VALID_SCOPES.includes(scopes[0])) {
    errors.push("scopes must be exactly one of: 'read', 'read-write'");
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { name, brand: knownBrand as string, scopes } };
}

export type ScopedKeyAuthResult =
  | { authorized: true }
  | { authorized: false; matched: true; status: 401 | 403 }
  | { authorized: false; matched: false; status: 401 };

// Pure decision logic — no Mongo, no Date.now() (caller supplies `now` for
// determinism in tests). `keyDoc` is null when no api_keys row matched the
// presented key's hash at all (never found, distinct from found-but-
// revoked/wrong-brand/wrong-scope, per issue #210 §15's own distinction:
// an unmatched key falls through to the session-cookie auth branch, while
// a matched-but-invalid key fails closed immediately).
export function evaluateScopedKeyAuth(
  keyDoc: Pick<ApiKeyRecord, 'brand' | 'scopes' | 'revokedAt'> | null,
  brand: string,
  requiredScope: ApiKeyScope
): ScopedKeyAuthResult {
  if (!keyDoc) return { authorized: false, matched: false, status: 401 };
  if (keyDoc.revokedAt) return { authorized: false, matched: true, status: 401 };
  if (keyDoc.brand !== brand) return { authorized: false, matched: true, status: 403 };
  if (requiredScope === 'read-write' && !keyDoc.scopes.includes('read-write')) {
    return { authorized: false, matched: true, status: 403 };
  }
  return { authorized: true };
}

// GET/HEAD only ever read; every other HTTP method is treated as a write,
// matching issue #210 §10's own stated rule ("a GET only requires read;
// any mutating method requires read-write").
export function requiredScopeForMethod(method: string): ApiKeyScope {
  return method === 'GET' || method === 'HEAD' ? 'read' : 'read-write';
}
