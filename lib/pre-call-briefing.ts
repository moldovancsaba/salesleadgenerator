import { generateDomainAuditPitch, type DomainAuditSummary } from './domain-audit-pitch';
import { computeDealHealth, type DealHealthResult } from './deal-health';
import type { Lead } from '@/app/types';

export type ContactPersonInfo = {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin?: string;
  role?: string;
  buyingRole?: string;
  isDecisionMaker?: boolean;
};

export type PreCallBriefing = {
  prospect: {
    entityName: string;
    stage: string;
    sportOrIndustry: string;
    location: string;
    decisionMaker?: {
      name: string;
      title?: string;
      email?: string;
      linkedinUrl?: string;
    };
    additionalContactsCount: number;
    iceScore: number;
    estimatedValue: string;
  };
  domainPitch: DomainAuditSummary;
  dealHealth: DealHealthResult;
  recommendedQuestions: Array<{
    category: 'goals' | 'tech_stack' | 'commercial' | 'decision_process';
    question: string;
    rationale: string;
  }>;
  keyObjectionsCheatSheet: Array<{
    objection: string;
    counterTrack: string;
  }>;
  capturedContextNotes: string[];
  markdownCheatSheet: string;
};

export function generatePreCallBriefing(lead: Lead, currency: string = '€'): PreCallBriefing {
  const entityName = lead.entity_name || 'Organization';
  const stage = lead.kanbanColumn || 'DISCOVERED';
  const sportOrIndustry = lead.industry || lead.sport_or_sector || 'Sports & Entertainment';
  const location = [lead.cityName, lead.region, lead.country].filter(Boolean).join(', ') || lead.country || 'Global';

  // 1. Identify primary contact / decision maker
  const contacts: ContactPersonInfo[] = Array.isArray(lead.contacts) ? lead.contacts : [];
  let primaryContact = contacts.find((c) => c.isDecisionMaker || c.buyingRole === 'economic_buyer' || c.buyingRole === 'champion');
  if (!primaryContact && contacts.length > 0) {
    primaryContact = contacts[0];
  }

  const decisionMaker = primaryContact && primaryContact.name
    ? {
        name: primaryContact.name,
        title: primaryContact.role || primaryContact.title || primaryContact.buyingRole,
        email: primaryContact.email,
        linkedinUrl: primaryContact.linkedin,
      }
    : undefined;

  const additionalContactsCount = Math.max(0, contacts.length - (primaryContact ? 1 : 0));

  // 2. ICE score & deal value
  const impact = lead.ice?.impact ?? 5;
  const confidence = lead.ice?.confidence ?? 5;
  const ease = lead.ice?.ease ?? 5;
  const iceScore = impact + confidence + ease;

  const dealValue = lead.deals?.[0]?.value ?? lead.ticketSizeEstimate?.expected ?? lead.actualDealValueUsd;
  const estimatedValue = typeof dealValue === 'number' && dealValue > 0
    ? `${currency}${dealValue.toLocaleString()}`
    : 'Not Set';

  // 3. Domain audit pitch
  const signals: string[] = Array.isArray(lead.techSignals) ? lead.techSignals : [];
  const domainPitch = generateDomainAuditPitch(
    entityName,
    signals,
    lead.techSignalsScannedAt
  );

  // 4. Deal Health calculation
  const dealHealth = computeDealHealth(lead);

  // 5. Tailored discovery questions based on tech signals and stage
  const recommendedQuestions: PreCallBriefing['recommendedQuestions'] = [];

  const signalSet = new Set(signals.map((s: string) => s.toLowerCase()));
  if (signalSet.has('shopify') || signalSet.has('woocommerce')) {
    recommendedQuestions.push({
      category: 'tech_stack',
      question: `How closely are matchday sponsor campaigns currently connected to conversions on your official online store?`,
      rationale: 'E-commerce detected. Unlocks matchday voucher redemptions and trackable sponsor promos.',
    });
  }

  if (signalSet.has('google-analytics') || signalSet.has('gtm') || signalSet.has('meta-pixel')) {
    recommendedQuestions.push({
      category: 'commercial',
      question: `What metrics or proof-points do your key commercial sponsors value most when renewing season partnerships?`,
      rationale: 'Analytics infrastructure present. They care about quantifiable digital reach and attribution.',
    });
  }

  recommendedQuestions.push({
    category: 'goals',
    question: `Looking at the current season, what is ${entityName}'s number one priority for expanding fan engagement and commercial revenue?`,
    rationale: 'Uncovers core strategic objective and establishes executive alignment.',
  });

  recommendedQuestions.push({
    category: 'decision_process',
    question: `Beyond yourself, who else on the commercial and executive team will be evaluating this pilot?`,
    rationale: 'Maps buying committee (Economic Buyer, Champion, Technical Gatekeepers).',
  });

  // 6. Key Objections Cheat Sheet
  const keyObjectionsCheatSheet: PreCallBriefing['keyObjectionsCheatSheet'] = [
    {
      objection: 'Our matchday operations and commercial staff are already at full capacity.',
      counterTrack: 'Our solution is 100% turnkey — no IT installation or stadium wiring required. Setup takes under 15 minutes and runs autonomously during games.',
    },
    {
      objection: 'We already have standard social media and in-stadium LED sponsor activations.',
      counterTrack: 'LED screens broadcast one-way ads fans tune out. We turn fans into active content creators, generating zero-party opt-in fan data and measurable sponsor click-throughs.',
    },
    {
      objection: 'We need to wait for next season\'s commercial budgeting cycle.',
      counterTrack: 'We can structure a self-funding pilot for an upcoming marquee matchday or cup tie that brings its own sponsor co-op funding before annual budgets freeze.',
    },
  ];

  // 7. Context notes / Capture snippets
  const capturedContextNotes: string[] = [];
  if (lead.notes && typeof lead.notes === 'string') {
    const trimmedNotes = lead.notes.trim();
    if (trimmedNotes) {
      capturedContextNotes.push(trimmedNotes);
    }
  }
  if (lead.qualification?.needNotes) {
    capturedContextNotes.push(`Need Context: ${lead.qualification.needNotes}`);
  }
  if (lead.qualification?.budgetNotes) {
    capturedContextNotes.push(`Budget Context: ${lead.qualification.budgetNotes}`);
  }

  // 8. Markdown cheat sheet generation
  const mdLines: string[] = [];
  mdLines.push(`# Pre-Call Executive Briefing: ${entityName}`);
  mdLines.push(`**Stage:** ${stage} | **Sector:** ${sportOrIndustry} | **Location:** ${location}`);
  mdLines.push(`**Deal Value:** ${estimatedValue} | **ICE Score:** ${iceScore}/30 | **Deal Health:** ${dealHealth.label} (${dealHealth.score}/100)`);
  mdLines.push('');

  if (decisionMaker) {
    mdLines.push(`### Stakeholder`);
    mdLines.push(`- **Name:** ${decisionMaker.name}${decisionMaker.title ? ` (${decisionMaker.title})` : ''}`);
    if (decisionMaker.email) mdLines.push(`- **Email:** ${decisionMaker.email}`);
    if (decisionMaker.linkedinUrl) mdLines.push(`- **LinkedIn:** ${decisionMaker.linkedinUrl}`);
    if (additionalContactsCount > 0) {
      mdLines.push(`- *Plus ${additionalContactsCount} additional contact${additionalContactsCount > 1 ? 's' : ''} on record.*`);
    }
    mdLines.push('');
  }

  mdLines.push(`### Recommended Talk Track`);
  mdLines.push(`> "${domainPitch.recommendedPitch}"`);
  mdLines.push('');

  mdLines.push(`### High-Impact Discovery Questions`);
  recommendedQuestions.forEach((q, idx) => {
    mdLines.push(`${idx + 1}. **${q.question}**`);
    mdLines.push(`   *Why ask:* ${q.rationale}`);
  });
  mdLines.push('');

  mdLines.push(`### Objection Rebuttals`);
  keyObjectionsCheatSheet.forEach((o) => {
    mdLines.push(`- **"${o.objection}"**`);
    mdLines.push(`  → *Response:* ${o.counterTrack}`);
  });

  if (capturedContextNotes.length > 0) {
    mdLines.push('');
    mdLines.push(`### Account Context & Notes`);
    capturedContextNotes.forEach((note) => {
      mdLines.push(`- ${note}`);
    });
  }

  const markdownCheatSheet = mdLines.join('\n');

  return {
    prospect: {
      entityName,
      stage,
      sportOrIndustry,
      location,
      decisionMaker,
      additionalContactsCount,
      iceScore,
      estimatedValue,
    },
    domainPitch,
    dealHealth,
    recommendedQuestions,
    keyObjectionsCheatSheet,
    capturedContextNotes,
    markdownCheatSheet,
  };
}
