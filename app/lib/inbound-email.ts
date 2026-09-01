import type { Brand } from './brand'
import type { ActivityLogDocument } from './activity-log-store'

// Issue #141 — pure business logic for turning a verified Resend
// `email.received` webhook event into what gets written to activityLog.
// Kept separate from the route handler (app/api/webhooks/inbound-email/
// route.ts) so brand/direction resolution can be unit-tested without a
// database or a live Resend account.
//
// Issue #195 — stays synchronous and DB-free on purpose (so
// tests/lib/inbound-email.test.ts can keep unit-testing it with zero
// database), even though the brand registry itself is now Mongo-backed:
// `allBrands` is resolved once by the one real caller
// (app/api/webhooks/inbound-email/route.ts, already async with DB access)
// via `Object.keys(await getAllBrandConfigs())` and passed in, rather than
// this module importing brand config at module scope.

// Resend has no documented +tag plus-addressing (verified against their own
// receiving docs, not assumed) — brand routing instead uses distinct
// addresses per brand, resolved by matching the local-part (before @)
// against a brand slug as a prefix: "cogmap@..." / "seyu@..." (or a longer
// address like "cogmap-log@..." also resolves, since it's a prefix match,
// not an exact one).
export function resolveBrandFromAddress(address: string | undefined | null, allBrands: Brand[]): Brand | null {
  if (!address) return null
  const localPart = address.split('@')[0]?.toLowerCase().trim()
  if (!localPart) return null
  for (const brand of allBrands) {
    if (localPart.startsWith(brand)) return brand
  }
  return null
}

// received_for (Resend's own record of which address actually received the
// message) is checked before to[] — it's the more authoritative signal when
// a domain has a catch-all or multiple aliases; to[] is the fallback for
// providers/configurations where received_for might be absent.
export function resolveBrandFromRecipients(receivedFor: string[] | undefined, to: string[] | undefined, allBrands: Brand[]): Brand | null {
  for (const address of [...(receivedFor || []), ...(to || [])]) {
    const brand = resolveBrandFromAddress(address, allBrands)
    if (brand) return brand
  }
  return null
}

// Which of received_for/to actually matched a brand — this is "our address"
// for the direction check below, not necessarily receivedFor[0]/to[0].
export function resolveMatchedAddress(receivedFor: string[] | undefined, to: string[] | undefined, allBrands: Brand[]): string | null {
  for (const address of [...(receivedFor || []), ...(to || [])]) {
    if (resolveBrandFromAddress(address, allBrands)) return address
  }
  return null
}

// Direction is derived from a real signal already present in the payload,
// not guessed from sender domain (no rep-domain config exists or is
// required): if our dedicated address is explicitly in To/Cc, a human
// (a lead) addressed it directly -- that's the shape of a genuine reply. If
// it's absent from both (only reachable via Bcc or Resend's own
// received_for), that's the shape of the rep's own outbound send being
// captured. Documented known limitation: some mail clients/MTAs strip the
// Bcc header before delivery even to the bcc'd recipient themselves, so a
// genuine BCC-capture email can arrive with our address in neither To/Cc/Bcc
// visibly — it still classifies correctly as 'outbound' here, since the
// only way it could be inbound-labeled is by being visibly in To/Cc.
export function resolveDirection(params: { to: string[]; cc: string[]; ourAddress: string }): 'inbound' | 'outbound' {
  const normalize = (value: string) => value.toLowerCase().trim()
  const our = normalize(params.ourAddress)
  const inList = (list: string[]) => (list || []).some((address) => normalize(address) === our)
  if (inList(params.to) || inList(params.cc)) return 'inbound'
  return 'outbound'
}

export type ReceivedEmailEvent = {
  emailId: string
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  receivedFor: string[]
  subject: string
  messageId: string
}

// Builds the activityLog write document. leadId is always null here —
// cross-lead contact matching (contactEmails[] -> the actual sender/
// recipient match) is issue #142's job, not this one's; see
// ActivityLogDocument's own doc comment for why an unmatched entry is
// stored, not dropped.
export function buildActivityLogDoc(
  event: ReceivedEmailEvent,
  bodyExcerpt: string | undefined,
  now: Date,
  allBrands: Brand[]
): ActivityLogDocument {
  const brand = resolveBrandFromRecipients(event.receivedFor, event.to, allBrands)
  const ourAddress = resolveMatchedAddress(event.receivedFor, event.to, allBrands) || event.receivedFor[0] || event.to[0] || ''
  const direction = resolveDirection({ to: event.to, cc: event.cc, ourAddress })

  return {
    leadId: null,
    tenantId: 'default',
    brand: brand ?? 'unresolved',
    type: direction === 'inbound' ? 'email-inbound' : 'email-outbound',
    direction,
    fromAddress: event.from || undefined,
    toAddresses: event.to,
    ccAddresses: event.cc,
    subject: event.subject || undefined,
    bodyExcerpt,
    matchedContactKey: null,
    source: 'inbound-webhook',
    externalId: event.emailId,
    createdAt: now,
  }
}
