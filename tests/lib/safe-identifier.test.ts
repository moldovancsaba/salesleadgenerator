import { describe, it, expect } from 'vitest';
import { isSafeIdentifier } from '../../lib/safe-identifier';

// Regression coverage for a real, confirmed path-traversal vulnerability:
// tenantId was interpolated directly into a filesystem path with no
// sanitization. path.join('/a/b', '../../../../tmp/pwned.md') resolves
// clean out of the intended directory — confirmed by direct testing before
// this fix.
describe('isSafeIdentifier', () => {
  it('allows a plain alphanumeric tenantId', () => {
    expect(isSafeIdentifier('default')).toBe(true);
    expect(isSafeIdentifier('cogmap')).toBe(true);
    expect(isSafeIdentifier('tenant-123_ABC')).toBe(true);
  });

  it('rejects a traversal sequence', () => {
    expect(isSafeIdentifier('../../../../etc/passwd')).toBe(false);
    expect(isSafeIdentifier('../../../../tmp/pwned')).toBe(false);
  });

  it('rejects any path separator', () => {
    expect(isSafeIdentifier('a/b')).toBe(false);
    expect(isSafeIdentifier('a\\b')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isSafeIdentifier('')).toBe(false);
  });

  it('rejects a null-byte or other non-identifier characters', () => {
    expect(isSafeIdentifier('tenant\0')).toBe(false);
    expect(isSafeIdentifier('tenant.md')).toBe(false);
    expect(isSafeIdentifier('tenant name')).toBe(false);
  });
});
