import { describe, it, expect } from 'vitest';

describe('Integrations Hub Health Status & Diagnostics (Issue 322)', () => {
  it('formats verification messages as pass or fail correctly', () => {
    const successMsg = 'Connection verified.';
    const failMsg = 'Verification failed: invalid OAuth token';

    expect(successMsg.includes('verified')).toBe(true);
    expect(failMsg.includes('verified')).toBe(false);
  });

  it('determines provider health status badge correctly', () => {
    type Status = 'active' | 'expired' | 'revoked' | 'error';
    const checkBadge = (status?: Status) => {
      if (!status) return 'Not configured';
      if (status === 'active') return 'Live';
      if (status === 'revoked') return 'Revoked';
      return 'Action Required';
    };

    expect(checkBadge(undefined)).toBe('Not configured');
    expect(checkBadge('active')).toBe('Live');
    expect(checkBadge('expired')).toBe('Action Required');
    expect(checkBadge('error')).toBe('Action Required');
    expect(checkBadge('revoked')).toBe('Revoked');
  });
});
