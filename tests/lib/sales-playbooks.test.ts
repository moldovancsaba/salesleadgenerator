import { describe, it, expect } from 'vitest';
import {
  getStageGuidance,
  DISCOVERY_PLAYBOOKS,
  compilePlaybookSubmission,
} from '../../lib/sales-playbooks';

describe('getStageGuidance (issue 278)', () => {
  it('returns structured guidance for canonical stages', () => {
    const disc = getStageGuidance('DISCOVERED');
    expect(disc.stage).toBe('DISCOVERED');
    expect(disc.exitCriteria.length).toBeGreaterThan(0);

    const prop = getStageGuidance('PROPOSAL');
    expect(prop.objective).toContain('CPQ quote');
  });

  it('falls back cleanly for custom stages', () => {
    const custom = getStageGuidance('CUSTOM_NEGOTIATION');
    expect(custom.stage).toBe('CUSTOM_NEGOTIATION');
    expect(custom.exitCriteria.length).toBeGreaterThan(0);
  });
});

describe('compilePlaybookSubmission (issue 278)', () => {
  it('compiles answers into formatted notes, qualification patch, and deduplicated checklist items', () => {
    const bant = DISCOVERY_PLAYBOOKS.find((p) => p.id === 'bant')!;
    const res = compilePlaybookSubmission(
      bant,
      {
        budget: '€35k approved for 2026 season',
        authority: 'Commercial Director signs',
        need: 'Fan engagement on matchdays',
        timeline: 'Q3 Kickoff',
      },
      { budgetConfirmed: false, authorityConfirmed: false },
      [{ id: 'c1', text: 'Existing item', done: false }]
    );

    expect(res.formattedNote).toContain('[Discovery Playbook: BANT Qualification Playbook]');
    expect(res.formattedNote).toContain('€35k approved for 2026 season');
    expect(res.qualificationPatch).toEqual({
      budgetConfirmed: true,
      budgetNotes: '€35k approved for 2026 season',
      authorityConfirmed: true,
      needNotes: 'Fan engagement on matchdays',
      timelineEstimate: 'Q3 Kickoff',
    });
    expect(res.newChecklistItems.length).toBe(3);
  });
});
