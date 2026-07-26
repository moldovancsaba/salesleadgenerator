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
    expect(result.missing).toEqual(['a decision-maker contact', 'a value proposition']);
  });

  it('blocks a move missing only the decision-maker contact', () => {
    const result = checkStageGate('ENGAGED', { value_proposition: 'Cognitive performance training' });
    expect(result.allowed).toBe(false);
    expect(result.missing).toEqual(['a decision-maker contact']);
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

  it('treats a contacts array with no decision-maker as missing', () => {
    const result = checkStageGate('ENGAGED', {
      contacts: [{ isDecisionMaker: false }],
      value_proposition: 'Cognitive performance training',
    });
    expect(result.missing).toEqual(['a decision-maker contact']);
  });
});

describe('formatStageGateError', () => {
  it('formats a clear, directly usable error message', () => {
    expect(formatStageGateError('ENGAGED', ['a decision-maker contact', 'a value proposition'])).toBe(
      'Missing required fields for ENGAGED: a decision-maker contact, a value proposition'
    );
  });
});
