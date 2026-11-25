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
};

export type OutreachRoutingResult = {
  allowed: boolean;
  channel: Channel;
  reason?: string;
};

export function evaluateOutreachRouting(
  channel: Channel,
  lead: LeadFieldSnapshot,
  body: string = '',
  options?: { selectedContact?: { name?: string; email?: string } | null }
): OutreachRoutingResult {
  const rule = DEFAULT_ROUTING_RULES[channel];
  // Decision-maker status is a flag on a contact (isDecisionMaker), not a
  // top-level field — see lib/contacts.ts, issue #45. When a rep explicitly
  // selects a stored contact on the lead for manual outreach (#359), validate
  // that chosen contact directly; automated cadence dispatch continues to use
  // getDecisionMakerContact(lead.contacts).
  const targetContact = options?.selectedContact ?? getDecisionMakerContact(lead.contacts);

  if (rule.requireEmail) {
    const email = targetContact?.email || '';
    if (!email.includes('@')) {
      return {
        allowed: false,
        channel,
        reason: options?.selectedContact
          ? 'Selected contact does not have a valid work email address.'
          : 'Missing decision maker email for email outreach.',
      };
    }
  }

  if (rule.requireDecisionMaker) {
    if (!targetContact?.name) {
      return {
        allowed: false,
        channel,
        reason: options?.selectedContact
          ? 'Selected contact is missing a name for outreach.'
          : 'Missing decision maker name for outreach.',
      };
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
