import { describe, it, expect } from 'vitest';
import {
  generateRawApiKey,
  hashApiKey,
  keyPrefixOf,
  evaluateScopedKeyAuth,
  requiredScopeForMethod,
  validateCreateApiKeyInput,
  type ApiKeyScope,
} from '../../lib/scoped-api-keys';

describe('generateRawApiKey / hashApiKey / keyPrefixOf (issue 210)', () => {
  it('generates keys with the slg_ prefix', () => {
    expect(generateRawApiKey()).toMatch(/^slg_/);
  });

  it('generates a different key on every call', () => {
    expect(generateRawApiKey()).not.toBe(generateRawApiKey());
  });

  it('hashApiKey is deterministic for the same input', () => {
    const raw = generateRawApiKey();
    expect(hashApiKey(raw)).toBe(hashApiKey(raw));
  });

  it('hashApiKey produces different hashes for different keys', () => {
    expect(hashApiKey(generateRawApiKey())).not.toBe(hashApiKey(generateRawApiKey()));
  });

  it('hashApiKey never returns the raw key itself', () => {
    const raw = generateRawApiKey();
    expect(hashApiKey(raw)).not.toBe(raw);
  });

  it('keyPrefixOf returns the first 8 characters, matching the raw key exactly', () => {
    const raw = generateRawApiKey();
    const prefix = keyPrefixOf(raw);
    expect(prefix).toHaveLength(8);
    expect(raw.startsWith(prefix)).toBe(true);
  });
});

describe('requiredScopeForMethod (issue 210)', () => {
  it('requires only read for GET and HEAD', () => {
    expect(requiredScopeForMethod('GET')).toBe('read');
    expect(requiredScopeForMethod('HEAD')).toBe('read');
  });

  it('requires read-write for every mutating method', () => {
    expect(requiredScopeForMethod('POST')).toBe('read-write');
    expect(requiredScopeForMethod('PATCH')).toBe('read-write');
    expect(requiredScopeForMethod('PUT')).toBe('read-write');
    expect(requiredScopeForMethod('DELETE')).toBe('read-write');
  });
});

describe('evaluateScopedKeyAuth (issue 210)', () => {
  const activeKey = { brand: 'cogmap', scopes: ['read'] as ApiKeyScope[], revokedAt: null };

  it('is unmatched (401, matched:false) when no key document was found', () => {
    const result = evaluateScopedKeyAuth(null, 'cogmap', 'read');
    expect(result).toEqual({ authorized: false, matched: false, status: 401 });
  });

  it('fails closed with 401 for a revoked key, even for the correct brand/scope', () => {
    const revoked = { brand: 'cogmap', scopes: ['read-write'] as ApiKeyScope[], revokedAt: '2026-01-01T00:00:00.000Z' };
    const result = evaluateScopedKeyAuth(revoked, 'cogmap', 'read');
    expect(result).toEqual({ authorized: false, matched: true, status: 401 });
  });

  it('fails closed with 403 for a key scoped to a different brand', () => {
    const result = evaluateScopedKeyAuth(activeKey, 'seyu', 'read');
    expect(result).toEqual({ authorized: false, matched: true, status: 403 });
  });

  it('fails closed with 403 when a read-only key is used for a write', () => {
    const result = evaluateScopedKeyAuth(activeKey, 'cogmap', 'read-write');
    expect(result).toEqual({ authorized: false, matched: true, status: 403 });
  });

  it('authorizes a read-write key for a read-only requirement', () => {
    const readWriteKey = { brand: 'cogmap', scopes: ['read-write'] as ApiKeyScope[], revokedAt: null };
    expect(evaluateScopedKeyAuth(readWriteKey, 'cogmap', 'read')).toEqual({ authorized: true });
  });

  it('authorizes a matching, active, correctly-scoped key', () => {
    expect(evaluateScopedKeyAuth(activeKey, 'cogmap', 'read')).toEqual({ authorized: true });
  });

  it('revocation takes priority over a brand mismatch', () => {
    const revoked = { brand: 'seyu', scopes: ['read'] as ApiKeyScope[], revokedAt: '2026-01-01T00:00:00.000Z' };
    const result = evaluateScopedKeyAuth(revoked, 'cogmap', 'read');
    expect(result.authorized).toBe(false);
    expect(result).toMatchObject({ matched: true, status: 401 });
  });
});

describe('validateCreateApiKeyInput (issue 210)', () => {
  it('accepts a valid name/brand/single-scope payload', () => {
    const result = validateCreateApiKeyInput({ name: 'research-agent-cogmap', scopes: ['read'] }, 'cogmap');
    expect(result).toEqual({ valid: true, value: { name: 'research-agent-cogmap', brand: 'cogmap', scopes: ['read'] } });
  });

  it('rejects an empty or whitespace-only name', () => {
    expect(validateCreateApiKeyInput({ name: '   ', scopes: ['read'] }, 'cogmap').valid).toBe(false);
    expect(validateCreateApiKeyInput({ scopes: ['read'] }, 'cogmap').valid).toBe(false);
  });

  it('rejects a missing/unknown brand', () => {
    const result = validateCreateApiKeyInput({ name: 'x', scopes: ['read'] }, null);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toMatch(/brand/);
  });

  it('rejects zero scopes', () => {
    expect(validateCreateApiKeyInput({ name: 'x', scopes: [] }, 'cogmap').valid).toBe(false);
  });

  it('rejects more than one scope', () => {
    expect(validateCreateApiKeyInput({ name: 'x', scopes: ['read', 'read-write'] }, 'cogmap').valid).toBe(false);
  });

  it('rejects an unrecognized scope value', () => {
    expect(validateCreateApiKeyInput({ name: 'x', scopes: ['admin'] }, 'cogmap').valid).toBe(false);
  });

  it('trims and length-caps the name', () => {
    const result = validateCreateApiKeyInput({ name: '  padded  ', scopes: ['read'] }, 'cogmap');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.name).toBe('padded');
  });

  it('collects multiple errors at once rather than stopping at the first', () => {
    const result = validateCreateApiKeyInput({ name: '', scopes: [] }, null);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});
