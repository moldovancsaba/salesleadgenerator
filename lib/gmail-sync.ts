import { createHash } from 'crypto';
import { normalizeEmail } from './contacts';

// Gmail sync (issue #216) — pure dedup-key, direction, and gating logic.
// Zero DB, zero network, fully unit-testable in isolation from
// app/lib/gmail-sync-store.ts's Mongo/Gmail-API orchestration.

// RFC 2822 Message-ID is globally unique per email — the primary dedup key,
// backed by activityLog's existing unique-sparse index on `externalId`
// (app/lib/activity-log-store.ts), the same index inbound-webhook entries
// already share.
export function buildGmailExternalId(messageIdHeader: string): string {
  return `gmail:${messageIdHeader.trim()}`;
}

// Cross-source guard (issue #216 §11/§15): the same physical email can be
// visible via both the Resend inbound-webhook path and Gmail sync for the
// same brand when a rep has both active. A Message-ID-based match can't
// bridge the two paths (Resend's own externalId is its own email_id, not
// the RFC 2822 Message-ID), so a content-hash fallback is the only way to
// recognize "this is the same email," accepting the narrow window (±2
// minutes, enforced by the caller's own query) rather than a byte-exact
// match.
export function buildFallbackHash(params: {
  from: string;
  toCc: string[];
  subject: string;
  dateIso: string;
}): string {
  const from = normalizeEmail(params.from);
  const toCc = params.toCc.map(normalizeEmail).sort().join(',');
  const subject = params.subject.trim().toLowerCase();
  const minute = floorToMinuteIso(params.dateIso);
  return createHash('sha256').update(`${from}|${toCc}|${subject}|${minute}`).digest('hex');
}

export function floorToMinuteIso(dateIso: string): string {
  const date = new Date(dateIso);
  date.setSeconds(0, 0);
  return date.toISOString();
}

// Data-minimization gate (issue #216 §16/§17): a message body is fetched
// only when at least one participant address is already known to this
// brand's leads. An unrelated personal email is never even fetched past
// the header stage, let alone stored.
export function participantsIntersectKnownEmails(participantEmails: string[], knownEmails: Set<string>): boolean {
  return participantEmails.some((email) => knownEmails.has(normalizeEmail(email)));
}

export function resolveGmailDirection(fromEmail: string, repGmailAddress: string): 'outbound' | 'inbound' {
  return normalizeEmail(fromEmail) === normalizeEmail(repGmailAddress) ? 'outbound' : 'inbound';
}

// The "other side" of the conversation — whichever known address isn't the
// rep's own, used to drive matchReplyToLeads(). Returns null if no known
// counterparty can be identified (should not happen given the caller only
// reaches this after participantsIntersectKnownEmails() already passed,
// but stays defensive rather than assuming).
export function resolveCounterpartyEmail(
  direction: 'outbound' | 'inbound',
  fromEmail: string,
  toCcEmails: string[],
  knownEmails: Set<string>
): string | null {
  if (direction === 'inbound') {
    return normalizeEmail(fromEmail);
  }
  const match = toCcEmails.find((email) => knownEmails.has(normalizeEmail(email)));
  return match ? normalizeEmail(match) : null;
}
