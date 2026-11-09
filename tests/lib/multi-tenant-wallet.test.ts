import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isAppleWalletConfigured } from '../../lib/apple-wallet';

describe('multi-tenant apple-wallet pass generator', () => {
  beforeEach(() => {
    delete process.env.APPLE_PASS_TYPE_IDENTIFIER;
    delete process.env.HAHO_PASS_TYPE_IDENTIFIER;
    delete process.env.APPLE_TEAM_IDENTIFIER;
    delete process.env.HAHO_TEAM_IDENTIFIER;
    delete process.env.APPLE_SIGNER_CERT;
    delete process.env.HAHO_SIGNER_CERT;
    delete process.env.APPLE_SIGNER_KEY;
    delete process.env.HAHO_SIGNER_KEY;
  });

  it('detects when neither client nor umbrella credentials are configured', () => {
    expect(isAppleWalletConfigured()).toBe(false);
  });

  it('detects when client-specific credentials are configured', () => {
    process.env.APPLE_PASS_TYPE_IDENTIFIER = 'pass.com.mrvegas.eventpass';
    process.env.APPLE_TEAM_IDENTIFIER = 'GZE5C5C4L8';
    process.env.APPLE_SIGNER_CERT = 'base64cert';
    process.env.APPLE_SIGNER_KEY = 'base64key';
    expect(isAppleWalletConfigured()).toBe(true);
  });

  it('detects when Haho.ai umbrella credentials are configured', () => {
    process.env.HAHO_PASS_TYPE_IDENTIFIER = 'pass.ai.haho.pass';
    process.env.HAHO_TEAM_IDENTIFIER = 'GZE5C5C4L8';
    process.env.HAHO_SIGNER_CERT = 'base64cert';
    process.env.HAHO_SIGNER_KEY = 'base64key';
    expect(isAppleWalletConfigured()).toBe(true);
  });
});
