import type { OutreachTemplate } from './templates';

export const DEFAULT_TEMPLATES: OutreachTemplate[] = [
  {
    id: 'seyu-club-intro-email',
    name: 'Seyu — Club Fan-Experience Intro',
    channel: 'email',
    industry: 'Club',
    subject: 'A fan-intelligence layer for {entity_name}',
    body: `Hi {decision_maker_name},

Seyu is helping clubs turn matchday interactions into measurable, sponsor-ready activation — not just general attendance data.

For {entity_name}, I see a fit for a single fan-intelligence layer across touchpoints, with live insight that improves engagement without adding operational complexity.

Would you be open to a short call to see how this could fit your club program?

Best,`,
    variables: ['entity_name', 'decision_maker_name', 'value_proposition', 'sport_or_sector'],
  },
  {
    id: 'seyu-federation-email',
    name: 'Seyu — Federation League-Wide Rollout',
    channel: 'email',
    industry: 'Federation',
    subject: 'League-wide fan measurement for {entity_name}',
    body: `Hi {decision_maker_name},

National bodies and leagues need consistent, comparable fan insight across clubs and venues. Seyu offers one platform your member clubs can adopt without replacing their existing systems — and you get governance-ready reporting from day one.

I think {entity_name} could pilot this across a focused cohort and show measurable gains quickly.

Best,`,
    variables: ['entity_name', 'decision_maker_name', 'value_proposition'],
  },
  {
    id: 'seyu-club-linkedin',
    name: 'Seyu — Club LinkedIn Connection',
    channel: 'linkedin',
    industry: 'Club',
    body: `Hi {decision_maker_name}, I came across {entity_name} and was impressed by your work. Seyu helps clubs measure fan engagement, activation potential, and sponsorship readiness across matchday and digital touchpoints. Would love to connect and share how it could apply to your club.`,
    variables: ['entity_name', 'decision_maker_name', 'value_proposition'],
  },
];
