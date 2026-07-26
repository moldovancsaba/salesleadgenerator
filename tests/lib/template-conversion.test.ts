import { describe, it, expect } from 'vitest';
import { computeTemplateConversions } from '../../lib/template-conversion';

const day = (n: number) => new Date(2026, 0, n);

describe('computeTemplateConversions', () => {
  it('attributes a WON outcome to the last-touch template within the window', () => {
    const outreach = [
      { leadId: 'L1', templateId: 'T1', createdAt: day(1) },
      { leadId: 'L1', templateId: 'T2', createdAt: day(5) },
    ];
    const outcomes = [
      { leadId: 'L1', afterState: { kanbanColumn: 'ENGAGED' }, createdAt: day(3) },
      { leadId: 'L1', afterState: { kanbanColumn: 'WON' }, createdAt: day(10) },
    ];
    const stats = computeTemplateConversions(outreach, outcomes, 90);
    expect(stats.get('T1')).toEqual({ sent: 1, won: 0, lost: 0, conversionRate: 0, declineRate: 0 });
    expect(stats.get('T2')).toEqual({ sent: 1, won: 1, lost: 0, conversionRate: 1, declineRate: 0 });
  });

  it('attributes a LOST outcome symmetrically', () => {
    const outreach = [{ leadId: 'L1', templateId: 'T1', createdAt: day(1) }];
    const outcomes = [{ leadId: 'L1', afterState: { kanbanColumn: 'LOST' }, createdAt: day(2) }];
    const stats = computeTemplateConversions(outreach, outcomes, 90);
    expect(stats.get('T1')).toEqual({ sent: 1, won: 0, lost: 1, conversionRate: 0, declineRate: 1 });
  });

  it('counts a send toward sent but not conversion when no outcome exists yet', () => {
    const outreach = [{ leadId: 'L1', templateId: 'T1', createdAt: day(1) }];
    const stats = computeTemplateConversions(outreach, [], 90);
    expect(stats.get('T1')).toEqual({ sent: 1, won: 0, lost: 0, conversionRate: 0, declineRate: 0 });
  });

  it('does not attribute an outcome outside the attribution window', () => {
    const outreach = [{ leadId: 'L1', templateId: 'T1', createdAt: day(1) }];
    const outcomes = [{ leadId: 'L1', afterState: { kanbanColumn: 'WON' }, createdAt: day(1) }];
    // day(1) + 200 days later, well past a 90-day window
    const farOutcome = [{ leadId: 'L1', afterState: { kanbanColumn: 'WON' }, createdAt: new Date(day(1).getTime() + 200 * 86400000) }];
    const stats = computeTemplateConversions(outreach, farOutcome, 90);
    expect(stats.get('T1')).toEqual({ sent: 1, won: 0, lost: 0, conversionRate: 0, declineRate: 0 });
    // sanity: within-window case from the same fixture still attributes
    const statsInWindow = computeTemplateConversions(outreach, outcomes, 90);
    expect(statsInWindow.get('T1')?.won).toBe(1);
  });

  it('uses the earliest terminal outcome as the lead\'s conversion event', () => {
    const outreach = [{ leadId: 'L1', templateId: 'T1', createdAt: day(1) }];
    const outcomes = [
      { leadId: 'L1', afterState: { kanbanColumn: 'WON' }, createdAt: day(5) },
      // A later, contradictory entry (e.g. re-opened) should not override the first terminal state
      { leadId: 'L1', afterState: { kanbanColumn: 'LOST' }, createdAt: day(20) },
    ];
    const stats = computeTemplateConversions(outreach, outcomes, 90);
    expect(stats.get('T1')?.won).toBe(1);
    expect(stats.get('T1')?.lost).toBe(0);
  });

  it('ignores sends after the terminal outcome when picking the last touch', () => {
    const outreach = [
      { leadId: 'L1', templateId: 'T1', createdAt: day(1) },
      // Sent after the lead already converted — should not be eligible for attribution
      { leadId: 'L1', templateId: 'T2', createdAt: day(15) },
    ];
    const outcomes = [{ leadId: 'L1', afterState: { kanbanColumn: 'WON' }, createdAt: day(10) }];
    const stats = computeTemplateConversions(outreach, outcomes, 90);
    expect(stats.get('T1')?.won).toBe(1);
    expect(stats.get('T2')?.won).toBe(0);
    expect(stats.get('T2')?.sent).toBe(1);
  });

  it('handles multiple leads independently across shared templates', () => {
    const outreach = [
      { leadId: 'L1', templateId: 'T1', createdAt: day(1) },
      { leadId: 'L2', templateId: 'T1', createdAt: day(1) },
    ];
    const outcomes = [
      { leadId: 'L1', afterState: { kanbanColumn: 'WON' }, createdAt: day(2) },
      { leadId: 'L2', afterState: { kanbanColumn: 'LOST' }, createdAt: day(2) },
    ];
    const stats = computeTemplateConversions(outreach, outcomes, 90);
    expect(stats.get('T1')).toEqual({ sent: 2, won: 1, lost: 1, conversionRate: 0.5, declineRate: 0.5 });
  });

  it('ignores outreach logs with no templateId', () => {
    const outreach = [{ leadId: 'L1', templateId: undefined, createdAt: day(1) }];
    const stats = computeTemplateConversions(outreach, [], 90);
    expect(stats.size).toBe(0);
  });
});
