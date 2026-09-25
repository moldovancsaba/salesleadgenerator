import { describe, it, expect } from 'vitest';
import {
  generateWebhookSecret,
  parseWebhookUrl,
  validateCreateWebhookInput,
  signWebhookPayload,
  verifyWebhookSignature,
  nextRetryDelaySeconds,
  isDeadLetterThresholdReached,
  RETRY_SCHEDULE_SECONDS,
  MAX_DELIVERY_ATTEMPTS,
  VALID_WEBHOOK_EVENT_TYPES,
} from '../../lib/webhooks';

// Deterministic synthetic secret, not a literal `whsec_<base64>` string —
// matching tests/lib/resend-webhook.test.ts's own established convention:
// a literal of that exact shape was previously flagged by GitHub secret
// scanning and had to be scrubbed. Deriving it from a fixed byte pattern is
// genuinely decodable where the signing function needs it, deterministic,
// and self-evidently synthetic.
const fakeSecret = (fill: number) => 'whsec_' + Buffer.alloc(32, fill).toString('base64url');
const TEST_SECRET = fakeSecret(0x11);
const WRONG_SECRET = fakeSecret(0x22);

describe('generateWebhookSecret (issue 210/219)', () => {
  it('generates secrets with the whsec_ prefix', () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_/);
  });

  it('generates a different secret on every call', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});

describe('parseWebhookUrl (issue 210/219)', () => {
  it('accepts a well-formed https URL', () => {
    const url = parseWebhookUrl('https://example.com/webhooks/slg');
    expect(url).not.toBeNull();
    expect(url?.hostname).toBe('example.com');
  });

  it('rejects http (non-https) — SSRF/transport requirement, issue #210 §17', () => {
    expect(parseWebhookUrl('http://example.com/webhooks/slg')).toBeNull();
  });

  it('rejects a malformed URL', () => {
    expect(parseWebhookUrl('not a url')).toBeNull();
  });

  it('rejects a non-string input', () => {
    expect(parseWebhookUrl(undefined)).toBeNull();
    expect(parseWebhookUrl(42)).toBeNull();
  });

  it('rejects an empty/whitespace-only string', () => {
    expect(parseWebhookUrl('   ')).toBeNull();
  });

  it('rejects a URL longer than the length cap', () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(2048);
    expect(parseWebhookUrl(longUrl)).toBeNull();
  });
});

describe('validateCreateWebhookInput (issue 210/219)', () => {
  it('accepts a valid brand/url/events payload', () => {
    const result = validateCreateWebhookInput({ url: 'https://example.com/hook', events: ['lead.created'] }, 'cogmap');
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.value.brand).toBe('cogmap');
      expect(result.value.events).toEqual(['lead.created']);
    }
  });

  it('accepts multiple valid events', () => {
    const result = validateCreateWebhookInput({ url: 'https://example.com/hook', events: ['lead.won', 'lead.lost'] }, 'cogmap');
    expect(result.valid).toBe(true);
  });

  it('rejects a missing/unknown brand', () => {
    const result = validateCreateWebhookInput({ url: 'https://example.com/hook', events: ['lead.created'] }, null);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.join(' ')).toMatch(/brand/);
  });

  it('rejects an http:// url', () => {
    const result = validateCreateWebhookInput({ url: 'http://example.com/hook', events: ['lead.created'] }, 'cogmap');
    expect(result.valid).toBe(false);
  });

  it('rejects zero events', () => {
    const result = validateCreateWebhookInput({ url: 'https://example.com/hook', events: [] }, 'cogmap');
    expect(result.valid).toBe(false);
  });

  it('silently drops an unrecognized event type rather than accepting it', () => {
    const result = validateCreateWebhookInput({ url: 'https://example.com/hook', events: ['lead.created', 'lead.teleported'] }, 'cogmap');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.value.events).toEqual(['lead.created']);
  });

  it('rejects when every supplied event is unrecognized', () => {
    const result = validateCreateWebhookInput({ url: 'https://example.com/hook', events: ['not.a.real.event'] }, 'cogmap');
    expect(result.valid).toBe(false);
  });

  it('collects multiple errors at once rather than stopping at the first', () => {
    const result = validateCreateWebhookInput({ url: 'not a url', events: [] }, null);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

describe('signWebhookPayload / verifyWebhookSignature round-trip (issue 210/219)', () => {
  const data = { leadId: 'lead_1', tenantId: 'default' };

  it('a correctly signed payload verifies against the exact same inputs', () => {
    const signed = signWebhookPayload(TEST_SECRET, 'whdel_1', 'lead.created', 'cogmap', data, 1_700_000_000);
    const ok = verifyWebhookSignature(TEST_SECRET, 'whdel_1', 1_700_000_000, signed.body, signed.headers['webhook-signature']);
    expect(ok).toBe(true);
  });

  it('rejects a signature verified against the wrong secret', () => {
    const signed = signWebhookPayload(TEST_SECRET, 'whdel_1', 'lead.created', 'cogmap', data, 1_700_000_000);
    const ok = verifyWebhookSignature(WRONG_SECRET, 'whdel_1', 1_700_000_000, signed.body, signed.headers['webhook-signature']);
    expect(ok).toBe(false);
  });

  it('rejects a signature verified against a tampered body', () => {
    const signed = signWebhookPayload(TEST_SECRET, 'whdel_1', 'lead.created', 'cogmap', data, 1_700_000_000);
    const tamperedBody = signed.body.replace('lead_1', 'lead_2');
    const ok = verifyWebhookSignature(TEST_SECRET, 'whdel_1', 1_700_000_000, tamperedBody, signed.headers['webhook-signature']);
    expect(ok).toBe(false);
  });

  it('rejects a signature verified against a different deliveryId', () => {
    const signed = signWebhookPayload(TEST_SECRET, 'whdel_1', 'lead.created', 'cogmap', data, 1_700_000_000);
    const ok = verifyWebhookSignature(TEST_SECRET, 'whdel_2', 1_700_000_000, signed.body, signed.headers['webhook-signature']);
    expect(ok).toBe(false);
  });

  it('rejects a malformed signature header with no v1 prefix', () => {
    const ok = verifyWebhookSignature(TEST_SECRET, 'whdel_1', 1_700_000_000, '{}', 'not-a-real-signature');
    expect(ok).toBe(false);
  });

  it('sets webhook-id/webhook-timestamp headers to the exact values signed', () => {
    const signed = signWebhookPayload(TEST_SECRET, 'whdel_9', 'lead.won', 'seyu', data, 1_800_000_000);
    expect(signed.headers['webhook-id']).toBe('whdel_9');
    expect(signed.headers['webhook-timestamp']).toBe('1800000000');
  });

  it('produces a fixed, known signature for a fixed input — a future refactor cannot silently change the format without this catching it', () => {
    const signed = signWebhookPayload('whsec_fixedtestsecret', 'whdel_fixed', 'lead.created', 'cogmap', { a: 1 }, 1_600_000_000);
    expect(signed.body).toBe('{"event":"lead.created","brand":"cogmap","data":{"a":1},"deliveryId":"whdel_fixed"}');
    expect(signed.headers['webhook-signature']).toBe('v1,QGgD3IypNOh+3ntnx0rmbWwrkjI5jFtHzVIlhs9Paq4=');
  });
});

describe('nextRetryDelaySeconds / isDeadLetterThresholdReached (issue 210/219)', () => {
  it('returns the exact 1m/5m/30m/2h/12h schedule from issue #210 §11', () => {
    expect(RETRY_SCHEDULE_SECONDS).toEqual([60, 300, 1800, 7200, 43200]);
    expect(nextRetryDelaySeconds(1)).toBe(60);
    expect(nextRetryDelaySeconds(2)).toBe(300);
    expect(nextRetryDelaySeconds(3)).toBe(1800);
    expect(nextRetryDelaySeconds(4)).toBe(7200);
    expect(nextRetryDelaySeconds(5)).toBe(43200);
  });

  it('returns null once every attempt is exhausted', () => {
    expect(nextRetryDelaySeconds(6)).toBeNull();
    expect(nextRetryDelaySeconds(MAX_DELIVERY_ATTEMPTS + 1)).toBeNull();
  });

  it('returns null for an invalid (zero or negative) attempt', () => {
    expect(nextRetryDelaySeconds(0)).toBeNull();
    expect(nextRetryDelaySeconds(-1)).toBeNull();
  });

  it('auto-disable threshold is exactly 5 consecutive exhausted deliveries, per issue #210 §11', () => {
    expect(isDeadLetterThresholdReached(4)).toBe(false);
    expect(isDeadLetterThresholdReached(5)).toBe(true);
    expect(isDeadLetterThresholdReached(6)).toBe(true);
  });
});

describe('VALID_WEBHOOK_EVENT_TYPES (issue 210/219)', () => {
  it('is exactly the 4-event set from issue #210 §9', () => {
    expect(VALID_WEBHOOK_EVENT_TYPES).toEqual(['lead.created', 'lead.stage_changed', 'lead.won', 'lead.lost']);
  });
});
