import { describe, it, expect } from 'vitest';
import { analyzeTranscript } from '../../lib/transcript-intelligence';

describe('analyzeTranscript (issue 281)', () => {
  const battlecards = [
    {
      id: 'bc1',
      competitorName: 'Hudl',
      positioningSummary: 'We offer live interactive fan & cognitive engagement beyond static video.',
      objections: [
        {
          objection: 'We already use Hudl for video analysis',
          response: 'We complement video analysis with real-time cognitive & fan activation.',
        },
      ],
    },
  ];

  it('detects competitor mentions, action items, budget/timeline signals, and sentiment', () => {
    const text = [
      'Great discovery call with the Commercial Director.',
      'They mentioned they are already using Hudl for team video.',
      'Their approved budget is €35,000 for the upcoming Q3 season opener.',
      'I will send the custom ROI deck and case study by Friday.',
      'They are excited to move forward with a pilot.',
    ].join(' ');

    const res = analyzeTranscript(text, battlecards);

    expect(res.matchedBattlecards).toHaveLength(1);
    expect(res.matchedBattlecards[0].competitorName).toBe('Hudl');
    expect(res.matchedBattlecards[0].topObjectionRebuttal?.response).toContain('complement video analysis');
    expect(res.actionItems.some((a) => a.includes('will send the custom ROI deck'))).toBe(true);
    expect(res.signals.some((s) => s.category === 'budget')).toBe(true);
    expect(res.signals.some((s) => s.category === 'timeline')).toBe(true);
    expect(res.sentiment).toBe('positive');
  });

  it('returns empty results cleanly on blank input', () => {
    const res = analyzeTranscript('   ', battlecards);
    expect(res.matchedBattlecards).toEqual([]);
    expect(res.actionItems).toEqual([]);
    expect(res.signals).toEqual([]);
    expect(res.sentiment).toBe('neutral');
  });
});
