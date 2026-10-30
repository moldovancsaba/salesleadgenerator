export interface LandingFeature {
  id: string;
  title: string;
  description: string;
  badge?: string;
  iconName: string;
}

export interface LandingValuePillar {
  title: string;
  lead: string;
  body: string;
  badge: string;
}

export interface LandingMetric {
  value: string;
  label: string;
  subtext: string;
}

export interface LandingWorkflowStep {
  step: string;
  title: string;
  description: string;
  deliverable: string;
}

export interface LandingPricingTier {
  id: string;
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  highlighted?: boolean;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
}

export interface LandingFaqItem {
  question: string;
  answer: string;
}

export interface LandingContent {
  meta: {
    title: string;
    description: string;
  };
  navigation: {
    brandName: string;
    links: Array<{ label: string; href: string }>;
    signInLabel: string;
    dashboardLabel: string;
    contactLabel: string;
    contactHref: string;
  };
  hero: {
    pillBadge: string;
    title: string;
    titleHighlight: string;
    subtitle: string;
    primaryCta: { label: string; href: string };
    secondaryCta: { label: string; href: string };
    dashboardCta: { label: string; href: string };
    trustBadges: string[];
  };
  metrics: LandingMetric[];
  valuePillars: {
    sectionBadge: string;
    sectionTitle: string;
    sectionSubtitle: string;
    pillars: LandingValuePillar[];
  };
  features: {
    sectionBadge: string;
    sectionTitle: string;
    sectionSubtitle: string;
    items: LandingFeature[];
  };
  workflow: {
    sectionBadge: string;
    sectionTitle: string;
    sectionSubtitle: string;
    steps: LandingWorkflowStep[];
  };
  pricing: {
    sectionBadge: string;
    sectionTitle: string;
    sectionSubtitle: string;
    tiers: LandingPricingTier[];
  };
  faq: {
    sectionBadge: string;
    sectionTitle: string;
    sectionSubtitle: string;
    items: LandingFaqItem[];
  };
  ctaBanner: {
    badge: string;
    title: string;
    subtitle: string;
    primaryCta: { label: string; href: string };
    secondaryCta: { label: string; href: string };
    contactEmail: string;
  };
  footer: {
    tagline: string;
    copyright: string;
    links: Array<{ label: string; href: string }>;
  };
}

export const LANDING_CONTENT: LandingContent = {
  meta: {
    title: "Sales Lead Generator — Multi-Tenant Sales Intelligence & CRM",
    description:
      "Enterprise sales intelligence, automated lead discovery, precision enrichment, and sovereign CRM pipeline execution across sports and corporate sponsorship brands.",
  },
  navigation: {
    brandName: "Sales Lead Generator",
    links: [
      { label: "Platform", href: "#features" },
      { label: "Workflow", href: "#workflow" },
      { label: "Pillars", href: "#pillars" },
      { label: "Pricing", href: "#pricing" },
      { label: "FAQ", href: "#faq" },
    ],
    signInLabel: "Sign in",
    dashboardLabel: "Go to Dashboard",
    contactLabel: "Contact for Quote",
    contactHref: "mailto:salesleadgenerator@haho.ai",
  },
  hero: {
    pillBadge: "Enterprise Sales Intelligence & CRM",
    title: "Turn raw prospect accounts into closed deals",
    titleHighlight: "with precision intelligence.",
    subtitle:
      "Sales Lead Generator is the multi-tenant sales execution engine for sports and commercial sales teams. Unify automated prospect discovery, contact enrichment, interactive CPQ quotes, and fail-closed personal mailbox sync in one sovereign surface.",
    primaryCta: {
      label: "Request Platform Quote",
      href: "mailto:salesleadgenerator@haho.ai?subject=Sales%20Lead%20Generator%20Platform%20Quote%20Request",
    },
    secondaryCta: {
      label: "Explore Features",
      href: "#features",
    },
    dashboardCta: {
      label: "Launch Sales Workspace",
      href: "/today",
    },
    trustBadges: [
      "Strict Mailbox Privacy Guard",
      "Google Workspace & Contacts OAuth",
      "HubSpot & Salesforce 2-Way Sync",
      "Multi-Brand Tenant Isolation",
    ],
  },
  metrics: [
    {
      value: "3,000+",
      label: "Verified Accounts",
      subtext: "Categorized sports & enterprise prospects with verified decision-makers",
    },
    {
      value: "100%",
      label: "Fail-Closed Mailbox Shield",
      subtext: "Personal inboxes isolate internal correspondence from CRM prospects",
    },
    {
      value: "4 CRM",
      label: "Integrations Supported",
      subtext: "Full import & export for HubSpot, Salesforce, Pipedrive, and Google Sheets",
    },
    {
      value: "< 24h",
      label: "Quote-to-Sign Cycle",
      subtext: "Public buyer CPQ proposal portal with legal electronic signatures",
    },
  ],
  valuePillars: {
    sectionBadge: "Why Sales Lead Generator",
    sectionTitle: "Built specifically for modern commercial sales teams",
    sectionSubtitle:
      "Generic CRMs create administrative friction and leak sensitive communications. Sales Lead Generator pairs automated discovery intelligence with strict privacy and decisive execution.",
    pillars: [
      {
        badge: "Data Sovereignty & Privacy",
        title: "Strict Mailbox Isolation by Default",
        lead: "Colleague messages and personal correspondence never leak into CRM timelines.",
        body: "Our fail-closed sync architecture ensures reps only see emails where they are direct participants. The built-in Data Minimization Filter suppresses private accounting and HR messages, while RFC 2822 threading chains customer conversations cleanly.",
      },
      {
        badge: "Commercial Revenue Operations",
        title: "Deal Sizing Bands & Weighted Forecasting",
        lead: "Calibrated revenue forecasts based on deal health and category weights.",
        body: "Move beyond wishful thinking with 5-tier forecast categories (Pipeline, Best Case, Commit, Closed, Omitted), engagement-weighted deal health scoring (0–100), and 6-bucket movement waterfall inspection (New, Advanced, Regressed, Slipped, Won, Lost).",
      },
      {
        badge: "Automated Lead Discovery",
        title: "Precision Sports & Enterprise Taxonomy",
        lead: "Continuous background discovery with 90%+ sportCode and buying role accuracy.",
        body: "Integrates with automated research agents to discover new sports clubs, federations, and corporate sponsors. Leads arrive normalized with verified domains, key decision-maker titles, and executive contact emails.",
      },
    ],
  },
  features: {
    sectionBadge: "Full-Stack Capabilities",
    sectionTitle: "Everything your sales team needs to execute daily",
    sectionSubtitle:
      "A complete sales workbench from prospect research to signed contracts.",
    items: [
      {
        id: "inbox",
        title: "Unified 3-Pane Communication Hub",
        description:
          "Manage email threads, log calls, record internal notes, and convert email participants into new leads and deals with 1 click.",
        badge: "Communication",
        iconName: "IconMail",
      },
      {
        id: "kanban",
        title: "Modern Kanban & Inline Table Views",
        description:
          "High-affordance cards with primary decision-maker avatars, urgency indicators, stage decision buttons, and instant table cell editing.",
        badge: "Pipeline",
        iconName: "IconLayoutKanban",
      },
      {
        id: "quotes",
        title: "CPQ Proposals & Buyer E-Signature",
        description:
          "Build multi-line itemized commercial proposals with automated pricing, PDF exports, and an unauthenticated public portal with legal e-signatures.",
        badge: "Closing",
        iconName: "IconFileCheck",
      },
      {
        id: "cadences",
        title: "Outreach Cadences & 50/50 A/B Testing",
        description:
          "Automate multi-touch email and task sequences with stop-on-reply protection, manual step gating, and variant performance lift analytics.",
        badge: "Outreach",
        iconName: "IconSend",
      },
      {
        id: "playbooks",
        title: "Sales Path & Discovery Playbooks",
        description:
          "Interactive stage steppers embedded with BANT, MEDDPICC, and Sports Activation frameworks to guide reps through qualification.",
        badge: "Enablement",
        iconName: "IconCompass",
      },
      {
        id: "transcripts",
        title: "Call Transcript Intelligence",
        description:
          "Automatically analyze meeting notes and call transcripts to extract competitor Battlecard landmines, agreed action items, and buying signals.",
        badge: "Intelligence",
        iconName: "IconSparkles",
      },
      {
        id: "scheduler",
        title: "Google Calendar Booking & Meet Auto-Provisioning",
        description:
          "Share personal or brand booking links with real-time slot checking, automatic Google Meet links, and assigned-rep calendar routing.",
        badge: "Scheduling",
        iconName: "IconCalendar",
      },
      {
        id: "splits",
        title: "Multi-Rep Opportunity Splits",
        description:
          "Distribute credit across co-owned opportunities with percentage splits that automatically adjust forecast quota attainment.",
        badge: "RevOps",
        iconName: "IconUsers",
      },
      {
        id: "crm-exchange",
        title: "Universal CRM Import & Export",
        description:
          "Two-way lead exchange supporting HubSpot, Salesforce, Pipedrive, and Google Sheets with RFC 4180 parsing and UTF-8 BOM encoding.",
        badge: "Integrations",
        iconName: "IconArrowsExchange",
      },
    ],
  },
  workflow: {
    sectionBadge: "How It Works",
    sectionTitle: "A streamlined pipeline from discovery to cash",
    sectionSubtitle:
      "Automated enrichment keeps your data clean while your reps focus on conversations and closing.",
    steps: [
      {
        step: "01",
        title: "Discover & Ingest",
        description:
          "Continuous automated research and inbound web forms populate your backlog with verified sports organizations, federations, and enterprise sponsors.",
        deliverable: "Normalized accounts with verified domains & buying committee contacts",
      },
      {
        step: "02",
        title: "Qualify & Engage",
        description:
          "Execute targeted outreach cadences via personal Gmail accounts. Inbound replies thread directly into your CRM inbox with zero manual logging.",
        deliverable: "Two-way threaded correspondence with stop-on-reply automation",
      },
      {
        step: "03",
        title: "Inspect & Guide",
        description:
          "Run interactive playbooks (BANT / MEDDPICC), analyze call transcripts for buying signals, and track movement waterfalls across your pipeline.",
        deliverable: "Engagement-weighted deal health scores and category forecasts",
      },
      {
        step: "04",
        title: "Quote & Close",
        description:
          "Generate itemized PDF proposals and dispatch public e-signature portals. Signed quotes transition opportunities to WON and log audit receipts.",
        deliverable: "Legally accepted quotes with IP and timestamp attribution",
      },
    ],
  },
  pricing: {
    sectionBadge: "Commercial Tiers",
    sectionTitle: "Transparent pricing designed for high-performing teams",
    sectionSubtitle:
      "All plans include multi-brand workspace separation, full CRM integrations, and sovereign data isolation.",
    tiers: [
      {
        id: "starter",
        name: "Commercial Starter",
        price: "Contact for Quote",
        cadence: "per workspace / month",
        tagline: "Ideal for boutique sports agencies and single-brand sales squads.",
        features: [
          "1 active brand workspace",
          "Up to 3 sales rep seats",
          "Core Kanban & Table pipeline views",
          "Personal Gmail & Calendar integration",
          "Universal CRM CSV / TSV import & export",
          "Standard email outreach templates",
          "Email support & onboarding guide",
        ],
        ctaLabel: "Request Starter Quote",
        ctaHref: "mailto:salesleadgenerator@haho.ai?subject=Starter%20Tier%20Quote%20Request",
      },
      {
        id: "growth",
        name: "Growth & RevOps",
        price: "Custom Tailored",
        cadence: "annual billing",
        tagline: "For scaling rights-holders, clubs, and multi-rep commercial teams.",
        highlighted: true,
        features: [
          "Multiple brand & tenant workspaces",
          "Unlimited sales rep seats & assignable squads",
          "Unified 3-Pane Communication Center",
          "Automated outreach cadences & A/B testing",
          "Interactive CPQ Quote Portal & E-Signature",
          "Revenue waterfall & deal health scoring",
          "Transcript intelligence & Discovery Playbooks",
          "Public Inbound Web Lead Forms & Booking Links",
        ],
        ctaLabel: "Schedule Platform Demo",
        ctaHref: "mailto:salesleadgenerator@haho.ai?subject=Growth%20Tier%20Demo%20Request",
      },
      {
        id: "enterprise",
        name: "Enterprise Sovereignty",
        price: "Bespoke Enterprise",
        cadence: "dedicated SLA",
        tagline: "For major sports federations, media conglomerates, and enterprises.",
        features: [
          "Everything in Growth, plus:",
          "Automated background research agent integration",
          "Custom sportCode & industry taxonomy models",
          "Dedicated MongoDB Atlas database cluster",
          "Role-based SSO access & custom alias routing",
          "Custom webhook event dispatchers",
          "Tailored CPQ PDF contract templates",
          "Dedicated technical account manager & 99.9% SLA",
        ],
        ctaLabel: "Contact Enterprise Sales",
        ctaHref: "mailto:salesleadgenerator@haho.ai?subject=Enterprise%20Sovereignty%20Inquiry",
      },
    ],
  },
  faq: {
    sectionBadge: "Got Questions?",
    sectionTitle: "Frequently Asked Questions",
    sectionSubtitle:
      "Clear, honest answers regarding security, privacy, and how our platform operates.",
    items: [
      {
        question: "How does personal mailbox connection work and is my data secure?",
        answer:
          "Sales reps connect their Google Workspace accounts via OAuth 2.0 PKCE with explicit scopes (gmail.send, gmail.readonly). All OAuth credentials are encrypted at rest with AES-256-GCM. We enforce strict fail-closed isolation: reps only see email threads where they are direct senders or recipients.",
      },
      {
        question: "Does Sales Lead Generator comply with Google API Limited Use requirements?",
        answer:
          "Yes, 100%. Our compliance policy strictly prohibits selling user data, serving advertisements, or training generalized AI/machine learning models on user data. User emails are never read by human beings, and our inbound sync applies a Data Minimization Filter that discards non-CRM emails immediately from memory.",
      },
      {
        question: "Can I connect and exchange leads with HubSpot, Salesforce, or Pipedrive?",
        answer:
          "Yes. Sales Lead Generator includes native import and export engines supporting HubSpot, Salesforce, Pipedrive, and Google Sheets. You can import contacts via CSV or TSV clipboard copy, and export sanitized leads with full UTF-8 BOM encoding and field mapping.",
      },
      {
        question: "How does the CPQ Public Quote Portal and E-Signature operate?",
        answer:
          "When a rep generates a commercial quote, a secure public link (/quotes/[quoteId]) is created. Prospective buyers review itemized commercial totals and can sign electronically with their full name, title, and organization. Accepted proposals transition the deal to WON and log immutable cryptographic receipts.",
      },
      {
        question: "What sports and industries are supported out of the box?",
        answer:
          "Our taxonomy includes comprehensive sports codes (Football, Basketball, Handball, Ice Hockey, Rugby, Esports, etc.) as well as corporate sponsors, venue operators, media agencies, and federations across Europe, North America, and international markets.",
      },
    ],
  },
  ctaBanner: {
    badge: "Accelerate Your Pipeline",
    title: "Ready to scale your commercial sales revenue?",
    subtitle:
      "Join premier sports organizations and commercial teams managing their leads, communications, and deals in one unified platform.",
    primaryCta: {
      label: "Request Platform Access",
      href: "mailto:salesleadgenerator@haho.ai?subject=Platform%20Access%20Request",
    },
    secondaryCta: {
      label: "Review Security & Privacy Policy",
      href: "/privacy",
    },
    contactEmail: "salesleadgenerator@haho.ai",
  },
  footer: {
    tagline: "Sovereign sales intelligence and pipeline CRM for enterprise sales teams.",
    copyright: "© Moldován Csaba Kft. All rights reserved.",
    links: [
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms of Service", href: "/terms" },
      { label: "Release Notes", href: "/whats-new" },
      { label: "Contact", href: "mailto:salesleadgenerator@haho.ai" },
    ],
  },
};
