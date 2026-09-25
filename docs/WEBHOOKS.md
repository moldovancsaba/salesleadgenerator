# Outbound Webhooks — Integrator Guide

**Version:** 2.4.210

This is the integrator-facing recipe for consuming Sales Lead Generator's outbound webhooks (issue #210 sub-issue #219): the event set, the request shape, and exactly how to verify a delivery is genuinely from this app rather than an impersonation. It's written to the same level of detail `docs/LEAD_ENRICHMENT_GUIDE.md` gives the *inbound* research-agent contract — this is the outbound counterpart.

---

## 1. Registering a subscription

A brand super-admin registers a webhook at `/admin/api-keys` (the "Webhooks" section — shares the page with API key management), or directly via `POST /api/admin/webhooks` (session-only, never `x-api-key`-accessible):

```json
POST /api/admin/webhooks
{
  "brand": "cogmap",
  "url": "https://example.com/webhooks/salesleadgenerator",
  "events": ["lead.created", "lead.stage_changed", "lead.won", "lead.lost"]
}
```

Response (`201`):

```json
{
  "webhook": { "id": "webhook_...", "brand": "cogmap", "url": "...", "events": [...], "disabledAt": null, "consecutiveFailures": 0, ... },
  "secret": "whsec_..."
}
```

**The `secret` is shown exactly once, in this one response.** Copy it immediately — only an encrypted-at-rest form is stored server-side afterward, and it is never re-displayed. Losing it means deleting the webhook and registering a new one; there is no recovery path.

`url` must be a public `https://` address you control. Registration is rejected (`400`) if the URL:
- Uses `http://` instead of `https://`.
- Resolves to a private/reserved/loopback/link-local address (RFC1918, `127.0.0.0/8`, `169.254.0.0/16` including the `169.254.169.254` cloud-metadata address specifically, `::1`, `fc00::/7`, `fe80::/10`, and a handful of other reserved ranges) — a real DNS resolution is performed at registration time, not just a string check.

## 2. The event set

| Event | Fires when |
|---|---|
| `lead.created` | A lead is created (`POST /api/leads`). |
| `lead.stage_changed` | Any action that moves a lead's `kanbanColumn` (drag, `COLUMN_MOVE`, `PIN`, `DECLINE`, etc.) — fires for *any* column change, including into `WON`/`LOST`. |
| `lead.won` | A lead's `kanbanColumn` becomes `WON` — fires **in addition to** `lead.stage_changed` for that same transition, so subscribe to whichever granularity you actually need. |
| `lead.lost` | A lead's `kanbanColumn` becomes `LOST` — same "in addition to `lead.stage_changed`" relationship as `lead.won`. |

Deliveries are **at-least-once, never deduplicated server-side**. The same event firing twice in rapid succession (e.g. two stage changes inside one bulk action) produces two independent deliveries. Use the `deliveryId` field in the payload (see below) to deduplicate on your own end if that matters to your integration.

## 3. Request shape

Every delivery is an HTTP `POST` to your registered `url`, with:

```
Content-Type: application/json
webhook-id: whdel_...
webhook-timestamp: 1700000000
webhook-signature: v1,<base64 HMAC-SHA256>
```

```json
{
  "event": "lead.stage_changed",
  "brand": "cogmap",
  "data": { "leadId": "...", "tenantId": "default", "fromColumn": "QUALIFIED", "toColumn": "ENGAGED", "lead": { ...full normalized lead... } },
  "deliveryId": "whdel_..."
}
```

`webhook-id` and the payload's own `deliveryId` are always identical — the header exists so you can act on it before parsing the body if you want to.

## 4. Verifying the signature

**Always verify before trusting a delivery.** The signing scheme deliberately mirrors the Standard Webhooks shape this app's own *inbound* Resend webhook verification already uses (`lib/resend-webhook.ts`'s `svix-id`/`svix-timestamp`/`svix-signature` triple) — if you've integrated a Standard-Webhooks-style verifier before, this will look familiar.

**Recipe:**

1. Take the raw, unparsed request body bytes exactly as received — not a re-serialized `JSON.stringify` of a parsed object. Whitespace/key-order differences will break the signature.
2. Build the signed content string: `{webhook-id header value}.{webhook-timestamp header value}.{raw body}` — three parts joined by literal `.` characters.
3. Compute `HMAC-SHA256(your webhook's secret, that signed content string)`, base64-encoded.
4. Compare your computed value against the part of the `webhook-signature` header after the `v1,` prefix, using a **constant-time comparison** (never `===`/`==` on the raw strings — a naive comparison leaks timing information an attacker can use to forge a valid signature byte-by-byte).
5. Reject the delivery (do not process it) if the comparison fails.

Node.js example, using only built-in `crypto` (no dependency required):

```js
const crypto = require('crypto');

function verifySalesLeadGeneratorWebhook(secret, rawBody, headers) {
  const deliveryId = headers['webhook-id'];
  const timestamp = headers['webhook-timestamp'];
  const signatureHeader = headers['webhook-signature']; // "v1,<base64>"

  const match = /^v1,(.+)$/.exec(signatureHeader || '');
  if (!match) return false;

  const signedContent = `${deliveryId}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', secret).update(signedContent).digest('base64');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const providedBuf = Buffer.from(match[1], 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, providedBuf);
}
```

This is the exact same algorithm this app's own `lib/webhooks.ts` implements (`signWebhookPayload()`/`verifyWebhookSignature()`) and tests against a fixed input/output vector — if your own implementation disagrees with a real delivery, verify your raw-body handling first (the most common cause is accidentally re-serializing a parsed JSON body before hashing it, which changes the bytes even when the content looks identical).

**A `webhook-timestamp` sanity check is recommended but not enforced server-side.** Reject a delivery whose timestamp is more than a few minutes old (a stale/replayed request) — this app does not itself enforce a freshness window on the *sending* side beyond the retry schedule below, so a genuinely delayed retry can carry an older timestamp; how much staleness you tolerate is your own integration's judgment call.

## 5. Retries and failure handling

A non-`2xx` response (or a timeout, or a connection error) is retried on this schedule: **1 minute, 5 minutes, 30 minutes, 2 hours, 12 hours** — 5 attempts total, then the delivery is marked `exhausted` and never retried again.

**Disclosed real-world timing note:** the delivery worker itself runs on an hourly cron (see `docs/ARCHITECTURE.md`'s "Outbound Webhooks" section for why), so in practice a retry fires at the next hourly tick on or after the scheduled time above, not at the exact minute — a delivery that becomes eligible to retry at, say, 2:03pm will actually retry at the 3:00pm tick, not 2:04pm. Design your endpoint to tolerate a delayed retry rather than assuming sub-hour precision.

**Your endpoint is expected to respond quickly with a `2xx` and do any slow work asynchronously afterward** — there is a 10-second delivery timeout on this app's side, after which the attempt is treated as a failure and retried per the schedule above.

**After 5 consecutive fully-exhausted deliveries** (not 5 raw HTTP failures — 5 deliveries that each individually ran out their own full retry schedule), your webhook subscription is **automatically disabled**. No further events are sent until a brand admin manually re-enables it from `/admin/api-keys` (after fixing whatever was wrong with your endpoint). The admin UI shows the disabled state and reason.

## 6. Security notes

- **Treat your webhook secret like any other credential** — do not commit it, do not log it, do not expose it client-side.
- **Registering a webhook grants that URL a feed of lead data, including contact PII** (name, email, phone, per `docs/LEAD_ENRICHMENT_GUIDE.md`'s own field model). Only register an endpoint you control and trust.
- **The delivery is always signed — never trust an unsigned or incorrectly-signed request claiming to be from this app.** Always run the verification recipe in §4 before acting on a delivery's contents.

---

See also: `docs/ARCHITECTURE.md`'s "Outbound Webhooks" section for the server-side implementation detail (data model, SSRF defenses, the retry worker's real design), and `docs/LEAD_ENRICHMENT_GUIDE.md` for the inbound (research-agent) side of this app's API surface.
