import { describe, it, expect } from 'vitest';
import { Resend } from 'resend';
import { Webhook } from 'standardwebhooks';
import { extractResendWebhookHeaders, verifyResendWebhook } from '../../lib/resend-webhook';

// A real base64-encoded secret (32 random bytes), same shape Resend's own
// webhook secrets use (whsec_<base64>) — verified against the installed
// standardwebhooks package's own Webhook.prefix constant, not assumed.
const TEST_SECRET = 'whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw';

function signRequest(payload: string, msgId = 'msg_test123', timestamp = new Date()) {
  const wh = new Webhook(TEST_SECRET);
  const signature = wh.sign(msgId, timestamp, payload);
  return {
    id: msgId,
    timestamp: String(Math.floor(timestamp.getTime() / 1000)),
    signature,
  };
}

describe('extractResendWebhookHeaders (issue #141)', () => {
  it('extracts all 3 headers when present', () => {
    const headers = new Headers({ 'svix-id': 'a', 'svix-timestamp': 'b', 'svix-signature': 'c' });
    expect(extractResendWebhookHeaders(headers)).toEqual({ id: 'a', timestamp: 'b', signature: 'c' });
  });

  it('returns null when any header is missing', () => {
    expect(extractResendWebhookHeaders(new Headers({ 'svix-id': 'a', 'svix-timestamp': 'b' }))).toBeNull();
    expect(extractResendWebhookHeaders(new Headers())).toBeNull();
  });
});

describe('verifyResendWebhook (issue #141)', () => {
  const resend = new Resend('re_test_placeholder_key');

  it('accepts a validly-signed payload and returns the parsed JSON', () => {
    const payload = JSON.stringify({ type: 'email.received', data: { email_id: 'e1' } });
    const headers = signRequest(payload);
    const result = verifyResendWebhook(resend, payload, headers, TEST_SECRET) as any;
    expect(result.type).toBe('email.received');
    expect(result.data.email_id).toBe('e1');
  });

  it('rejects a payload whose body was tampered with after signing', () => {
    const originalPayload = JSON.stringify({ type: 'email.received', data: { email_id: 'e1' } });
    const headers = signRequest(originalPayload);
    const tamperedPayload = JSON.stringify({ type: 'email.received', data: { email_id: 'e2-attacker-controlled' } });
    expect(() => verifyResendWebhook(resend, tamperedPayload, headers, TEST_SECRET)).toThrow();
  });

  it('rejects a signature produced with the wrong secret', () => {
    const payload = JSON.stringify({ type: 'email.received', data: { email_id: 'e1' } });
    const wrongWh = new Webhook('whsec_totallyDifferentSecretValueHere12');
    const signature = wrongWh.sign('msg_1', new Date(), payload);
    const headers = { id: 'msg_1', timestamp: String(Math.floor(Date.now() / 1000)), signature };
    expect(() => verifyResendWebhook(resend, payload, headers, TEST_SECRET)).toThrow();
  });

  it('rejects a replayed request whose timestamp is far in the past', () => {
    const payload = JSON.stringify({ type: 'email.received', data: { email_id: 'e1' } });
    const oldTimestamp = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago, beyond the 5-minute tolerance
    const headers = signRequest(payload, 'msg_old', oldTimestamp);
    expect(() => verifyResendWebhook(resend, payload, headers, TEST_SECRET)).toThrow();
  });

  it('rejects a request with missing signature headers entirely', () => {
    const payload = JSON.stringify({ type: 'email.received', data: {} });
    expect(() => verifyResendWebhook(resend, payload, { id: '', timestamp: '', signature: '' }, TEST_SECRET)).toThrow();
  });
});
