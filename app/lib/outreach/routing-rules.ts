import { getDecisionMakerContact } from '../../../lib/contacts';

export type Channel = 'email' | 'linkedin';

export type OutreachRoutingRule = {
  channel: Channel;
  requireEmail?: boolean;
  requireDecisionMaker?: boolean;
  requireCompanyUrl?: boolean;
  maxBodyLength?: number;
};

export const DEFAULT_ROUTING_RULES: Record<Channel, OutreachRoutingRule> = {
  email: {
    channel: 'email',
    requireEmail: true,
    requireDecisionMaker: true,
    requireCompanyUrl: false,
    maxBodyLength: 4000,
  },
  linkedin: {
    channel: 'linkedin',
    requireEmail: false,
    requireDecisionMaker: true,
    requireCompanyUrl: false,
    maxBodyLength: 3000,
  },
};

export type LeadFieldSnapshot = {
  contacts?: Array<{ name?: string; email?: string; isDecisionMaker?: boolean }>;
  url?: string;
  industry?: string;
  sport_or_sector?: string;
};

export type OutreachRoutingResult = {
  allowed: boolean;
  channel: Channel;
  reason?: string;
};

export function evaluateOutreachRouting(
  channel: Channel,
  lead: LeadFieldSnapshot,
  body: string = ''
): OutreachRoutingResult {
  const rule = DEFAULT_ROUTING_RULES[channel];
  // Decision-maker status is a flag on a contact (isDecisionMaker), not a
  // top-level field — see lib/contacts.ts, issue #45. Previously this checked
  // decision_maker_contact/decision_maker_name directly, which meant a lead
  // whose contact data lived only in contacts[] (the canonical store) was
  // wrongly blocked from outreach.
  const decisionMaker = getDecisionMakerContact(lead.contacts);

  if (rule.requireEmail) {
    const email = decisionMaker?.email || '';
    if (!email.includes('@')) {
      return { allowed: false, channel, reason: 'Missing decision maker email for email outreach.' };
    }
  }

  if (rule.requireDecisionMaker) {
    if (!decisionMaker?.name) {
      return { allowed: false, channel, reason: 'Missing decision maker name for outreach.' };
    }
  }

  if (rule.requireCompanyUrl) {
    const url = typeof lead.url === 'string' ? lead.url.trim() : '';
    if (!url) {
      return { allowed: false, channel, reason: 'Missing company URL for outreach.' };
    }
  }

  if (typeof rule.maxBodyLength === 'number') {
    const bodyLength = typeof body === 'string' ? body.length : 0;
    if (bodyLength > rule.maxBodyLength) {
      return { allowed: false, channel, reason: `Body exceeds ${rule.maxBodyLength} characters for ${channel}.` };
    }
  }

  return { allowed: true, channel };
}
