import type { OutreachTemplate } from './templates';

export const DEFAULT_TEMPLATES: OutreachTemplate[] = [
  {
    id: 'cogmap-soccer-academy-email',
    name: 'CogMap — Soccer Academy Intro',
    channel: 'email',
    industry: 'Soccer',
    subject: 'Cognitive performance insights for {entity_name}',
    body: `Hi {decision_maker_name},

I wanted to reach out because CogMap is already helping academies like yours measure the cognitive skills that separate good players from elite performers.

For {entity_name}, I see real potential in using our assessment + live second-screen feedback to give coaches and players actionable insight during training and matches — not just post-session reports.

Would you be open to a short call to see how this could fit your academy program?

Best,`,
    variables: ['entity_name', 'decision_maker_name', 'value_proposition', 'sport_or_sector'],
  },
  {
    id: 'cogmap-federation-email',
    name: 'CogMap — Federation Partnership',
    channel: 'email',
    industry: 'Federation',
    subject: 'National federation cognitive assessment rollout',
    body: `Hi {decision_maker_name},

National federations need a scalable way to embed cognitive assessment across clubs and age groups. CogMap gives you a single platform for baseline testing, longitudinal tracking, and coach-ready reporting — without adding operational overhead.

I think {entity_name} could pilot this across your existing structure and show measurable gains within one season.

Best,`,
    variables: ['entity_name', 'decision_maker_name', 'value_proposition'],
  },
  {
    id: 'cogmap-club-email',
    name: 'CogMap — Club Performance Program',
    channel: 'email',
    industry: 'Club',
    subject: 'Performance insight for {entity_name}',
    body: `Hi {decision_maker_name},

Performance isn't just physical. CogMap gives your athletes and coaches a cognitive performance layer — decision speed, working memory, and situational awareness — with live feedback during sessions via a second-screen experience.

I'd love to show you how {entity_name} can integrate this into what you're already doing.

Best,`,
    variables: ['entity_name', 'decision_maker_name', 'value_proposition'],
  },
  {
    id: 'cogmap-club-linkedin',
    name: 'CogMap — Club LinkedIn Connection',
    channel: 'linkedin',
    industry: 'Club',
    body: `Hi {decision_maker_name}, I came across {entity_name} and was impressed by your work. CogMap helps clubs measure decision-making speed, situational awareness, and working memory under pressure — paired with a live second-screen experience during training. Would love to connect and share how it could apply to your program.`,
    variables: ['entity_name', 'decision_maker_name', 'value_proposition'],
  },
];
