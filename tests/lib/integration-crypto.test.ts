import { describe, it, expect, afterEach } from 'vitest';
import { randomBytes } from 'crypto';
import {
  encryptCredentials, decryptCredentials, isIntegrationEncryptionConfigured, IntegrationEncryptionKeyError,
} from '../../lib/integration-crypto';

const ORIGINAL_KEY = process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY;
const VALID_KEY = randomBytes(32).toString('base64');

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY;
  else process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = ORIGINAL_KEY;
});

describe('isIntegrationEncryptionConfigured (issue 217)', () => {
  it('is false when the key is unset', () => {
    delete process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY;
    expect(isIntegrationEncryptionConfigured()).toBe(false);
  });

  it('is false when the key does not decode to 32 bytes', () => {
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = Buffer.from('too-short').toString('base64');
    expect(isIntegrationEncryptionConfigured()).toBe(false);
  });

  it('is true for a real 32-byte base64 key', () => {
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
    expect(isIntegrationEncryptionConfigured()).toBe(true);
  });
});

describe('encryptCredentials / decryptCredentials round-trip (issue 217)', () => {
  it('round-trips an arbitrary JSON payload exactly', () => {
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
    const payload = { accessToken: 'ya29.real-looking-token', refreshToken: '1//real-refresh', nested: { a: 1 } };
    const blob = encryptCredentials(payload);
    expect(decryptCredentials(blob)).toEqual(payload);
  });

  it('never returns the plaintext as part of the encrypted blob', () => {
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
    const blob = encryptCredentials({ apiKey: 'super-secret-calendly-pat' });
    expect(blob.ciphertext).not.toContain('super-secret-calendly-pat');
    expect(JSON.stringify(blob)).not.toContain('super-secret-calendly-pat');
  });

  it('uses a distinct IV on every call, even for the identical payload', () => {
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
    const a = encryptCredentials({ apiKey: 'same-value' });
    const b = encryptCredentials({ apiKey: 'same-value' });
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('throws on a tampered ciphertext rather than returning garbage plaintext', () => {
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
    const blob = encryptCredentials({ apiKey: 'value' });
    const tampered = { ...blob, ciphertext: Buffer.from('tampered-bytes-not-real-ciphertext').toString('base64') };
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  it('throws on a tampered auth tag rather than returning garbage plaintext', () => {
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
    const blob = encryptCredentials({ apiKey: 'value' });
    const tampered = { ...blob, authTag: Buffer.from(randomBytes(16)).toString('base64') };
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  it('throws when decrypting with a different key than the one that encrypted', () => {
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = VALID_KEY;
    const blob = encryptCredentials({ apiKey: 'value' });
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    expect(() => decryptCredentials(blob)).toThrow();
  });

  it('throws IntegrationEncryptionKeyError when the key is unset, never silently skipping encryption', () => {
    delete process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY;
    expect(() => encryptCredentials({ apiKey: 'value' })).toThrow(IntegrationEncryptionKeyError);
  });

  it('throws IntegrationEncryptionKeyError for a key of the wrong byte length', () => {
    process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = Buffer.from('16-byte-key-here').toString('base64');
    expect(() => encryptCredentials({ apiKey: 'value' })).toThrow(IntegrationEncryptionKeyError);
  });
});
