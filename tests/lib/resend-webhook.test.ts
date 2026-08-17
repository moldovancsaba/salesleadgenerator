import { describe, it, expect } from 'vitest';
import { Resend } from 'resend';
import { Webhook } from 'standardwebhooks';
import { extractResendWebhookHeaders, verifyResendWebhook } from '../../lib/resend-webhook';

// Derived here rather than written as a literal, deliberately. A
// `whsec_<base64>` literal is exactly the shape GitHub secret scanning flags:
// the previous fixture was reported as an alert and scrubbed to a plain
// placeholder, which broke every test in this file, because `new Webhook()`
// base64-decodes its secret eagerly and threw before any assertion ran.
//
// Building the value from a fixed byte pattern satisfies both constraints at
// once — it is a genuinely decodable 32-byte base64 secret (what
// standardwebhooks requires), it is deterministic, and it is self-evidently
// synthetic, so there is nothing here for a scanner to flag or for anyone to
// mistake for a live credential.
const fakeSecret = (fill: number) => 'whsec_' + Buffer.alloc(32, fill).toString('base64');

const TEST_SECRET = fakeSecret(0x11);
// Must genuinely differ from TEST_SECRET. The scrub set both to the same
// placeholder string, which would have made the "wrong secret" test below pass
// vacuously — asserting that a correctly-signed payload is rejected — even once
// the decoding error was fixed.
const WRONG_SECRET = fakeSecret(0x22);

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
    const wrongWh = new Webhook(WRONG_SECRET);
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
