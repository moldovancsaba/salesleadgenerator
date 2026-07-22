import { describe, it, expect } from 'vitest';
import { buildFingerprint } from '../../lib/fingerprint';

describe('buildFingerprint', () => {
  it('produces a stable sha1 hex digest for normal input', () => {
    const fp = buildFingerprint('ACME FC', 'https://example.com', 'US');
    expect(fp).toMatch(/^[a-f0-9]{40}$/);
    expect(fp).toBe(buildFingerprint('ACME FC', 'https://example.com', 'US'));
  });

  it('is case-insensitive on name and url, and case-normalizes region to upper', () => {
    const lower = buildFingerprint('acme fc', 'https://EXAMPLE.com', 'us');
    const mixed = buildFingerprint('ACME FC', 'https://example.com', 'US');
    expect(lower).toBe(mixed);
  });

  it('trims whitespace on name and url before hashing', () => {
    const padded = buildFingerprint('  ACME FC  ', '  https://example.com  ', 'US');
    const trimmed = buildFingerprint('ACME FC', 'https://example.com', 'US');
    expect(padded).toBe(trimmed);
  });

  it('handles missing/empty fields without throwing', () => {
    expect(() => buildFingerprint('', '', '')).not.toThrow();
    expect(buildFingerprint('', '', '')).toMatch(/^[a-f0-9]{40}$/);
  });

  it('produces different hashes for different regions', () => {
    const us = buildFingerprint('ACME FC', 'https://example.com', 'US');
    const uk = buildFingerprint('ACME FC', 'https://example.com', 'UK');
    expect(us).not.toBe(uk);
  });
});
