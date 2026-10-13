export type OutreachTemplate = {
  id: string;
  name: string;
  channel: 'email' | 'linkedin';
  industry: string;
  subject?: string;
  body: string;
  variables: string[];
  // Required merge fields that must be populated before send (issue #241).
  requiredFields?: string[];
  required_fields?: string[];
  // Free-form, multi-valued classification beyond `industry` — persona, deal
  // stage, competitor mention, etc. Same shape as Lead.tags (issue #64).
  tags?: string[];
  // Document library attachment references (issue #243).
  documentIds?: string[];
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
    variables: ['entity_name', 'contact_name', 'value_proposition'],
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
    variables: ['entity_name', 'contact_name', 'value_proposition'],
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
    variables: ['entity_name', 'contact_name', 'value_proposition'],
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
  if (!template) return '';
  // Support both direct lead fields and canonical/alias tokens (issue #241).
  const context: Record<string, string> = {};
  for (const [k, v] of Object.entries(lead)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      context[k.toLowerCase()] = String(v);
      context[k] = String(v);
    }
  }

  // Populate standard contact/company tokens if available
  if (lead.contacts && Array.isArray(lead.contacts)) {
    const dm = lead.contacts.find((c: any) => c && c.isDecisionMaker === true) || lead.contacts[0];
    if (dm) {
      if (!context.contact_name && dm.name) context.contact_name = dm.name;
      if (!context.first_name && dm.firstName) context.first_name = dm.firstName;
      if (!context.last_name && dm.lastName) context.last_name = dm.lastName;
      if (!context.email && dm.email) context.email = dm.email;
      if (!context.job_title && (dm.title || dm.role)) context.job_title = dm.title || dm.role;
    }
  }

  // Derive first/last name from contact_name if still missing
  if (context.contact_name && (!context.first_name || !context.last_name)) {
    const parts = context.contact_name.trim().split(/\s+/);
    if (!context.first_name && parts[0]) context.first_name = parts[0];
    if (!context.last_name && parts.length > 1) context.last_name = parts.slice(1).join(' ');
  }

  if (lead.entity_name && !context.company_name) context.company_name = lead.entity_name;
  if (lead.company && !context.company_name) context.company_name = lead.company;

  // First pass: replace {token}, {{token}}, {{.token}} using canonical rules
  const tokenRegex = /(?:\{\{\.([a-zA-Z0-9_.-]+)\}\}|\{\{([a-zA-Z0-9_.-]+)\}\}|\{([a-zA-Z0-9_.-]+)\})/g;
  let text = template.replace(tokenRegex, (match, goToken, dblToken, sglToken) => {
    const rawToken = goToken || dblToken || sglToken;
    if (!rawToken) return match;
    const lower = rawToken.trim().toLowerCase();
    if (context[lower] !== undefined && context[lower] !== '') return context[lower];
    if (context[rawToken] !== undefined && context[rawToken] !== '') return context[rawToken];
    return match;
  });

  // Second pass: fallback for any remaining exact {key} matches in lead
  for (const [key, value] of Object.entries(lead)) {
    const safeValue = typeof value === 'string' ? value : String(value ?? '');
    text = text.replace(new RegExp(`\\{${key}\\}`, 'g'), safeValue);
  }

  return text;
}

