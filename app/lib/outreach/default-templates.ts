export type OutreachTemplate = {
  id: string;
  name: string;
  channel: 'email' | 'linkedin';
  industry: string;
  subject?: string;
  body: string;
  variables: string[];
};

export const DEFAULT_OUTREACH_TEMPLATES: OutreachTemplate[] = [
  {
    id: 'academy-email-intro',
    name: 'Academy — Cognitive Assessment Intro',
    channel: 'email',
    industry: 'Academy',
    subject: 'Cognitive performance insights for {entity_name}',
    body: `Hi {contact_name},

I wanted to reach out because we are already helping academies like yours measure the cognitive skills that separate good players from elite performers.

For {entity_name}, I see real potential in using our assessment + live second-screen feedback to give coaches and players actionable insight during training and matches — not just post-session reports.

Would you be open to a short call to see how this could fit your academy program?

Best,`,
    variables: ['entity_name', 'contact_name', 'value_proposition', 'sport_or_sector'],
  },
  {
    id: 'academy-linkedin-connect',
    name: 'Academy — LinkedIn Connection',
    channel: 'linkedin',
    industry: 'Academy',
    body: `Hi {contact_name}, I came across {entity_name} and was impressed by your work. We help academies measure decision-making speed, situational awareness, and working memory under pressure — paired with a live second-screen experience during training. Would love to connect and share how it could apply to your program.`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
  },
  {
    id: 'federation-email-intro',
    name: 'Federation — Program Overview',
    channel: 'email',
    industry: 'Federation',
    subject: 'Scaling cognitive assessment across {entity_name}',
    body: `Hi {contact_name},

Federations like {entity_name} have a unique challenge: delivering consistent performance insight across many clubs and age groups.

We provide a centralized cognitive assessment layer plus live second-screen feedback that scales from academy to first-team level.

If that sounds useful for your program, I’d love to walk you through it.

Best,`,
    variables: ['entity_name', 'contact_name', 'value_proposition', 'sport_or_sector'],
  },
  {
    id: 'club-email-intro',
    name: 'Club — Performance Conversation',
    channel: 'email',
    industry: 'Club',
    subject: 'Performance insight for {entity_name}',
    body: `Hi {contact_name},

Performance isn’t just physical. We give clubs like {entity_name} a cognitive performance layer — decision speed, working memory, and situational awareness — with live feedback during sessions via a second-screen experience.

I’d love to show you how this could integrate with what you’re already doing.

Best,`,
    variables: ['entity_name', 'contact_name', 'value_proposition', 'sport_or_sector'],
  },
  {
    id: 'club-linkedin-connect',
    name: 'Club — LinkedIn Connection',
    channel: 'linkedin',
    industry: 'Club',
    body: `Hi {contact_name}, I came across {entity_name} and was impressed by your work. We help clubs measure and improve the cognitive side of performance — decision-making, situational awareness, and working memory — using a live second-screen training experience. Would love to connect.`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
  },
];

export function interpolate(template: string, lead: Record<string, any>): string {
  return Object.entries(lead).reduce((text, [key, value]) => {
    const safeValue = typeof value === 'string' ? value : String(value ?? '');
    return text.replace(new RegExp(`\\{${key}\\}`, 'g'), safeValue);
  }, template);
}
