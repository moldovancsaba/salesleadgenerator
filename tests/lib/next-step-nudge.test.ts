import { describe, it, expect } from 'vitest';
import { getNextStepNudge } from '../../lib/next-step-nudge';
import type { StaleDealResult } from '../../lib/stale-deal';

const NOW = new Date('2026-07-25T00:00:00.000Z');
const OLD_ENOUGH_CREATED_AT = new Date(NOW.getTime() - 10 * 86_400_000).toISOString();
const FRESH_CONTACT = { name: 'Jane Doe', isDecisionMaker: true, lastVerifiedAt: NOW.toISOString() };

const STALE_SIGNAL: StaleDealResult = { daysSince: 15, thresholdDays: 14, severity: 'stale' };

describe('getNextStepNudge', () => {
  it('returns null when there is no staleness signal and a fresh decision maker is present', () => {
    const result = getNextStepNudge(
      { kanbanColumn: 'ENGAGED', createdAt: OLD_ENOUGH_CREATED_AT, contacts: [FRESH_CONTACT] },
      null,
      NOW
    );
    expect(result).toBeNull();
  });

  it('returns null for WON regardless of signals', () => {
    const result = getNextStepNudge(
      { kanbanColumn: 'WON', createdAt: OLD_ENOUGH_CREATED_AT, contacts: [] },
      STALE_SIGNAL,
      NOW
    );
    expect(result).toBeNull();
  });

  it('returns null for LOST regardless of signals', () => {
    const result = getNextStepNudge(
      { kanbanColumn: 'LOST', createdAt: OLD_ENOUGH_CREATED_AT, contacts: [] },
      STALE_SIGNAL,
      NOW
    );
    expect(result).toBeNull();
  });

  it('returns null within the creation grace period', () => {
    const result = getNextStepNudge(
      { kanbanColumn: 'DISCOVERED', createdAt: new Date(NOW.getTime() - 1 * 86_400_000).toISOString(), contacts: [] },
      STALE_SIGNAL,
      NOW
    );
    expect(result).toBeNull();
  });

  it('returns NO_CONTACTS when contacts is empty', () => {
    const result = getNextStepNudge(
      { kanbanColumn: 'DISCOVERED', createdAt: OLD_ENOUGH_CREATED_AT, contacts: [] },
      null,
      NOW
    );
    expect(result).toMatchObject({ id: 'NO_CONTACTS', actionable: false });
  });

  it('returns NO_CONTACTS when contacts is undefined', () => {
    const result = getNextStepNudge(
      { kanbanColumn: 'DISCOVERED', createdAt: OLD_ENOUGH_CREATED_AT },
      null,
      NOW
    );
    expect(result?.id).toBe('NO_CONTACTS');
  });

  it('DECISION_MAKER_MISSING outranks a simultaneous staleness signal', () => {
    const result = getNextStepNudge(
      { kanbanColumn: 'ENGAGED', createdAt: OLD_ENOUGH_CREATED_AT, contacts: [{ name: 'Someone', isDecisionMaker: false }] },
      STALE_SIGNAL,
      NOW
    );
    expect(result).toMatchObject({ id: 'DECISION_MAKER_MISSING', actionable: true, action: 'REQUEST_REFRESH' });
  });

  it('NEEDS_VERIFICATION outranks a simultaneous staleness signal', () => {
    const staleContact = { name: 'Jane Doe', isDecisionMaker: true, lastVerifiedAt: new Date(NOW.getTime() - 365 * 86_400_000).toISOString() };
    const result = getNextStepNudge(
      { kanbanColumn: 'ENGAGED', createdAt: OLD_ENOUGH_CREATED_AT, contacts: [staleContact] },
      STALE_SIGNAL,
      NOW
    );
    expect(result).toMatchObject({ id: 'NEEDS_VERIFICATION', actionable: true, action: 'REQUEST_REFRESH' });
  });

  it('returns STALE when the staleness signal is present and no higher-priority condition applies', () => {
    const result = getNextStepNudge(
      { kanbanColumn: 'ENGAGED', createdAt: OLD_ENOUGH_CREATED_AT, contacts: [FRESH_CONTACT] },
      STALE_SIGNAL,
      NOW
    );
    expect(result).toMatchObject({ id: 'STALE', actionable: false, severity: 'info' });
  });

  it('escalates STALE severity to warn for a critical staleness signal', () => {
    const critical: StaleDealResult = { daysSince: 40, thresholdDays: 14, severity: 'critical' };
    const result = getNextStepNudge(
      { kanbanColumn: 'ENGAGED', createdAt: OLD_ENOUGH_CREATED_AT, contacts: [FRESH_CONTACT] },
      critical,
      NOW
    );
    expect(result).toMatchObject({ id: 'STALE', severity: 'warn' });
  });

  it('clears the nudge when any one of multiple contacts is a fresh decision maker', () => {
    const result = getNextStepNudge(
      {
        kanbanColumn: 'ENGAGED',
        createdAt: OLD_ENOUGH_CREATED_AT,
        contacts: [
          { name: 'Not DM', isDecisionMaker: false },
          FRESH_CONTACT,
          { name: 'Also DM', isDecisionMaker: true, lastVerifiedAt: new Date(NOW.getTime() - 365 * 86_400_000).toISOString() },
        ],
      },
      null,
      NOW
    );
    // getDecisionMakerContact returns the FIRST flagged contact — FRESH_CONTACT here — so no nudge fires.
    expect(result).toBeNull();
  });

  it('never throws on a malformed lead shape, degrading to null', () => {
    expect(() => getNextStepNudge({ kanbanColumn: 'ENGAGED', contacts: 'not-an-array' as any }, null, NOW)).not.toThrow();
    const result = getNextStepNudge({ kanbanColumn: 'ENGAGED', contacts: 'not-an-array' as any }, null, NOW);
    expect(result?.id).toBe('NO_CONTACTS');
  });

  it('never throws on a malformed staleness object, degrading to null', () => {
    expect(() =>
      getNextStepNudge(
        { kanbanColumn: 'ENGAGED', createdAt: OLD_ENOUGH_CREATED_AT, contacts: [FRESH_CONTACT] },
        { daysSince: 'oops' } as any,
        NOW
      )
    ).not.toThrow();
  });

  it('treats an explicit null staleness signal as no staleness (not a crash)', () => {
    const result = getNextStepNudge(
      { kanbanColumn: 'ENGAGED', createdAt: OLD_ENOUGH_CREATED_AT, contacts: [FRESH_CONTACT] },
      null,
      NOW
    );
    expect(result).toBeNull();
  });
});
