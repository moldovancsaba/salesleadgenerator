export type BattlecardObjection = {
  objection: string;
  response: string;
};

export type Battlecard = {
  id: string;
  competitorName: string;
  positioningSummary: string;
  proofPoints: string[];
  objections: BattlecardObjection[];
  // Same multi-valued classification shape as OutreachTemplate.tags (issue
  // #64) — reuses app/lib/search/tagged-content-filter.ts, not a second
  // tag system.
  tags?: string[];
};

// Deliberately brand-neutral (no CogMap/Seyu-specific competitor claims) so
// this same seed is safe to return regardless of which brand queries it
// when Mongo isn't configured — matches DEFAULT_OUTREACH_TEMPLATES's own
// brand-agnostic default set.
export const DEFAULT_BATTLECARDS: Battlecard[] = [
  {
    id: 'legacy-status-quo',
    competitorName: 'Status quo / no vendor',
    positioningSummary: 'Many prospects are not comparing us to a named competitor — they are comparing us to doing nothing. Position the cost of inaction, not a feature checklist.',
    proofPoints: [
      'Time-to-value is measured in weeks, not a multi-quarter rollout',
      'No long-term contract required to get started',
    ],
    objections: [
      {
        objection: "We're not actively looking to change anything right now.",
        response: 'Totally understand — most of our best customers weren\'t either. Would it be worth a short call just to see what a baseline could look like, no commitment either way?',
      },
      {
        objection: 'We don\'t have budget for this quarter.',
        response: 'Makes sense. Let\'s stay in touch — I can share what a pilot would look like so it\'s ready to move quickly whenever budget opens up.',
      },
    ],
    tags: ['objection-handling', 'no-budget'],
  },
];
