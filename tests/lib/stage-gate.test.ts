import { describe, it, expect } from 'vitest';
import { checkStageGate, formatStageGateError, isGatedColumn } from '../../lib/stage-gate';

describe('isGatedColumn', () => {
  it('gates ENGAGED and PROPOSAL only', () => {
    expect(isGatedColumn('ENGAGED')).toBe(true);
    expect(isGatedColumn('PROPOSAL')).toBe(true);
    expect(isGatedColumn('DISCOVERED')).toBe(false);
    expect(isGatedColumn('QUALIFIED')).toBe(false);
    expect(isGatedColumn('WON')).toBe(false);
    expect(isGatedColumn('LOST')).toBe(false);
  });
});

describe('checkStageGate', () => {
  it('allows a move into a non-gated column regardless of lead content', () => {
    const result = checkStageGate('DISCOVERED', {});
    expect(result).toEqual({ allowed: true, missing: [] });
  });

  it('blocks a move into ENGAGED missing both required fields', () => {
    const result = checkStageGate('ENGAGED', {});
    expect(result.allowed).toBe(false);
    expect(result.missing).toEqual(['a contact', 'a value proposition']);
  });

  it('blocks a move missing only the contact', () => {
    const result = checkStageGate('ENGAGED', { value_proposition: 'Cognitive performance training' });
    expect(result.allowed).toBe(false);
    expect(result.missing).toEqual(['a contact']);
  });

  it('blocks a move missing only the value proposition', () => {
    const result = checkStageGate('PROPOSAL', { contacts: [{ isDecisionMaker: true }] });
    expect(result.allowed).toBe(false);
    expect(result.missing).toEqual(['a value proposition']);
  });

  it('allows a move into ENGAGED when both required fields are present', () => {
    const result = checkStageGate('ENGAGED', {
      contacts: [{ isDecisionMaker: false }, { isDecisionMaker: true }],
      value_proposition: 'Cognitive performance training',
    });
    expect(result).toEqual({ allowed: true, missing: [] });
  });

  it('allows a move into PROPOSAL when both required fields are present', () => {
    const result = checkStageGate('PROPOSAL', {
      contacts: [{ isDecisionMaker: true }],
      value_proposition: 'Cognitive performance training',
    });
    expect(result.allowed).toBe(true);
  });

  it('treats an empty/whitespace-only value_proposition as missing', () => {
    const result = checkStageGate('ENGAGED', {
      contacts: [{ isDecisionMaker: true }],
      value_proposition: '   ',
    });
    expect(result.missing).toEqual(['a value proposition']);
  });

  // isDecisionMaker is no longer a gating condition (owner-requested) — any
  // contact at all satisfies this requirement, decision-maker or not.
  it('allows a move into ENGAGED with a contact that has no decision-maker flag set', () => {
    const result = checkStageGate('ENGAGED', {
      contacts: [{ isDecisionMaker: false }],
      value_proposition: 'Cognitive performance training',
    });
    expect(result).toEqual({ allowed: true, missing: [] });
  });

  it('treats an empty contacts array as missing', () => {
    const result = checkStageGate('ENGAGED', {
      contacts: [],
      value_proposition: 'Cognitive performance training',
    });
    expect(result.missing).toEqual(['a contact']);
  });

  // Issue #206 regression guard — buyingRole is a purely additive contact
  // classification; it must never re-couple this gate to any particular
  // contact role, the same "any contact satisfies it" behavior the
  // isDecisionMaker test above already locks in.
  it('is unaffected by buyingRole — any contact still satisfies the gate regardless of its role', () => {
    const blockerOnly = checkStageGate('ENGAGED', {
      contacts: [{ buyingRole: 'blocker', isDecisionMaker: false }],
      value_proposition: 'Cognitive performance training',
    });
    expect(blockerOnly).toEqual({ allowed: true, missing: [] });

    const unknownOnly = checkStageGate('PROPOSAL', {
      contacts: [{ buyingRole: 'unknown' }],
      value_proposition: 'Cognitive performance training',
    });
    expect(unknownOnly.allowed).toBe(true);
  });
});

describe('formatStageGateError', () => {
  it('formats a clear, directly usable error message', () => {
    expect(formatStageGateError('ENGAGED', ['a contact', 'a value proposition'])).toBe(
      'Missing required fields for ENGAGED: a contact, a value proposition'
    );
  });
});
