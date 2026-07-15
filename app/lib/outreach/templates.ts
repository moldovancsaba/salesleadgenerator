export type OutreachTemplate = {
  id: string;
  name: string;
  channel: 'email' | 'linkedin';
  industry: string;
  subject?: string;
  body: string;
  variables: string[];
};

export const DEFAULT_TEMPLATES: OutreachTemplate[] = [
  {
    id: 'soccer-academy-email',
    name: 'Soccer Academy — Cognitive Assessment Intro',
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
    id: 'soccer-academy-linkedin',
    name: 'Soccer Academy — LinkedIn Connection',
    channel: 'linkedin',
    industry: 'Soccer',
    body: `Hi {decision_maker_name}, I came across {entity_name} and was impressed by your work. CogMap helps soccer academies measure decision-making speed, situational awareness, and working memory under pressure — paired with a live second-screen experience during training. Would love to connect and share how it could apply to your program.`,
    variables: ['entity_name', 'decision_maker_name', 'value_proposition'],
  },
  {
    id: 'performance-center-email',
    name: 'Performance Center — Cognitive Performance',
    channel: 'email',
    subject: 'Performance insight for {entity_name}',
    body: `Hi {decision_maker_name},

Performance isn’t just physical. CogMap gives your athletes and coaches a cognitive performance layer — decision speed, working memory, and situational awareness — with live feedback during sessions via a second-screen experience.

I’d love to show you how {entity_name} can integrate this into what you’re already doing.

Best,`,
    variables: ['entity_name', 'decision_maker_name', 'value_proposition'],
  },
];

export function interpolate(template: string, lead: Record<string, any>): string {
  return Object.entries(lead).reduce((text, [key, value]) => {
    const safeValue = typeof value === 'string' ? value : String(value ?? '');
    return text.replace(new RegExp(`\\{${key}\\}`, 'g'), safeValue);
  }, template);
}
