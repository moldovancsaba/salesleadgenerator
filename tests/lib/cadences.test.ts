import { describe, it, expect } from 'vitest';
import {
  sanitizeCadenceStep, sanitizeCadenceSteps, sanitizeCadence, validateCadence,
  computeStepDueAt, buildInitialActiveCadence, advanceActiveCadence,
} from '../../lib/cadences';

const NOW = new Date('2026-07-31T00:00:00.000Z');

describe('sanitizeCadenceStep', () => {
  it('returns null for a missing/invalid channel', () => {
    expect(sanitizeCadenceStep({})).toBeNull();
    expect(sanitizeCadenceStep({ channel: 'sms' })).toBeNull();
  });

  it('returns null for a non-object input', () => {
    expect(sanitizeCadenceStep(null)).toBeNull();
    expect(sanitizeCadenceStep(undefined)).toBeNull();
  });

  it('accepts email, linkedin, and call channels', () => {
    expect(sanitizeCadenceStep({ channel: 'email' })?.channel).toBe('email');
    expect(sanitizeCadenceStep({ channel: 'linkedin' })?.channel).toBe('linkedin');
    expect(sanitizeCadenceStep({ channel: 'call' })?.channel).toBe('call');
  });

  it('defaults waitDaysAfterPrevious to 0 for missing/invalid values', () => {
    expect(sanitizeCadenceStep({ channel: 'email' })?.waitDaysAfterPrevious).toBe(0);
    expect(sanitizeCadenceStep({ channel: 'email', waitDaysAfterPrevious: -3 })?.waitDaysAfterPrevious).toBe(0);
    expect(sanitizeCadenceStep({ channel: 'email', waitDaysAfterPrevious: 'nope' })?.waitDaysAfterPrevious).toBe(0);
  });

  it('rounds and caps waitDaysAfterPrevious at 365', () => {
    expect(sanitizeCadenceStep({ channel: 'email', waitDaysAfterPrevious: 3.6 })?.waitDaysAfterPrevious).toBe(4);
    expect(sanitizeCadenceStep({ channel: 'email', waitDaysAfterPrevious: 9000 })?.waitDaysAfterPrevious).toBe(365);
  });

  it('honors an explicit 0 (due immediately on enrollment), not forcing a special case', () => {
    expect(sanitizeCadenceStep({ channel: 'email', waitDaysAfterPrevious: 0 })?.waitDaysAfterPrevious).toBe(0);
  });

  it('trims templateId and omits it when blank', () => {
    expect(sanitizeCadenceStep({ channel: 'email', templateId: '  tpl-1  ' })?.templateId).toBe('tpl-1');
    expect(sanitizeCadenceStep({ channel: 'call', templateId: '   ' })?.templateId).toBeUndefined();
  });

  it('trims and caps reminderNote length', () => {
    const long = 'x'.repeat(600);
    expect(sanitizeCadenceStep({ channel: 'call', reminderNote: `  ${long}  ` })?.reminderNote?.length).toBe(500);
  });

  it('generates an id when none is provided, preserves one when it is', () => {
    expect(sanitizeCadenceStep({ channel: 'call' })?.id).toBeTruthy();
    expect(sanitizeCadenceStep({ channel: 'call', id: 'step_fixed' })?.id).toBe('step_fixed');
  });
});

describe('sanitizeCadenceSteps', () => {
  it('returns an empty array for non-array input', () => {
    expect(sanitizeCadenceSteps(undefined)).toEqual([]);
    expect(sanitizeCadenceSteps('not an array')).toEqual([]);
  });

  it('drops invalid entries without rejecting the whole array', () => {
    const steps = sanitizeCadenceSteps([{ channel: 'email' }, { channel: 'sms' }, { channel: 'call' }]);
    expect(steps).toHaveLength(2);
    expect(steps.map((s) => s.channel)).toEqual(['email', 'call']);
  });

  it('caps at 20 steps', () => {
    const input = Array.from({ length: 30 }, () => ({ channel: 'email' }));
    expect(sanitizeCadenceSteps(input)).toHaveLength(20);
  });
});

describe('sanitizeCadence', () => {
  it('produces a new cadence with matching createdAt/updatedAt when no existing record is given', () => {
    const cadence = sanitizeCadence({ name: 'Outbound v1', steps: [{ channel: 'email' }] }, 'cogmap', 'default', null, NOW);
    expect(cadence.id).toBe('');
    expect(cadence.brand).toBe('cogmap');
    expect(cadence.tenantId).toBe('default');
    expect(cadence.name).toBe('Outbound v1');
    expect(cadence.enabled).toBe(false);
    expect(cadence.createdAt).toBe(NOW.toISOString());
    expect(cadence.updatedAt).toBe(NOW.toISOString());
  });

  it('preserves id/createdAt and only refreshes updatedAt when editing an existing cadence', () => {
    const later = new Date(NOW.getTime() + 86_400_000);
    const cadence = sanitizeCadence(
      { name: 'Renamed', steps: [{ channel: 'call' }] },
      'seyu', 'default',
      { id: 'abc123', createdAt: NOW.toISOString() },
      later
    );
    expect(cadence.id).toBe('abc123');
    expect(cadence.createdAt).toBe(NOW.toISOString());
    expect(cadence.updatedAt).toBe(later.toISOString());
  });

  it('trims and caps name length', () => {
    const cadence = sanitizeCadence({ name: `  ${'x'.repeat(250)}  `, steps: [] }, 'cogmap', 'default', null, NOW);
    expect(cadence.name.length).toBe(200);
  });

  it('defaults enabled to false unless explicitly true', () => {
    expect(sanitizeCadence({ name: 'A', steps: [], enabled: 'yes' }, 'cogmap', 'default', null, NOW).enabled).toBe(false);
    expect(sanitizeCadence({ name: 'A', steps: [], enabled: true }, 'cogmap', 'default', null, NOW).enabled).toBe(true);
  });
});

describe('validateCadence', () => {
  it('requires a non-empty name', () => {
    const errors = validateCadence({ name: '', steps: [{ id: '1', channel: 'email', waitDaysAfterPrevious: 0 }] });
    expect(errors).toContain('name is required');
  });

  it('requires at least one step', () => {
    const errors = validateCadence({ name: 'Cadence', steps: [] });
    expect(errors).toContain('at least one step is required');
  });

  it('passes with a name and at least one step', () => {
    const errors = validateCadence({ name: 'Cadence', steps: [{ id: '1', channel: 'call', waitDaysAfterPrevious: 0 }] });
    expect(errors).toEqual([]);
  });

  it('rejects an email step with no templateId, reporting its 1-based index', () => {
    const errors = validateCadence({
      name: 'Cadence',
      steps: [{ id: '1', channel: 'email', waitDaysAfterPrevious: 0 }],
    });
    expect(errors).toContain('step 1 (email): templateId is required');
  });

  it('passes an email step that has a templateId', () => {
    const errors = validateCadence({
      name: 'Cadence',
      steps: [{ id: '1', channel: 'email', waitDaysAfterPrevious: 0, templateId: 'tpl-1' }],
    });
    expect(errors).toEqual([]);
  });

  it('does not require a templateId for linkedin/call steps', () => {
    const errors = validateCadence({
      name: 'Cadence',
      steps: [
        { id: '1', channel: 'linkedin', waitDaysAfterPrevious: 0 },
        { id: '2', channel: 'call', waitDaysAfterPrevious: 1 },
      ],
    });
    expect(errors).toEqual([]);
  });
});

describe('computeStepDueAt', () => {
  it('returns the same instant for a 0-day wait', () => {
    expect(computeStepDueAt(0, NOW)).toBe(NOW.toISOString());
  });

  it('adds the correct number of days', () => {
    expect(computeStepDueAt(3, NOW)).toBe(new Date(NOW.getTime() + 3 * 86_400_000).toISOString());
  });
});

describe('buildInitialActiveCadence', () => {
  it('returns null for a cadence with no steps', () => {
    expect(buildInitialActiveCadence({ id: 'c1', steps: [] }, NOW)).toBeNull();
  });

  it('starts at step 0 and computes stepDueAt from the first step\'s own wait', () => {
    const active = buildInitialActiveCadence(
      { id: 'c1', steps: [{ id: 's1', channel: 'email', waitDaysAfterPrevious: 2 }] },
      NOW
    );
    expect(active?.cadenceId).toBe('c1');
    expect(active?.currentStepIndex).toBe(0);
    expect(active?.stepDueAt).toBe(new Date(NOW.getTime() + 2 * 86_400_000).toISOString());
    expect(active?.enrolledAt).toBe(NOW.toISOString());
  });

  it('honors a first step with 0 wait as due immediately', () => {
    const active = buildInitialActiveCadence(
      { id: 'c1', steps: [{ id: 's1', channel: 'email', waitDaysAfterPrevious: 0 }] },
      NOW
    );
    expect(active?.stepDueAt).toBe(NOW.toISOString());
  });
});

describe('advanceActiveCadence', () => {
  const cadence = {
    id: 'c1',
    steps: [
      { id: 's1', channel: 'email' as const, waitDaysAfterPrevious: 0 },
      { id: 's2', channel: 'linkedin' as const, waitDaysAfterPrevious: 3 },
      { id: 's3', channel: 'call' as const, waitDaysAfterPrevious: 5 },
    ],
  };

  it('advances to the next step and recomputes stepDueAt from now', () => {
    const active = buildInitialActiveCadence(cadence, NOW)!;
    const advanced = advanceActiveCadence(cadence, active, NOW);
    expect(advanced?.currentStepIndex).toBe(1);
    expect(advanced?.stepDueAt).toBe(new Date(NOW.getTime() + 3 * 86_400_000).toISOString());
    expect(advanced?.enrolledAt).toBe(active.enrolledAt);
  });

  it('returns null when the current step is the last one (cadence complete)', () => {
    const lastStepActive = { cadenceId: 'c1', currentStepIndex: 2, stepDueAt: NOW.toISOString(), enrolledAt: NOW.toISOString() };
    expect(advanceActiveCadence(cadence, lastStepActive, NOW)).toBeNull();
  });

  it('preserves enrolledAt across multiple advances', () => {
    let active = buildInitialActiveCadence(cadence, NOW)!;
    active = advanceActiveCadence(cadence, active, NOW)!;
    active = advanceActiveCadence(cadence, active, NOW)!;
    expect(active.currentStepIndex).toBe(2);
    expect(active.enrolledAt).toBe(NOW.toISOString());
  });
});
