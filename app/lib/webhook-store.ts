// Outbound webhooks (issue #210 sub-issue #219) — Mongo-aware layer + the
// actual SSRF-guarded outbound delivery. Pure signing/validation logic
// lives in lib/webhooks.ts; this module does I/O: Mongo CRUD, DNS
// resolution, and the outbound HTTPS POST itself.
//
// Delivery worker cadence — a real, disclosed implementation decision
// (issue #210 §15 left this open, calling it "an implementation decision,
// not resolved by this issue"): this repo's live, deployed Vercel project
// already runs two hourly cron jobs (reports-tick, gmail/sync, both
// `0 * * * *`) successfully in production — verified directly via the
// Vercel API against the real project, not assumed. Since Vercel's Hobby
// tier hard-caps cron at once-per-day, two already-working hourly crons is
// direct evidence this project's plan supports at least hourly cron.
// Sub-minute/every-minute cadence could not be confirmed with the same
// certainty (no tool available to this session surfaces the team's exact
// plan tier), so this worker ships on the same hourly cadence already
// proven live here (app/api/admin/webhook-delivery-tick/route.ts, added to
// vercel.json), rather than assuming an unverified finer cadence. This
// means lib/webhooks.ts's own RETRY_SCHEDULE_SECONDS (1m/5m/30m/2h/12h)
// governs eligibility, not exact timing — a delivery becomes eligible to
// retry at nextAttemptAt and is actually retried at the next hourly tick
// on or after that time.

import type { Db } from 'mongodb';
import * as https from 'https';
import { lookup as dnsLookupCb } from 'dns';
import { promisify } from 'util';
import { encryptCredentials, decryptCredentials, type EncryptedBlob } from '../../lib/integration-crypto';
import { isPrivateOrReservedIp } from '../../lib/tech-stack-scan';
import {
  generateWebhookSecret,
  parseWebhookUrl,
  signWebhookPayload,
  nextRetryDelaySeconds,
  isDeadLetterThresholdReached,
  MAX_DELIVERY_ATTEMPTS,
  type WebhookEventType,
  type WebhookRecord,
  type WebhookDeliveryRecord,
} from '../../lib/webhooks';

export const WEBHOOKS_COLLECTION = 'webhooks';
export const WEBHOOK_DELIVERIES_COLLECTION = 'webhook_deliveries';

const dnsLookupAsync = promisify(dnsLookupCb);

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_DELIVERY_BATCH = 200; // caps one tick's work, matching reports-tick's/cadence-tick's own per-tick cap convention
const USER_AGENT = 'SalesLeadGenerator-Webhooks/1.0';

type IpResolution = { address: string; family: 4 | 6 };
type PostOutcome = { statusCode: number } | { timeout: true } | { error: string };

// Injectable network deps, mirroring lib/tech-stack-scan.ts's own
// ScanTechStackDeps pattern — lets tests (unit and integration) exercise
// the SSRF check and delivery logic deterministically, with no real DNS
// lookup or outbound HTTP call, exactly like that module's own test suite
// does for its GET-based scan.
export type WebhookNetworkDeps = {
  resolveIp?: (hostname: string) => Promise<IpResolution>;
  performPost?: (url: URL, ip: IpResolution, body: string, headers: Record<string, string>, timeoutMs: number) => Promise<PostOutcome>;
};

const indexesEnsured = new Set<string>();
export async function ensureWebhookIndexes(db: Db): Promise<void> {
  if (indexesEnsured.has('done')) return;
  try {
    await db.collection(WEBHOOKS_COLLECTION).createIndex({ brand: 1, events: 1 });
    await db.collection(WEBHOOK_DELIVERIES_COLLECTION).createIndex({ status: 1, nextAttemptAt: 1 });
    await db.collection(WEBHOOK_DELIVERIES_COLLECTION).createIndex({ webhookId: 1 });
    indexesEnsured.add('done');
  } catch (error) {
    console.error('[webhook-store] index creation failed', error);
  }
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Async SSRF check: resolves the hostname for real and rejects a private/
// reserved/loopback/link-local/cloud-metadata target, reusing
// lib/tech-stack-scan.ts's already-audited range table rather than
// reimplementing it. Used both at registration (POST /api/admin/webhooks)
// and defensively immediately before every delivery attempt — DNS can
// change between registration and delivery ("TOCTOU" rebinding), issue
// #210 §17's own explicit requirement.
export async function isWebhookUrlSafe(rawUrl: string, deps?: WebhookNetworkDeps): Promise<boolean> {
  const url = parseWebhookUrl(rawUrl);
  if (!url) return false;
  const resolveIp = deps?.resolveIp ?? defaultResolveIp;
  try {
    const result = await resolveIp(url.hostname);
    return !isPrivateOrReservedIp(result.address, result.family);
  } catch {
    return false; // unresolvable hostname is never treated as safe
  }
}

export type CreateWebhookResult = { ok: true; record: Omit<WebhookRecord, 'encryptedSecret'>; rawSecret: string } | { ok: false; error: string };

export async function createWebhook(
  db: Db,
  input: { brand: string; url: string; events: WebhookEventType[] },
  createdBy: string,
  deps?: WebhookNetworkDeps
): Promise<CreateWebhookResult> {
  await ensureWebhookIndexes(db);

  const safe = await isWebhookUrlSafe(input.url, deps);
  if (!safe) return { ok: false, error: 'url must be a public https:// address (private/internal/metadata targets are rejected)' };

  const rawSecret = generateWebhookSecret();
  const encryptedSecret = encryptCredentials({ secret: rawSecret });
  const record: WebhookRecord = {
    id: makeId('webhook'),
    brand: input.brand,
    url: input.url,
    events: input.events,
    encryptedSecret: encryptedSecret as EncryptedBlob,
    createdBy,
    createdAt: new Date().toISOString(),
    disabledAt: null,
    disabledReason: null,
    consecutiveFailures: 0,
  };
  await db.collection(WEBHOOKS_COLLECTION).insertOne(record);
  const { encryptedSecret: _omit, ...withoutSecret } = record;
  return { ok: true, record: withoutSecret, rawSecret };
}

export async function listWebhooks(db: Db, brand: string): Promise<Omit<WebhookRecord, 'encryptedSecret'>[]> {
  const docs = await db.collection(WEBHOOKS_COLLECTION).find({ brand }).sort({ createdAt: -1 }).toArray();
  return docs.map((d: any) => ({
    id: d.id, brand: d.brand, url: d.url, events: d.events, createdBy: d.createdBy,
    createdAt: d.createdAt, disabledAt: d.disabledAt, disabledReason: d.disabledReason,
    consecutiveFailures: d.consecutiveFailures,
  }));
}

// Hard delete, per issue #210 §10's own explicit contract ("not soft — a
// removed subscription should stop immediately and not appear in any
// future listing"). Existing webhook_deliveries rows referencing this id
// are left as an audit trail; the delivery worker treats a missing
// webhookId as exhausted (see processWebhookDeliveries below), so nothing
// further is ever sent to a deleted subscription's URL.
export async function deleteWebhook(db: Db, id: string, brand: string): Promise<boolean> {
  const result = await db.collection(WEBHOOKS_COLLECTION).deleteOne({ id, brand });
  return result.deletedCount > 0;
}

export async function setWebhookEnabled(db: Db, id: string, brand: string, enabled: boolean): Promise<boolean> {
  const update = enabled
    ? { disabledAt: null, disabledReason: null, consecutiveFailures: 0 }
    : { disabledAt: new Date().toISOString(), disabledReason: 'manually disabled by admin' };
  const result = await db.collection(WEBHOOKS_COLLECTION).updateOne({ id, brand }, { $set: update });
  return result.modifiedCount > 0;
}

// Enqueue-only, per issue #210 §16's explicit performance requirement — no
// outbound HTTP call happens on this path, so a caller in a lead-mutation
// request (POST /api/leads, executeLeadAction()) can safely await this
// without risking added latency from a slow/dead external endpoint. A
// brand with zero matching active subscriptions is a single indexed query
// returning empty — cheap, never blocks or errors the caller.
export async function emitWebhookEvent(
  db: Db,
  brand: string,
  event: WebhookEventType,
  payload: Record<string, unknown>
): Promise<void> {
  await ensureWebhookIndexes(db);
  const subscriptions = await db.collection(WEBHOOKS_COLLECTION)
    .find({ brand, events: event, disabledAt: null })
    .toArray();
  if (subscriptions.length === 0) return;

  const now = new Date().toISOString();
  const deliveries = subscriptions.map((sub: any) => ({
    id: makeId('whdel'),
    webhookId: sub.id,
    brand,
    event,
    payload,
    attempt: 1,
    status: 'pending' as const,
    httpStatus: null,
    nextAttemptAt: now,
    createdAt: now,
    deliveredAt: null,
  }));
  await db.collection(WEBHOOK_DELIVERIES_COLLECTION).insertMany(deliveries);
}

async function defaultResolveIp(hostname: string): Promise<IpResolution> {
  const result = await dnsLookupAsync(hostname);
  return { address: result.address, family: result.family as 4 | 6 };
}

// POST with a pre-resolved IP override, mirroring lib/tech-stack-scan.ts's
// GET-request connect pattern (same TOCTOU defense: DNS is resolved once,
// validated, and the TCP connection is forced to that exact address via
// Node's `lookup` option — the Host header / TLS SNI still target the
// original hostname, so this can never be redirected to resolve
// differently between validation and connection).
function defaultPerformPost(url: URL, ip: IpResolution, body: string, headers: Record<string, string>, timeoutMs: number): Promise<PostOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (outcome: PostOutcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };

    const req = https.request({
      protocol: 'https:',
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: { ...headers, 'User-Agent': USER_AGENT, Host: url.host, 'Content-Length': Buffer.byteLength(body) },
      timeout: timeoutMs,
      lookup: (_hostname: string, _options: unknown, callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void) => {
        callback(null, ip.address, ip.family);
      },
    } as https.RequestOptions, (res) => {
      res.resume(); // drain body — the delivery worker doesn't need the response payload, only the status
      res.on('end', () => settle({ statusCode: res.statusCode || 0 }));
      res.on('error', (err) => settle({ error: err.message }));
    });

    req.on('timeout', () => { req.destroy(); settle({ timeout: true }); });
    req.on('error', (err) => settle({ error: err.message }));
    req.write(body);
    req.end();
  });
}

export type DeliveryTickSummary = {
  processed: number;
  delivered: number;
  retried: number;
  exhausted: number;
  disabledWebhooks: number;
};

// The delivery worker's one tick, invoked from
// app/api/admin/webhook-delivery-tick/route.ts on the hourly cron (see
// this file's header comment). Never throws for a single delivery's own
// failure — every outcome (send success, non-2xx, timeout, network error,
// missing/disabled webhook, re-validated-unsafe URL) is handled per
// delivery so one bad row can never abort the whole batch.
export async function processWebhookDeliveries(db: Db, now: Date = new Date(), deps?: WebhookNetworkDeps): Promise<DeliveryTickSummary> {
  await ensureWebhookIndexes(db);
  const summary: DeliveryTickSummary = { processed: 0, delivered: 0, retried: 0, exhausted: 0, disabledWebhooks: 0 };

  const due = await db.collection(WEBHOOK_DELIVERIES_COLLECTION)
    .find({ status: 'pending', nextAttemptAt: { $lte: now.toISOString() } })
    .limit(MAX_DELIVERY_BATCH)
    .toArray();

  for (const delivery of due as unknown as WebhookDeliveryRecord[]) {
    summary.processed++;
    const outcome = await processOneDelivery(db, delivery, now, deps);
    if (outcome === 'delivered') summary.delivered++;
    else if (outcome === 'retried') summary.retried++;
    else if (outcome === 'exhausted') summary.exhausted++;
    if (outcome === 'disabled') summary.disabledWebhooks++;
  }

  return summary;
}

async function markDelivery(db: Db, id: string, status: 'delivered' | 'failed' | 'exhausted', extra: Record<string, unknown> = {}): Promise<void> {
  await db.collection(WEBHOOK_DELIVERIES_COLLECTION).updateOne({ id }, { $set: { status, ...extra } });
}

async function processOneDelivery(db: Db, delivery: WebhookDeliveryRecord, now: Date, deps?: WebhookNetworkDeps): Promise<'delivered' | 'retried' | 'exhausted' | 'disabled' | 'skipped'> {
  const webhook = await db.collection(WEBHOOKS_COLLECTION).findOne({ id: delivery.webhookId });
  if (!webhook || webhook.disabledAt) {
    await markDelivery(db, delivery.id, 'exhausted');
    return 'exhausted';
  }

  // TOCTOU re-check — DNS may have changed since registration or since the
  // last attempt. An unsafe re-resolution is handled as an ordinary
  // delivery failure (same retry/dead-letter accounting below), not a
  // special case — a target that started safe and now resolves privately
  // is operationally indistinguishable from "this endpoint stopped
  // working," and gets the same backoff treatment.
  const stillSafe = await isWebhookUrlSafe(webhook.url, deps);
  if (!stillSafe) {
    return handleFailure(db, delivery, webhook, null, now);
  }

  let rawSecret: string;
  try {
    rawSecret = decryptCredentials<{ secret: string }>(webhook.encryptedSecret).secret;
  } catch (error) {
    console.error('[webhook-store] failed to decrypt webhook secret', { webhookId: webhook.id, error });
    return handleFailure(db, delivery, webhook, null, now);
  }

  const timestampSeconds = Math.floor(now.getTime() / 1000);
  const signed = signWebhookPayload(rawSecret, delivery.id, delivery.event, delivery.brand, delivery.payload, timestampSeconds);

  const url = parseWebhookUrl(webhook.url);
  if (!url) return handleFailure(db, delivery, webhook, null, now);

  const resolveIp = deps?.resolveIp ?? defaultResolveIp;
  let ip: IpResolution;
  try {
    ip = await resolveIp(url.hostname);
  } catch {
    return handleFailure(db, delivery, webhook, null, now);
  }

  const performPost = deps?.performPost ?? defaultPerformPost;
  const result = await performPost(url, ip, signed.body, signed.headers, DELIVERY_TIMEOUT_MS);

  if ('statusCode' in result && result.statusCode >= 200 && result.statusCode < 300) {
    await markDelivery(db, delivery.id, 'delivered', { httpStatus: result.statusCode, deliveredAt: now.toISOString() });
    await db.collection(WEBHOOKS_COLLECTION).updateOne({ id: webhook.id }, { $set: { consecutiveFailures: 0 } });
    return 'delivered';
  }

  const httpStatus = 'statusCode' in result ? result.statusCode : null;
  return handleFailure(db, delivery, webhook, httpStatus, now);
}

async function handleFailure(db: Db, delivery: WebhookDeliveryRecord, webhook: any, httpStatus: number | null, now: Date): Promise<'retried' | 'exhausted' | 'disabled'> {
  const delaySeconds = nextRetryDelaySeconds(delivery.attempt);

  if (delivery.attempt >= MAX_DELIVERY_ATTEMPTS || delaySeconds === null) {
    await markDelivery(db, delivery.id, 'exhausted', { httpStatus });
    const newFailures = (webhook.consecutiveFailures || 0) + 1;
    const updates: Record<string, unknown> = { consecutiveFailures: newFailures };
    let disabled = false;
    if (isDeadLetterThresholdReached(newFailures) && !webhook.disabledAt) {
      updates.disabledAt = now.toISOString();
      updates.disabledReason = `auto-disabled after ${newFailures} consecutive exhausted deliveries`;
      disabled = true;
    }
    await db.collection(WEBHOOKS_COLLECTION).updateOne({ id: webhook.id }, { $set: updates });
    return disabled ? 'disabled' : 'exhausted';
  }

  const nextAttemptAt = new Date(now.getTime() + delaySeconds * 1000).toISOString();
  await db.collection(WEBHOOK_DELIVERIES_COLLECTION).updateOne(
    { id: delivery.id },
    { $set: { attempt: delivery.attempt + 1, nextAttemptAt, status: 'pending', httpStatus } }
  );
  return 'retried';
}
