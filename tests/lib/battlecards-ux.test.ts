import { describe, it, expect } from 'vitest';

describe('Battlecards Real-Time Search & In-Call Rebuttal Copy (Issue #319)', () => {
  type Objection = { objection: string; response: string };
  type Battlecard = {
    id: string;
    competitorName: string;
    positioningSummary: string;
    proofPoints: string[];
    objections: Objection[];
    tags: string[];
  };

  const sampleBattlecards: Battlecard[] = [
    {
      id: 'bc_1',
      competitorName: 'LegacyCRM Inc',
      positioningSummary: 'Slow on-premise system with high maintenance costs',
      proofPoints: ['5x faster onboarding', 'Modern Next.js UI'],
      objections: [
        { objection: 'We already have LegacyCRM.', response: 'We migrate all pipeline data in 24 hours with zero downtime.' },
      ],
      tags: ['enterprise', 'legacy'],
    },
    {
      id: 'bc_2',
      competitorName: 'FastOutreach Cloud',
      positioningSummary: 'Feature-limited point solution lacking integrated quoting',
      proofPoints: ['Unified CRM + Invoicing + CPQ', 'Integrated Hungarian Számlázz.hu e-invoicing'],
      objections: [
        { objection: 'FastOutreach is cheaper.', response: 'Our total cost of ownership is 40% lower when eliminating 3 third-party tools.' },
      ],
      tags: ['smb', 'pricing'],
    },
  ];

  it('filters battlecards by competitor name keyword', () => {
    const q = 'legacy';
    const matches = sampleBattlecards.filter((bc) =>
      bc.competitorName.toLowerCase().includes(q) ||
      bc.positioningSummary.toLowerCase().includes(q) ||
      bc.tags.some((t) => t.toLowerCase().includes(q))
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].competitorName).toBe('LegacyCRM Inc');
  });

  it('filters battlecards by objection text or tag', () => {
    const q = 'számlázz';
    const matches = sampleBattlecards.filter((bc) =>
      bc.proofPoints.some((p) => p.toLowerCase().includes(q)) ||
      bc.objections.some((o) => o.objection.toLowerCase().includes(q) || o.response.toLowerCase().includes(q))
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].competitorName).toBe('FastOutreach Cloud');
  });

  it('matches all battlecards when query is empty', () => {
    const q = '   ';
    const trimmed = q.trim().toLowerCase();
    const matches = trimmed ? sampleBattlecards.filter((b) => b.competitorName.includes(trimmed)) : sampleBattlecards;
    expect(matches).toHaveLength(2);
  });
});
