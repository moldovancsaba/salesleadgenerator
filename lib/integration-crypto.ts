import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';

// Encryption at rest for third-party integration credentials (issue #217).
// AES-256-GCM via Node's built-in crypto module only — no new dependency,
// matching lib/sso.ts's/lib/scoped-api-keys.ts's existing crypto-without-a-
// library precedent.
//
// Unlike lib/api-auth.ts's requireApiKey (issue #105's fail-closed-in-
// PRODUCTION-ONLY convention — an unset SLG_API_KEY can safely mean "no
// auth needed" for local dev), a missing/invalid encryption key has no
// safe "open" fallback: the only alternative to encrypting is writing a
// real Google/Calendly credential to the database as plaintext, which is
// never acceptable in any environment, including local dev against a real
// test account. getEncryptionKey() therefore fails closed unconditionally,
// not just in production — a deliberate, disclosed departure from
// requireApiKey's own environment-conditional shape (see
// docs/ARCHITECTURE.md's "Third-Party Integration Hub" section).

const KEY_ENV_VAR = 'INTEGRATION_CREDENTIALS_ENCRYPTION_KEY';
const KEY_BYTE_LENGTH = 32; // AES-256
const IV_BYTE_LENGTH = 12; // 96-bit, the AES-GCM standard IV size

export class IntegrationEncryptionKeyError extends Error {}

function getEncryptionKey(): Buffer {
  const raw = process.env[KEY_ENV_VAR] || '';
  if (!raw) {
    throw new IntegrationEncryptionKeyError(`${KEY_ENV_VAR} is not configured`);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== KEY_BYTE_LENGTH) {
    throw new IntegrationEncryptionKeyError(`${KEY_ENV_VAR} must decode (base64) to exactly ${KEY_BYTE_LENGTH} bytes`);
  }
  return key;
}

export function isIntegrationEncryptionConfigured(): boolean {
  try {
    getEncryptionKey();
    return true;
  } catch {
    return false;
  }
}

export type EncryptedBlob = {
  ciphertext: string; // base64
  iv: string; // base64, unique per blob, never reused
  authTag: string; // base64, AES-256-GCM authentication tag
};

export function encryptCredentials(payload: unknown): EncryptedBlob {
  const key = getEncryptionKey();
  const iv = randomBytes(IV_BYTE_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

// decipher.final() throws on a tampered ciphertext, a mismatched authTag,
// or the wrong key — this never returns a "probably fine" partial result,
// matching this repo's existing "an invalid credential fails closed"
// philosophy (lib/scoped-api-keys.ts).
export function decryptCredentials<T = Record<string, unknown>>(blob: EncryptedBlob): T {
  const key = getEncryptionKey();
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(blob.ciphertext, 'base64')), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as T;
}
