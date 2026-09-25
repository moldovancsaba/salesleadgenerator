// Outbound webhooks (issue #210 sub-issue #219) — pure types/logic/crypto.
// Mongo-aware orchestration and the actual outbound HTTP delivery live in
// app/lib/webhook-store.ts, which calls into this module rather than
// duplicating any of it.

import { randomBytes, createHmac, timingSafeEqual } from 'crypto';

export type WebhookEventType = 'lead.created' | 'lead.stage_changed' | 'lead.won' | 'lead.lost';

export const VALID_WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'lead.created',
  'lead.stage_changed',
  'lead.won',
  'lead.lost',
];

export type WebhookRecord = {
  id: string;
  brand: string;
  url: string;
  events: WebhookEventType[];
  // AES-256-GCM ciphertext of the raw signing secret (lib/integration-crypto.ts,
  // reusing INTEGRATION_CREDENTIALS_ENCRYPTION_KEY — issue #217's existing
  // encrypted-credential-at-rest key, not a new env var). Unlike api_keys'
  // hashedKey, this must be reversible: every delivery needs the raw secret
  // to sign with, so it cannot be one-way-hashed the way an API key can —
  // a deliberate, disclosed divergence from the api_keys pattern (issue
  // #210 §17's own explicit instruction to call this out).
  encryptedSecret: { ciphertext: string; iv: string; authTag: string };
  createdBy: string;
  createdAt: string;
  disabledAt: string | null;
  disabledReason: string | null;
  consecutiveFailures: number;
};

export type DeliveryStatus = 'pending' | 'delivered' | 'failed' | 'exhausted';

export type WebhookDeliveryRecord = {
  id: string;
  webhookId: string;
  brand: string;
  event: WebhookEventType;
  payload: Record<string, unknown>;
  attempt: number; // 1-based
  status: DeliveryStatus;
  httpStatus: number | null;
  nextAttemptAt: string | null;
  createdAt: string;
  deliveredAt: string | null;
};

// Retry schedule from issue #210 §11: 1m, 5m, 30m, 2h, 12h — 5 attempts
// total, then exhausted. Disclosed departure from the letter of this
// schedule: the delivery worker itself runs on an hourly cron (see
// app/lib/webhook-store.ts's header comment for why), so in practice a
// delivery's next attempt fires at the next hourly tick on/after
// nextAttemptAt, not at the exact minute this schedule implies — the
// schedule still governs when a delivery becomes *eligible* to retry.
export const RETRY_SCHEDULE_SECONDS = [60, 300, 1800, 7200, 43200] as const;
export const MAX_DELIVERY_ATTEMPTS = RETRY_SCHEDULE_SECONDS.length;
export const DEAD_LETTER_FAILURE_THRESHOLD = 5;

// null once every retry attempt is exhausted — caller marks the delivery
// 'exhausted' rather than scheduling a 6th attempt.
export function nextRetryDelaySeconds(priorAttempt: number): number | null {
  if (priorAttempt < 1 || priorAttempt > RETRY_SCHEDULE_SECONDS.length) return null;
  return RETRY_SCHEDULE_SECONDS[priorAttempt - 1];
}

export function isDeadLetterThresholdReached(consecutiveFailures: number): boolean {
  return consecutiveFailures >= DEAD_LETTER_FAILURE_THRESHOLD;
}

// `whsec_` + 32 random bytes, base64url — same shape/entropy class as
// lib/scoped-api-keys.ts's generateRawApiKey(), distinguishable at a
// glance by prefix.
export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(32).toString('base64url')}`;
}

const MAX_URL_LENGTH = 2048;

// Shape-only validation — https scheme, well-formed URL. This is
// deliberately NOT the SSRF check (that needs an async DNS lookup, done in
// app/lib/webhook-store.ts against lib/tech-stack-scan.ts's already-
// established isPrivateOrReservedIp()/dns resolution, reused rather than
// reimplemented). Returns null for anything not a well-formed https URL,
// including a bare IP-literal https URL with no hostname to later
// re-resolve defensively before each delivery (TOCTOU defense, issue #210
// §17) — a hostname is required.
export function parseWebhookUrl(rawUrl: unknown): URL | null {
  if (typeof rawUrl !== 'string' || !rawUrl.trim() || rawUrl.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (!url.hostname) return null;
  return url;
}

export type CreateWebhookValidationResult =
  | { valid: true; value: { brand: string; url: string; events: WebhookEventType[] } }
  | { valid: false; errors: string[] };

export function validateCreateWebhookInput(input: any, knownBrand: string | null): CreateWebhookValidationResult {
  const errors: string[] = [];
  if (!knownBrand) errors.push('a valid brand is required');

  const parsedUrl = parseWebhookUrl(input?.url);
  if (!parsedUrl) errors.push('url must be a well-formed https:// URL');

  const events: WebhookEventType[] = Array.isArray(input?.events)
    ? input.events.filter((e: unknown): e is WebhookEventType => VALID_WEBHOOK_EVENT_TYPES.includes(e as WebhookEventType))
    : [];
  if (events.length === 0) errors.push(`events must include at least one of: ${VALID_WEBHOOK_EVENT_TYPES.join(', ')}`);

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, value: { brand: knownBrand as string, url: parsedUrl!.toString(), events } };
}

export type SignedWebhookRequest = {
  body: string;
  headers: {
    'webhook-id': string;
    'webhook-timestamp': string;
    'webhook-signature': string;
    'Content-Type': 'application/json';
  };
};

// HMAC-SHA256 over `{deliveryId}.{unixTimestampSeconds}.{rawBody}`, mirroring
// lib/resend-webhook.ts's inbound Standard-Webhooks-shaped verification
// (svix-id/svix-timestamp/svix-signature) in the outbound direction, per
// issue #210 §17's own explicit instruction to reuse that shape rather than
// invent a new scheme. `webhook-signature` is `v1,<base64 hmac>` — the `v1`
// prefix lets a future signing-scheme change be introduced without breaking
// an integrator's existing verification code (they can branch on the
// prefix).
export function signWebhookPayload(
  secret: string,
  deliveryId: string,
  event: WebhookEventType,
  brand: string,
  data: Record<string, unknown>,
  timestampSeconds: number
): SignedWebhookRequest {
  const body = JSON.stringify({ event, brand, data, deliveryId });
  const signedContent = `${deliveryId}.${timestampSeconds}.${body}`;
  const signature = createHmac('sha256', secret).update(signedContent).digest('base64');
  return {
    body,
    headers: {
      'webhook-id': deliveryId,
      'webhook-timestamp': String(timestampSeconds),
      'webhook-signature': `v1,${signature}`,
      'Content-Type': 'application/json',
    },
  };
}

// The verification recipe an integrator runs on their own end — also used
// by this repo's own tests to assert the signing/verification round-trip
// agrees. Constant-time compare (timingSafeEqual) so verification itself
// can't leak the correct signature via response-time side channel.
export function verifyWebhookSignature(
  secret: string,
  deliveryId: string,
  timestampSeconds: number,
  rawBody: string,
  providedSignatureHeader: string
): boolean {
  const match = providedSignatureHeader.match(/^v1,(.+)$/);
  if (!match) return false;
  const signedContent = `${deliveryId}.${timestampSeconds}.${rawBody}`;
  const expected = createHmac('sha256', secret).update(signedContent).digest('base64');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(match[1], 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}
