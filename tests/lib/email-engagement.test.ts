import { describe, it, expect } from 'vitest';
import {
  deriveEmailStatus,
  isHumanReply,
  isOutOfOffice,
  detectReplyClassification,
  getCancelReasonLabel,
  computeEngagementRates,
  TRACKING_CAVEATS_DISCLOSURE,
  AUTO_OPENS_TIP,
  AUTO_CLICKS_TIP,
  UNIQUE_RATE_TIP,
  type EmailEngagementInput,
} from '@/lib/email-engagement';

describe('Email Engagement Read Model (issue 242)', () => {
  const sent = new Date('2026-09-09T09:14:00Z');
  const opened = new Date('2026-09-09T09:42:00Z');
  const clicked = new Date('2026-09-09T10:03:00Z');
  const replied = new Date('2026-09-09T11:25:00Z');
  const bounced = new Date('2026-09-09T09:20:00Z');
  const cancelled = new Date('2026-09-09T09:10:00Z');

  describe('deriveEmailStatus precedence', () => {
    it('returns sent when sent only', () => {
      expect(deriveEmailStatus({ sentAt: sent })).toBe('sent');
    });

    it('returns opened when open after send', () => {
      expect(deriveEmailStatus({ sentAt: sent, openedAt: opened, openCount: 1 })).toBe('opened');
    });

    it('stays opened when multiple opens occur', () => {
      expect(deriveEmailStatus({ sentAt: sent, openedAt: opened, openCount: 3 })).toBe('opened');
    });

    it('treats machine open as sent, not opened', () => {
      expect(deriveEmailStatus({ sentAt: sent, openedAt: opened, openedMachine: true })).toBe('sent');
    });

    it('returns clicked when click after open', () => {
      expect(
        deriveEmailStatus({
          sentAt: sent,
          openedAt: opened,
          openCount: 1,
          clickedAt: clicked,
          clickCount: 1,
        })
      ).toBe('clicked');
    });

    it('human reply wins over open and click', () => {
      expect(
        deriveEmailStatus({
          sentAt: sent,
          openedAt: opened,
          openCount: 2,
          clickedAt: clicked,
          clickCount: 1,
          repliedAt: replied,
          replyClass: 'positive',
        })
      ).toBe('replied');
    });

    it('OOO is not a human reply and stays sent', () => {
      expect(
        deriveEmailStatus({
          sentAt: sent,
          replyClass: 'out_of_office',
        })
      ).toBe('sent');
    });

    it('OOO with repliedAt still stays sent', () => {
      expect(
        deriveEmailStatus({
          sentAt: sent,
          repliedAt: replied,
          replyClass: 'out_of_office',
        })
      ).toBe('sent');
    });

    it('auto_reply with repliedAt still stays sent', () => {
      expect(
        deriveEmailStatus({
          sentAt: sent,
          repliedAt: replied,
          replyClass: 'auto_reply',
        })
      ).toBe('sent');
    });

    it('bounce wins over open', () => {
      expect(
        deriveEmailStatus({
          sentAt: sent,
          openedAt: opened,
          bouncedAt: bounced,
        })
      ).toBe('bounced');
    });

    it('cancelled before send returns cancelled', () => {
      expect(deriveEmailStatus({ cancelledAt: cancelled })).toBe('cancelled');
    });

    it('cancelled with sendAttempted=false returns cancelled', () => {
      expect(deriveEmailStatus({ sentAt: sent, sendAttempted: false })).toBe('cancelled');
    });

    it('cancelled beats bounce', () => {
      expect(deriveEmailStatus({ cancelledAt: cancelled, bouncedAt: bounced })).toBe('cancelled');
    });

    it('scheduled when nothing happened', () => {
      expect(deriveEmailStatus({})).toBe('scheduled');
    });

    it('scheduled when inFlight is true', () => {
      expect(deriveEmailStatus({ inFlight: true })).toBe('scheduled');
    });
  });

  describe('isHumanReply and isOutOfOffice', () => {
    it('returns false when repliedAt is missing', () => {
      expect(isHumanReply(null, 'positive')).toBe(false);
      expect(isHumanReply(undefined, 'positive')).toBe(false);
    });

    it('returns true when positive reply exists', () => {
      expect(isHumanReply(replied, 'positive')).toBe(true);
    });

    it('returns true when no replyClass specified but repliedAt exists', () => {
      expect(isHumanReply(replied, null)).toBe(true);
    });

    it('returns false for out_of_office and auto_reply', () => {
      expect(isHumanReply(replied, 'out_of_office')).toBe(false);
      expect(isHumanReply(replied, 'auto_reply')).toBe(false);
    });

    it('identifies out_of_office correctly', () => {
      expect(isOutOfOffice('out_of_office')).toBe(true);
      expect(isOutOfOffice('auto_reply')).toBe(false);
      expect(isOutOfOffice('human')).toBe(false);
    });
  });

  describe('detectReplyClassification', () => {
    it('detects English out of office subject lines', () => {
      expect(detectReplyClassification('Out of Office: Meeting notes')).toBe('out_of_office');
      expect(detectReplyClassification('Automatic reply: Re: Partnership proposal')).toBe('out_of_office');
      expect(detectReplyClassification('Autoreply: Traveling')).toBe('out_of_office');
    });

    it('detects European multilingual out of office subject lines', () => {
      expect(detectReplyClassification('Abwesenheitsnotiz: Urlaub bis Montag')).toBe('out_of_office');
      expect(detectReplyClassification('Réponse automatique: absent du bureau')).toBe('out_of_office');
      expect(detectReplyClassification('Házon kívül vagyok: konferencia')).toBe('out_of_office');
    });

    it('detects auto-submitted email headers', () => {
      expect(detectReplyClassification('Re: Hello', { 'Auto-Submitted': 'auto-replied' })).toBe('auto_reply');
      expect(detectReplyClassification('Re: Hello', { 'Auto-Submitted': 'vacation' })).toBe('out_of_office');
      expect(detectReplyClassification('Re: Hello', { 'X-Autoreply': 'yes' })).toBe('auto_reply');
    });

    it('classifies normal human responses as human', () => {
      expect(detectReplyClassification('Re: Question about pricing')).toBe('human');
      expect(detectReplyClassification('Thanks for reaching out, let us talk')).toBe('human');
    });
  });

  describe('getCancelReasonLabel', () => {
    it('returns Contact replied for reply cancel codes', () => {
      expect(getCancelReasonLabel('replied')).toBe('Contact replied');
      expect(getCancelReasonLabel('contact_replied')).toBe('Contact replied');
      expect(getCancelReasonLabel('SEND_CANCELLED_REPLIED')).toBe('Contact replied');
    });

    it('returns Suppressed for suppression cancel codes', () => {
      expect(getCancelReasonLabel('suppressed')).toBe('Suppressed');
      expect(getCancelReasonLabel('SEND_CANCELLED_SUPPRESSED')).toBe('Suppressed');
    });

    it('returns Campaign stopped for campaign stoppage codes', () => {
      expect(getCancelReasonLabel('campaign_stopped')).toBe('Campaign stopped');
      expect(getCancelReasonLabel('cadence_stopped')).toBe('Campaign stopped');
    });

    it('returns Enrollment stopped for enrollment stoppage codes', () => {
      expect(getCancelReasonLabel('enrollment_stopped')).toBe('Enrollment stopped');
    });

    it('returns Invalid recipient for invalid email', () => {
      expect(getCancelReasonLabel('invalid_recipient')).toBe('Invalid recipient');
    });

    it('returns Personalization blocked for missing template variables', () => {
      expect(getCancelReasonLabel('personalization_blocked')).toBe('Personalization blocked');
      expect(getCancelReasonLabel('PERSONALIZATION_BLOCKED')).toBe('Personalization blocked');
    });

    it('returns empty string for unknown codes', () => {
      expect(getCancelReasonLabel('unknown_code')).toBe('');
      expect(getCancelReasonLabel(null)).toBe('');
    });
  });

  describe('computeEngagementRates', () => {
    it('calculates unique rates and aggregates properly', () => {
      const logs = [
        // Contact 1: Sent, Opened twice, Clicked once, Replied
        {
          to: 'lead1@example.com',
          sentAt: sent,
          openCount: 2,
          openedAt: opened,
          clickCount: 1,
          clickedAt: clicked,
          repliedAt: replied,
          replyClass: 'positive',
        },
        // Contact 2: Sent, Opened once, but OOO reply (not human reply)
        {
          to: 'lead2@example.com',
          sentAt: sent,
          openCount: 1,
          openedAt: opened,
          repliedAt: replied,
          replyClass: 'out_of_office',
        },
        // Contact 3: Sent, Bounced
        {
          to: 'lead3@example.com',
          sentAt: sent,
          bouncedAt: bounced,
          deliveryStatus: 'bounced',
        },
        // Contact 4: Cancelled last-mile (suppressed, never sent)
        {
          to: 'lead4@example.com',
          cancelledAt: cancelled,
          sendAttempted: false,
          routingReason: 'SEND_CANCELLED_SUPPRESSED',
        },
      ];

      const rates = computeEngagementRates(logs);

      // Sent unique: leads 1, 2, 3 (lead 4 was cancelled and not sent)
      expect(rates.totalSentUnique).toBe(3);
      // Opens unique: leads 1, 2
      expect(rates.totalOpensUnique).toBe(2);
      // Clicks unique: lead 1
      expect(rates.totalClicksUnique).toBe(1);
      // Replies unique: lead 1 only (lead 2 had OOO)
      expect(rates.totalRepliesUnique).toBe(1);
      // Bounces unique: lead 3
      expect(rates.totalBouncesUnique).toBe(1);
      // Cancelled unique: lead 4
      expect(rates.totalCancelledUnique).toBe(1);

      // Raw counts: 2 + 1 = 3 opens; 1 click
      expect(rates.rawOpenCount).toBe(3);
      expect(rates.rawClickCount).toBe(1);

      // Rates (percentages of sent = 3)
      // 2 / 3 = 66.7%
      expect(rates.uniqueOpenRate).toBe(66.7);
      // 1 / 3 = 33.3%
      expect(rates.uniqueClickRate).toBe(33.3);
      // 1 / 3 = 33.3%
      expect(rates.uniqueReplyRate).toBe(33.3);
      // 1 / 3 = 33.3%
      expect(rates.uniqueBounceRate).toBe(33.3);

      // Caveats string present
      expect(rates.trackingCaveats).toContain('Open tracking is probabilistic');
      expect(rates.trackingCaveats).toContain('Opened');
    });

    it('handles zero sent emails gracefully without NaN division', () => {
      const rates = computeEngagementRates([
        {
          to: 'cancelled@example.com',
          cancelledAt: cancelled,
          sendAttempted: false,
        },
      ]);

      expect(rates.totalSentUnique).toBe(0);
      expect(rates.uniqueOpenRate).toBe(0);
      expect(rates.uniqueClickRate).toBe(0);
      expect(rates.uniqueReplyRate).toBe(0);
      expect(rates.uniqueBounceRate).toBe(0);
    });

    it('ensures repeated pixel loads do not inflate unique open rate', () => {
      const logs = [
        // One lead opening an email 10 times
        {
          to: 'repeater@example.com',
          sentAt: sent,
          openCount: 10,
          openedAt: opened,
        },
      ];

      const rates = computeEngagementRates(logs);
      expect(rates.totalSentUnique).toBe(1);
      expect(rates.totalOpensUnique).toBe(1);
      expect(rates.rawOpenCount).toBe(10);
      expect(rates.uniqueOpenRate).toBe(100.0);
    });
  });

  describe('tracking caveats constants', () => {
    it('exports standard tooltips and caveats', () => {
      expect(TRACKING_CAVEATS_DISCLOSURE).toContain('probabilistic');
      expect(AUTO_OPENS_TIP).toContain('Apple Mail');
      expect(AUTO_CLICKS_TIP).toContain('security gateway');
      expect(UNIQUE_RATE_TIP).toContain('unique recipients');
    });
  });
});
