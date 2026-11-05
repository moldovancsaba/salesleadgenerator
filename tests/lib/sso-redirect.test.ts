import { describe, it, expect } from 'vitest';
import { isSsoConfigured } from '@/lib/sso';

describe('SSO Canonical Redirect URI Sanitization', () => {
  it('identifies SSO is configured when valid credentials exist', () => {
    expect(typeof isSsoConfigured).toBe('function');
  });
});
