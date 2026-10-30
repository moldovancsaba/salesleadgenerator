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
  // Brand partitioning (issue #249) — prevents cross-brand template bleed.
  brand?: string;
};

export const DEFAULT_OUTREACH_TEMPLATES: OutreachTemplate[] = [
  // --- CogMap Cognitive Assessment Templates ---
  {
    id: 'academy-email-intro',
    name: 'Academy — Cognitive Assessment Intro',
    brand: 'cogmap',
    channel: 'email',
    industry: 'Academy',
    subject: 'Cognitive performance insights for {entity_name}',
    body: `Hi {contact_name},

I wanted to reach out because we are already helping academies like yours measure the cognitive skills that separate good players from elite performers.

For {entity_name}, I see real potential in using our assessment + live second-screen feedback to give coaches and players actionable insight during training and matches — not just post-session reports.

Would you be open to a short call to see how this could fit your academy program?

Best,`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['academy', 'cognitive', 'assessment', 'performance'],
  },
  {
    id: 'academy-linkedin-connect',
    name: 'Academy — LinkedIn Connection',
    brand: 'cogmap',
    channel: 'linkedin',
    industry: 'Academy',
    body: `Hi {contact_name}, I came across {entity_name} and was impressed by your work. We help academies measure decision-making speed, situational awareness, and working memory under pressure — paired with a live second-screen experience during training. Would love to connect and share how it could apply to your program.`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['academy', 'cognitive', 'assessment'],
  },
  {
    id: 'federation-email-intro',
    name: 'Federation — Program Overview',
    brand: 'cogmap',
    channel: 'email',
    industry: 'Federation',
    subject: 'Scaling cognitive assessment across {entity_name}',
    body: `Hi {contact_name},

Federations like {entity_name} have a unique challenge: delivering consistent performance insight across many clubs and age groups.

We provide a centralized cognitive assessment layer plus live second-screen feedback that scales from academy to first-team level.

If that sounds useful for your program, I’d love to walk you through it.

Best,`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['federation', 'cognitive', 'assessment'],
  },
  {
    id: 'club-email-intro',
    name: 'Club — Performance Conversation',
    brand: 'cogmap',
    channel: 'email',
    industry: 'Club',
    subject: 'Performance insight for {entity_name}',
    body: `Hi {contact_name},

Performance isn’t just physical. We give clubs like {entity_name} a cognitive performance layer — decision speed, working memory, and situational awareness — with live feedback during sessions via a second-screen experience.

I’d love to show you how this could integrate with what you’re already doing.

Best,`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['club', 'cognitive', 'performance'],
  },
  {
    id: 'club-linkedin-connect',
    name: 'Club — LinkedIn Connection',
    brand: 'cogmap',
    channel: 'linkedin',
    industry: 'Club',
    body: `Hi {contact_name}, I came across {entity_name} and was impressed by your work. We help clubs measure and improve the cognitive side of performance — decision-making, situational awareness, and working memory — using a live second-screen training experience. Would love to connect.`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['club', 'cognitive', 'performance'],
  },

  // --- Seyu Fan Engagement & Stadium Activation Templates ---
  {
    id: 'seyu-club-fan-engagement',
    name: 'Club — Matchday Fan Engagement',
    brand: 'seyu',
    channel: 'email',
    industry: 'Club',
    subject: 'Boosting fan engagement & partner revenue at {entity_name}',
    body: `Hi {contact_name},

I wanted to reach out because we help sports clubs and arenas amplify matchday excitement by putting real-time fan selfies on stadium big screens and digital LED boards.

For {entity_name}, our fan engagement platform turns every match into an interactive branded experience that generates high-value inventory for sponsors while capturing authenticated fan data.

Would you be open to a quick call to explore how this could drive fan engagement and sponsorship value for {entity_name}?

Best,`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['fan_engagement', 'stadium', 'sponsorship', 'club'],
  },
  {
    id: 'seyu-arena-sponsorship-activation',
    name: 'Arena & Club — Sponsored Fan Moments',
    brand: 'seyu',
    channel: 'email',
    industry: 'Arena',
    subject: 'New commercial inventory for {entity_name} partners',
    body: `Hi {contact_name},

Leading venues and clubs use Seyu to monetize fan moments by connecting in-venue LED boards and live broadcasts with branded fan celebrations.

For {entity_name}, this delivers a measurable, premium sponsorship activation channel that partners love — driving engagement both in the arena and across social channels.

Could we schedule a 15-minute intro to share a few case studies from similar partner activations?

Best,`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['sponsorship', 'commercial', 'arena', 'activation'],
  },
  {
    id: 'seyu-linkedin-connect',
    name: 'Club & Federation — LinkedIn Connect',
    brand: 'seyu',
    channel: 'linkedin',
    industry: 'Club',
    body: `Hi {contact_name}, I noticed your commercial and fan experience work at {entity_name}. We help clubs and venues monetize matchday fan engagement through branded stadium LED activations and social fan campaigns. Would love to connect and share some results.`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['fan_engagement', 'commercial', 'club'],
  },

  // --- DVSC Commercial Sponsorship & Hospitality Templates ---
  {
    id: 'dvsc-partner-sponsorship',
    name: 'Sponsorship — Commercial Partnership Intro',
    brand: 'dvsc',
    channel: 'email',
    industry: 'Corporate',
    subject: 'Partnership opportunity with DVSC for {entity_name}',
    body: `Hi {contact_name},

I’m reaching out on behalf of DVSC to explore commercial partnership opportunities tailored to {entity_name}.

As one of the region’s premier football clubs, DVSC offers high-visibility brand exposure across matchday stadium LED, digital broadcast, VIP hospitality, and regional fan community activations.

Would you be available for a short conversation this week to discuss how a partnership could support {entity_name}’s regional and national business objectives?

Best,`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['sponsorship', 'commercial', 'corporate', 'partner'],
  },
  {
    id: 'dvsc-hospitality-vip',
    name: 'Hospitality — VIP Matchday Experience',
    brand: 'dvsc',
    channel: 'email',
    industry: 'Corporate',
    subject: 'VIP Matchday Hospitality for {entity_name}',
    body: `Hi {contact_name},

We are pleased to introduce DVSC’s premium VIP hospitality packages for the upcoming season, designed specifically for corporate networking and client entertainment.

Nagyerdei Stadium provides private skyboxes and VIP club lounges tailored for hosting key clients and team events during major league matches.

Could we set up a brief chat to review hospitality options that fit {entity_name}’s schedule?

Best,`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['hospitality', 'vip', 'corporate', 'networking'],
  },
  {
    id: 'dvsc-linkedin-connect',
    name: 'Corporate — LinkedIn Connect',
    brand: 'dvsc',
    channel: 'linkedin',
    industry: 'Corporate',
    body: `Hi {contact_name}, I saw your work with {entity_name} and wanted to connect regarding DVSC commercial partnerships and regional corporate collaboration opportunities.`,
    variables: ['entity_name', 'contact_name', 'value_proposition'],
    tags: ['sponsorship', 'corporate'],
  },
  // --- Padel Africa Venue Outreach Templates (Issue #302) ---
  {
    id: 'padel-africa-saas-booking',
    name: 'Padel Club — WhatsApp Player Booking & Court SaaS',
    brand: 'padel-africa',
    channel: 'email',
    industry: 'Sports Facility',
    subject: 'Automating court bookings & player retention at {entity_name}',
    body: `Hi {contact_name},

I’m reaching out from Padel Africa. We work with leading padel facilities across the continent to replace manual WhatsApp phone booking with automated WhatsApp bot bookings and court management software.

For {entity_name}, our platform eliminates double-bookings, processes local mobile money and card payments, and fills off-peak court hours automatically.

Would you be open to a 10-minute demo to see how clubs in your region are growing their court utilization?

Best regards,`,
    variables: ['entity_name', 'contact_name', 'country', 'region'],
    tags: ['padel', 'saas', 'booking', 'whatsapp', 'automation'],
  },
  {
    id: 'padel-africa-court-expansion',
    name: 'Padel Club — Panoramic Court Installation & Pro Shop Wholesale',
    brand: 'padel-africa',
    channel: 'email',
    industry: 'Sports Facility',
    subject: 'Court expansion & equipment supply for {entity_name}',
    body: `Hi {contact_name},

As padel participation accelerates across Africa, clubs like {entity_name} have an incredible opportunity to expand court capacity and pro-shop margins.

Padel Africa provides turnkey panoramic padel court construction, premium turf installation, and direct wholesale pricing on rackets, balls, and court accessories.

Could we schedule a quick call this week to share our 2026 court specs and wholesale pricing catalog?

Best regards,`,
    variables: ['entity_name', 'contact_name', 'country'],
    tags: ['padel', 'courts', 'installation', 'equipment', 'wholesale'],
  },
  {
    id: 'padel-africa-whatsapp-quick',
    name: 'Padel Club — WhatsApp Quick Outreach',
    brand: 'padel-africa',
    channel: 'linkedin',
    industry: 'Sports Facility',
    body: `Hi {contact_name}, noticed your courts at {entity_name}. We help padel operators across Africa automate player bookings via WhatsApp and boost court occupancy. Would love to share how clubs in your area are doing it!`,
    variables: ['entity_name', 'contact_name'],
    tags: ['padel', 'whatsapp', 'quick-connect'],
  },
];

export function getDefaultOutreachTemplates(brand?: string): OutreachTemplate[] {
  if (!brand) return DEFAULT_OUTREACH_TEMPLATES;
  return DEFAULT_OUTREACH_TEMPLATES.filter((t) => !t.brand || t.brand === brand);
}

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

