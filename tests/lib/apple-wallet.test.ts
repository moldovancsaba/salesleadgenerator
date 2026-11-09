import { describe, it, expect } from 'vitest';
import { isAppleWalletConfigured } from '@/lib/apple-wallet';

describe('apple-wallet pass helper', () => {
  it('detects missing wallet signing certificates cleanly', () => {
    delete process.env.APPLE_PASS_TYPE_IDENTIFIER;
    delete process.env.APPLE_SIGNER_CERT;
    expect(isAppleWalletConfigured()).toBe(false);
  });

  it('detects when all required environment variables are present', () => {
    process.env.APPLE_PASS_TYPE_IDENTIFIER = 'pass.com.mrvegas.eventpass';
    process.env.APPLE_TEAM_IDENTIFIER = 'TEAM12345';
    process.env.APPLE_SIGNER_CERT = 'fakeCert';
    process.env.APPLE_SIGNER_KEY = 'fakeKey';

    expect(isAppleWalletConfigured()).toBe(true);

    delete process.env.APPLE_PASS_TYPE_IDENTIFIER;
    delete process.env.APPLE_TEAM_IDENTIFIER;
    delete process.env.APPLE_SIGNER_CERT;
    delete process.env.APPLE_SIGNER_KEY;
  });
});
