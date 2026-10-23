// Visual Sales Path Stepper & Interactive Discovery Playbooks (issue #278) —
// pure, framework/DB-free definitions for stage-by-stage Guidance for Success
// and interactive B2B / Sports discovery playbooks.

export type SalesPathGuidance = {
  stage: string;
  label: string;
  objective: string;
  exitCriteria: string[];
  talkTrack: string;
};

export const STAGE_GUIDANCE_BY_KEY: Record<string, SalesPathGuidance> = {
  DISCOVERED: {
    stage: 'DISCOVERED',
    label: 'Discovered',
    objective: 'Validate organization fit, confirm active league/tier, and identify at least one decision-maker or commercial contact.',
    exitCriteria: [
      'Confirm organization website and primary country/region',
      'Identify Commercial Director, Marketing Lead, or General Manager',
      'Verify fit against target sport / sector profile',
    ],
    talkTrack: 'Lead with relevant peer clubs/federations in their region and highlight immediate fan engagement or performance impact.',
  },
  QUALIFIED: {
    stage: 'QUALIFIED',
    label: 'Qualified',
    objective: 'Establish initial two-way dialogue, uncover core priority for the current or upcoming season, and book discovery call.',
    exitCriteria: [
      'Enroll contact in multi-step outreach cadence or send personalized 1:1 intro',
      'Confirm core challenge or commercial goal',
      'Schedule discovery meeting or demo',
    ],
    talkTrack: 'Ask open-ended questions around current season objectives, sponsor activation deliverables, or operational bottlenecks.',
  },
  ENGAGED: {
    stage: 'ENGAGED',
    label: 'Engaged',
    objective: 'Complete structured discovery, map buying committee roles (Economic Buyer, Champion), and align on scope and budget.',
    exitCriteria: [
      'Complete Discovery Playbook (BANT, MEDDPICC, or Sports Activation)',
      'Confirm Economic Buyer and Champion on the account',
      'Agree on pilot or annual package scope',
    ],
    talkTrack: 'Quantify ROI using similar deployments and co-build the implementation timeline backward from their next key event or matchday.',
  },
  PROPOSAL: {
    stage: 'PROPOSAL',
    label: 'Proposal',
    objective: 'Deliver formal CPQ quote, resolve commercial/legal objections, and secure buyer e-signature.',
    exitCriteria: [
      'Generate and send interactive CPQ Quote Portal link',
      'Confirm quote viewed by decision-maker',
      'Resolve procurement / PO requirements and schedule closing call',
    ],
    talkTrack: 'Walk through the interactive Quote Portal live, confirm Purchase Order workflow, and lock in onboarding kick-off date.',
  },
  WON: {
    stage: 'WON',
    label: 'Won',
    objective: 'Record signed agreement, capture actual contract value for forecast calibration, and hand over to onboarding.',
    exitCriteria: [
      'Quote marked Signed or buyer e-signature completed',
      'Actual Deal Value recorded in USD/EUR',
      'Kick-off call scheduled with delivery team',
    ],
    talkTrack: 'Confirm first 30-day onboarding milestones and introduce customer success lead.',
  },
  LOST: {
    stage: 'LOST',
    label: 'Lost',
    objective: 'Document primary loss reason and set a future re-engagement reminder for next season or budget cycle.',
    exitCriteria: [
      'Structured decline/loss reason recorded',
      'Competitor or budget constraint documented in notes',
    ],
    talkTrack: 'Leave the door open gracefully and ask permission to check back ahead of next season’s budget planning window.',
  },
};

export function getStageGuidance(stageKey: string): SalesPathGuidance {
  return (
    STAGE_GUIDANCE_BY_KEY[stageKey] || {
      stage: stageKey,
      label: stageKey,
      objective: 'Advance opportunity toward qualification, proposal, and close.',
      exitCriteria: [
        'Confirm primary stakeholder contact details',
        'Schedule next concrete follow-up action',
      ],
      talkTrack: 'Focus on measurable customer outcomes and clear next steps.',
    }
  );
}

export type PlaybookQuestion = {
  id: string;
  label: string;
  placeholder: string;
  mapsToQualification?: 'budgetNotes' | 'needNotes' | 'timelineEstimate';
  followUpChecklistItem?: string;
};

export type DiscoveryPlaybook = {
  id: 'bant' | 'meddpicc' | 'sports_activation';
  name: string;
  badge: string;
  description: string;
  questions: PlaybookQuestion[];
};

export const DISCOVERY_PLAYBOOKS: DiscoveryPlaybook[] = [
  {
    id: 'bant',
    name: 'BANT Qualification Playbook',
    badge: 'Standard B2B',
    description: 'Rapidly qualify Budget, Authority, Need, and Timeline on initial discovery calls.',
    questions: [
      {
        id: 'budget',
        label: 'Budget — What budget is allocated or expected for this initiative?',
        placeholder: 'e.g. €25k–€40k annual sponsorship/innovation budget approved',
        mapsToQualification: 'budgetNotes',
        followUpChecklistItem: 'Send tailored ROI & pricing tier breakdown',
      },
      {
        id: 'authority',
        label: 'Authority — Who signs off on the final agreement and who else is involved?',
        placeholder: 'e.g. Commercial Director signs; Head of Digital champions',
        followUpChecklistItem: 'Map Economic Buyer & Champion in Contacts',
      },
      {
        id: 'need',
        label: 'Need — What is the #1 business pain or objective they must solve?',
        placeholder: 'e.g. Increase matchday sponsor activation & digital fan capture',
        mapsToQualification: 'needNotes',
      },
      {
        id: 'timeline',
        label: 'Timeline — What target launch date or event drives the decision?',
        placeholder: 'e.g. Before season opener in August / Q3',
        mapsToQualification: 'timelineEstimate',
        followUpChecklistItem: 'Generate & send formal CPQ Quote Portal link',
      },
    ],
  },
  {
    id: 'meddpicc',
    name: 'MEDDPICC Enterprise Deal Playbook',
    badge: 'Enterprise',
    description: 'Deep qualification for complex, multi-stakeholder federation, league, and enterprise deals.',
    questions: [
      {
        id: 'metrics',
        label: 'Metrics — What quantifiable KPIs will define success?',
        placeholder: 'e.g. +30% fan opt-ins, €100k incremental sponsor inventory',
        mapsToQualification: 'needNotes',
      },
      {
        id: 'economic_buyer',
        label: 'Economic Buyer — Who controls the discretionary P&L for this purchase?',
        placeholder: 'e.g. CEO / VP Commercial',
        followUpChecklistItem: 'Schedule executive alignment call with Economic Buyer',
      },
      {
        id: 'decision_process',
        label: 'Decision Criteria & Process — How will they evaluate vendors and approve legal/procurement?',
        placeholder: 'e.g. Pilot at 2 home matches -> Board sign-off -> PO issued',
        mapsToQualification: 'budgetNotes',
        followUpChecklistItem: 'Confirm procurement & PO onboarding requirements',
      },
      {
        id: 'compelling_event',
        label: 'Compelling Event & Timeline — Why must they act now instead of waiting?',
        placeholder: 'e.g. Upcoming playoff series / new shirt sponsor unveiling',
        mapsToQualification: 'timelineEstimate',
      },
    ],
  },
  {
    id: 'sports_activation',
    name: 'Sports Club & Federation Activation Playbook',
    badge: 'Sports CRM',
    description: 'Tailored discovery script for clubs, federations, stadium operators, and event organizers.',
    questions: [
      {
        id: 'venue_audience',
        label: 'Venue & Fanbase Scale — Average matchday attendance and digital reach?',
        placeholder: 'e.g. 22,000 stadium capacity, 18 home fixtures, 450k social followers',
        mapsToQualification: 'needNotes',
      },
      {
        id: 'sponsor_inventory',
        label: 'Sponsor Activation — How are they currently monetizing digital matchday inventory?',
        placeholder: 'e.g. LED perimeter boards + halftime Jumbotron; looking for interactive fan selfie/data capture',
        followUpChecklistItem: 'Share case study from comparable club in their league tier',
      },
      {
        id: 'commercial_model',
        label: 'Commercial & Budget Fit — Preferred model (annual license, per-event, or sponsor-funded)?',
        placeholder: 'e.g. Annual fee €18k + revenue share on sponsor activation',
        mapsToQualification: 'budgetNotes',
      },
      {
        id: 'kickoff_fixture',
        label: 'Target Fixture / Tournament — Which upcoming match or tournament is the target launch?',
        placeholder: 'e.g. Derby match on 15 Nov',
        mapsToQualification: 'timelineEstimate',
        followUpChecklistItem: 'Lock in technical dry-run 7 days before target fixture',
      },
    ],
  },
];

export type PlaybookSubmissionResult = {
  formattedNote: string;
  qualificationPatch: {
    budgetConfirmed: boolean;
    budgetNotes: string;
    authorityConfirmed: boolean;
    needNotes: string;
    timelineEstimate: string;
  };
  newChecklistItems: Array<{ text: string; done: boolean }>;
};

export function compilePlaybookSubmission(
  playbook: DiscoveryPlaybook,
  answers: Record<string, string>,
  existingQualification?: {
    budgetConfirmed?: boolean;
    budgetNotes?: string;
    authorityConfirmed?: boolean;
    needNotes?: string;
    timelineEstimate?: string;
  },
  existingChecklist?: Array<{ id?: string; text: string; done: boolean }>
): PlaybookSubmissionResult {
  const lines: string[] = [`[Discovery Playbook: ${playbook.name}]`];

  let budgetNotes = existingQualification?.budgetNotes || '';
  let needNotes = existingQualification?.needNotes || '';
  let timelineEstimate = existingQualification?.timelineEstimate || '';
  let budgetConfirmed = Boolean(existingQualification?.budgetConfirmed);
  let authorityConfirmed = Boolean(existingQualification?.authorityConfirmed);

  const existingTexts = new Set(
    (existingChecklist || []).map((c) => c.text.trim().toLowerCase())
  );
  const newChecklistItems: Array<{ text: string; done: boolean }> = [];

  for (const q of playbook.questions) {
    const rawAns = (answers[q.id] || '').trim();
    if (!rawAns) continue;

    lines.push(`• ${q.label.split('—')[0].trim()}: ${rawAns}`);

    if (q.mapsToQualification === 'budgetNotes') {
      budgetNotes = rawAns;
      budgetConfirmed = true;
    } else if (q.mapsToQualification === 'needNotes') {
      needNotes = rawAns;
    } else if (q.mapsToQualification === 'timelineEstimate') {
      timelineEstimate = rawAns;
    }

    if (q.id === 'authority' || q.id === 'economic_buyer') {
      authorityConfirmed = true;
    }

    if (
      q.followUpChecklistItem &&
      !existingTexts.has(q.followUpChecklistItem.toLowerCase())
    ) {
      newChecklistItems.push({ text: q.followUpChecklistItem, done: false });
      existingTexts.add(q.followUpChecklistItem.toLowerCase());
    }
  }

  return {
    formattedNote: lines.join('\n'),
    qualificationPatch: {
      budgetConfirmed,
      budgetNotes,
      authorityConfirmed,
      needNotes,
      timelineEstimate,
    },
    newChecklistItems,
  };
}
