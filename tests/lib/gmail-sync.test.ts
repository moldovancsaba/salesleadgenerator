import { describe, it, expect } from 'vitest';
import {
  buildGmailExternalId, buildFallbackHash, floorToMinuteIso,
  participantsIntersectKnownEmails, resolveGmailDirection, resolveCounterpartyEmail,
} from '../../lib/gmail-sync';

describe('buildGmailExternalId (issue 216)', () => {
  it('prefixes with gmail: and trims the header value', () => {
    expect(buildGmailExternalId('  <abc123@mail.gmail.com>  ')).toBe('gmail:<abc123@mail.gmail.com>');
  });
});

describe('floorToMinuteIso (issue 216)', () => {
  it('zeroes out seconds and milliseconds', () => {
    expect(floorToMinuteIso('2026-01-01T10:15:45.678Z')).toBe('2026-01-01T10:15:00.000Z');
  });
});

describe('buildFallbackHash (issue 216)', () => {
  const base = { from: 'Rep@Example.com', toCc: ['Lead@Example.com'], subject: '  Re: Proposal  ', dateIso: '2026-01-01T10:15:30.000Z' };

  it('is deterministic for the same logical inputs', () => {
    expect(buildFallbackHash(base)).toBe(buildFallbackHash(base));
  });

  it('is case-insensitive on email addresses and subject', () => {
    const upper = { ...base, from: 'rep@example.com', toCc: ['lead@example.com'], subject: 're: proposal' };
    expect(buildFallbackHash(base)).toBe(buildFallbackHash(upper));
  });

  it('is insensitive to toCc array order', () => {
    const a = { ...base, toCc: ['a@example.com', 'b@example.com'] };
    const b = { ...base, toCc: ['b@example.com', 'a@example.com'] };
    expect(buildFallbackHash(a)).toBe(buildFallbackHash(b));
  });

  it('is insensitive to sub-minute timestamp differences (floored to the minute)', () => {
    const early = { ...base, dateIso: '2026-01-01T10:15:01.000Z' };
    const late = { ...base, dateIso: '2026-01-01T10:15:59.000Z' };
    expect(buildFallbackHash(early)).toBe(buildFallbackHash(late));
  });

  it('differs for a different minute', () => {
    const a = { ...base, dateIso: '2026-01-01T10:15:00.000Z' };
    const b = { ...base, dateIso: '2026-01-01T10:16:00.000Z' };
    expect(buildFallbackHash(a)).not.toBe(buildFallbackHash(b));
  });

  it('differs for a different subject', () => {
    expect(buildFallbackHash(base)).not.toBe(buildFallbackHash({ ...base, subject: 'Different subject' }));
  });

  it('differs for a different sender', () => {
    expect(buildFallbackHash(base)).not.toBe(buildFallbackHash({ ...base, from: 'someone-else@example.com' }));
  });
});

describe('participantsIntersectKnownEmails (issue 216 — data-minimization gate)', () => {
  it('is true when at least one participant is known', () => {
    const known = new Set(['lead@example.com']);
    expect(participantsIntersectKnownEmails(['rep@example.com', 'Lead@Example.com'], known)).toBe(true);
  });

  it('is false when no participant is known — never fetches a body for this message', () => {
    const known = new Set(['lead@example.com']);
    expect(participantsIntersectKnownEmails(['unrelated@example.com'], known)).toBe(false);
  });

  it('is false for an empty participant list', () => {
    expect(participantsIntersectKnownEmails([], new Set(['lead@example.com']))).toBe(false);
  });
});

describe('resolveGmailDirection (issue 216)', () => {
  it('is outbound when the sender is the rep\'s own address', () => {
    expect(resolveGmailDirection('rep@example.com', 'Rep@Example.com')).toBe('outbound');
  });

  it('is inbound when the sender is not the rep', () => {
    expect(resolveGmailDirection('lead@example.com', 'rep@example.com')).toBe('inbound');
  });
});

describe('resolveCounterpartyEmail (issue 216)', () => {
  const knownEmails = new Set(['lead@example.com', 'other-lead@example.com']);

  it('for an inbound message, the counterparty is the sender', () => {
    expect(resolveCounterpartyEmail('inbound', 'Lead@Example.com', ['rep@example.com'], knownEmails)).toBe('lead@example.com');
  });

  it('for an outbound message, the counterparty is the first known recipient', () => {
    expect(resolveCounterpartyEmail('outbound', 'rep@example.com', ['unrelated@example.com', 'Lead@Example.com'], knownEmails)).toBe('lead@example.com');
  });

  it('returns null when no known counterparty can be identified', () => {
    expect(resolveCounterpartyEmail('outbound', 'rep@example.com', ['unrelated@example.com'], knownEmails)).toBeNull();
  });
});
