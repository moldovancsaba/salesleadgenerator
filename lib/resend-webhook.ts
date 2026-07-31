import { Resend } from 'resend';

// Issue #141 — Resend signs every inbound webhook request with the same 3
// headers the underlying Standard Webhooks spec (and Svix, which Resend's
// own SDK delegates to internally) uses: svix-id / svix-timestamp /
// svix-signature. Verified against the real resend package's compiled
// source (node_modules/resend/dist/index.mjs's Webhooks.verify()) rather
// than assumed from the docs alone — the SDK's own .d.ts types this as the
// Fetch API's `Headers`, but the actual runtime implementation reads plain
// `payload.headers.id/.timestamp/.signature` properties, which is what this
// module's own type reflects.
export type ResendWebhookHeaders = { id: string; timestamp: string; signature: string };

// Returns null (not a partial/guessed header set) if any of the 3 required
// headers is missing, so a caller can reject a malformed request before ever
// reaching signature verification.
export function extractResendWebhookHeaders(headers: Headers): ResendWebhookHeaders | null {
  const id = headers.get('svix-id');
  const timestamp = headers.get('svix-timestamp');
  const signature = headers.get('svix-signature');
  if (!id || !timestamp || !signature) return null;
  return { id, timestamp, signature };
}

// Verifies a raw (unparsed — must be the exact bytes the request arrived
// with, not a re-serialized JSON.stringify of a parsed body) request body
// against Resend's signature. Fails closed: throws on any invalid/expired/
// mismatched signature, per resend.com/docs/dashboard/webhooks/
// verify-webhooks-requests — never returns a "maybe valid" result. The
// caller is responsible for constructing the Resend client (it needs a real
// RESEND_API_KEY at runtime for the follow-up email-content fetch anyway;
// verification itself never makes a network call, so a placeholder key is
// sufficient in a test context).
export function verifyResendWebhook(resend: Resend, rawBody: string, headers: ResendWebhookHeaders, webhookSecret: string): unknown {
  return resend.webhooks.verify({ payload: rawBody, headers, webhookSecret });
}

export function isResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY && !!process.env.RESEND_WEBHOOK_SECRET;
}
