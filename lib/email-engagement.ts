/**
 * Email engagement read model, status precedence, unique rates analytics,
 * and tracking caveats disclosure (Vega CRM ingestion Phase 6 / Handoff 07).
 */

export const EMAIL_STATUSES = [
  'cancelled',
  'bounced',
  'replied',
  'clicked',
  'opened',
  'sent',
  'scheduled',
] as const;

export type EmailStatus = typeof EMAIL_STATUSES[number];

export type ReplyClassification = 'human' | 'out_of_office' | 'auto_reply';

export type EmailEngagementInput = {
  sentAt?: Date | string | null;
  openedAt?: Date | string | null;
  openedMachine?: boolean;
  clickedAt?: Date | string | null;
  clickCount?: number;
  openCount?: number;
  repliedAt?: Date | string | null;
  replyClass?: ReplyClassification | string | null;
  bouncedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  inFlight?: boolean;
  deliveryStatus?: string;
  sendAttempted?: boolean;
  sendCancelledReason?: string;
};

export const TRACKING_CAVEATS_DISCLOSURE =
  "Open tracking is probabilistic and may be affected by Apple Mail Privacy Protection (MPP), image proxies, caching, and blocked remote images. Rates are calculated per unique recipient over successfully sent messages. Display status is 'Opened', never 'Read'.";

export const AUTO_OPENS_TIP =
  "Auto-opens: pixel fetches from privacy proxies (e.g. Apple Mail) or within seconds of sending. Open tracking is probabilistic and may be affected by mail privacy protection, image proxies, caching, and blocked remote images.";

export const AUTO_CLICKS_TIP =
  "Auto-clicks: links followed by a security gateway scanning the email, not a person; not counted as clicks.";

export const UNIQUE_RATE_TIP =
  "Rates use unique recipients who engaged, divided by successfully sent emails. Repeated pixel loads raise total opens, not unique open rate. Last-mile cancelled sends are not sent.";

/**
 * HumanReply is a person answering. Out-of-office and auto-replies are not.
 */
export function isHumanReply(
  repliedAt?: Date | string | null,
  replyClass?: string | null
): boolean {
  if (!repliedAt) return false;
  if (replyClass === 'out_of_office' || replyClass === 'auto_reply') {
    return false;
  }
  return true;
}

/**
 * OutOfOffice reports an automated away reply, with or without replied_at.
 */
export function isOutOfOffice(replyClass?: string | null): boolean {
  return replyClass === 'out_of_office';
}

const OOO_SUBJECT_PATTERNS = [
  /out of office/i,
  /automatic reply/i,
  /autoreply/i,
  /auto-reply/i,
  /abwesend/i,
  /abwesenheitsnotiz/i,
  /automatique/i,
  /házon kívül/i,
  /valaszadas/i,
  /válaszadás/i,
];

/**
 * Detects whether an inbound email subject/headers represents an automated out-of-office response.
 */
export function detectReplyClassification(
  subject?: string | null,
  headers?: Record<string, string> | Array<{ name: string; value: string }> | null
): ReplyClassification {
  if (headers) {
    const headerMap = Array.isArray(headers)
      ? new Map(headers.map((h) => [h.name.toLowerCase(), h.value.toLowerCase()]))
      : new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).toLowerCase()]));

    const autoSubmitted = headerMap.get('auto-submitted');
    if (autoSubmitted && autoSubmitted !== 'no') {
      return autoSubmitted.includes('vacation') || autoSubmitted.includes('out-of-office')
        ? 'out_of_office'
        : 'auto_reply';
    }

    if (headerMap.get('x-autoreply') === 'yes') {
      return 'auto_reply';
    }

    const precedence = headerMap.get('precedence');
    if (precedence === 'bulk' || precedence === 'junk' || precedence === 'auto_reply') {
      return 'auto_reply';
    }
  }

  if (subject) {
    for (const pattern of OOO_SUBJECT_PATTERNS) {
      if (pattern.test(subject)) {
        return 'out_of_office';
      }
    }
  }

  return 'human';
}

/**
 * DeriveEmailStatus picks the primary display state according to canonical precedence:
 * Cancelled > Bounced > Replied > Clicked > Opened > Sent > Scheduled
 *
 * Later events do not erase earlier ones; callers keep first/last/count beside this label.
 */
export function deriveEmailStatus(inState: EmailEngagementInput): EmailStatus {
  // 1. Cancelled
  if (
    inState.cancelledAt != null ||
    inState.sendAttempted === false ||
    inState.deliveryStatus === 'cancelled'
  ) {
    return 'cancelled';
  }

  // 2. Bounced
  if (inState.bouncedAt != null || inState.deliveryStatus === 'bounced') {
    return 'bounced';
  }

  // 3. Replied (human only)
  if (isHumanReply(inState.repliedAt, inState.replyClass)) {
    return 'replied';
  }

  // 4. Clicked
  if (
    inState.clickedAt != null ||
    (typeof inState.clickCount === 'number' && inState.clickCount > 0) ||
    inState.deliveryStatus === 'clicked'
  ) {
    return 'clicked';
  }

  // 5. Opened (human only; machine opens do not qualify as 'opened' and fall through to 'sent')
  if (
    (inState.openedAt != null && !inState.openedMachine) ||
    (typeof inState.openCount === 'number' && inState.openCount > 0 && !inState.openedMachine) ||
    inState.deliveryStatus === 'opened'
  ) {
    return 'opened';
  }

  // 6. Sent
  if (
    inState.sentAt != null ||
    inState.deliveryStatus === 'sent' ||
    inState.deliveryStatus === 'delivered' ||
    inState.openedMachine // machine open implies delivery happened
  ) {
    return 'sent';
  }

  // 7. Scheduled / In-flight / fallback
  if (inState.inFlight) {
    return 'scheduled';
  }

  return 'scheduled';
}

/**
 * Maps last-mile and suppression cancellation codes to human-readable CRM labels.
 */
export function getCancelReasonLabel(code: string | undefined | null): string {
  if (!code) return '';
  switch (code) {
    case 'replied':
    case 'contact_replied':
    case 'SEND_CANCELLED_REPLIED':
      return 'Contact replied';
    case 'suppressed':
    case 'SEND_CANCELLED_SUPPRESSED':
      return 'Suppressed';
    case 'campaign_stopped':
    case 'cadence_stopped':
      return 'Campaign stopped';
    case 'enrollment_stopped':
      return 'Enrollment stopped';
    case 'invalid_recipient':
      return 'Invalid recipient';
    case 'personalization_blocked':
    case 'PERSONALIZATION_BLOCKED':
      return 'Personalization blocked';
    case 'attachment_missing':
    case 'ATTACHMENT_MISSING':
      return 'Attachment missing';
    default:
      return '';
  }
}

export type OutreachLogItem = {
  to?: string;
  leadId?: string;
  contactKey?: string;
  createdAt?: Date | string;
  sentAt?: Date | string | null;
  sendAttempted?: boolean;
  routingAllowed?: boolean;
  routingReason?: string;
  deliveryStatus?: string;
  openCount?: number;
  clickCount?: number;
  openedMachine?: boolean;
  openedAt?: Date | string | null;
  clickedAt?: Date | string | null;
  repliedAt?: Date | string | null;
  replyClass?: string | null;
  bouncedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
  inFlight?: boolean;
};

export type EngagementRatesSummary = {
  totalSentUnique: number;
  totalOpensUnique: number;
  totalClicksUnique: number;
  totalRepliesUnique: number;
  totalBouncesUnique: number;
  totalCancelledUnique: number;
  rawOpenCount: number;
  rawClickCount: number;
  uniqueOpenRate: number;
  uniqueClickRate: number;
  uniqueReplyRate: number;
  uniqueBounceRate: number;
  statusCounts: Record<EmailStatus, number>;
  trackingCaveats: string;
};

/**
 * Computes engagement rates per unique recipient over successfully sent emails.
 * Repeated pixel loads raise raw open counts, not unique open rate.
 * Out-of-office replies are excluded from replies.
 * Cancelled last-mile sends are not counted as sent.
 */
export function computeEngagementRates(logs: OutreachLogItem[]): EngagementRatesSummary {
  const sentRecipients = new Set<string>();
  const openRecipients = new Set<string>();
  const clickRecipients = new Set<string>();
  const replyRecipients = new Set<string>();
  const bounceRecipients = new Set<string>();
  const cancelledRecipients = new Set<string>();

  let rawOpenCount = 0;
  let rawClickCount = 0;

  const statusCounts: Record<EmailStatus, number> = {
    cancelled: 0,
    bounced: 0,
    replied: 0,
    clicked: 0,
    opened: 0,
    sent: 0,
    scheduled: 0,
  };

  for (const log of logs) {
    const recipientKey = (log.to || log.contactKey || log.leadId || '').trim().toLowerCase();
    const status = deriveEmailStatus({
      sentAt: log.sentAt ?? log.createdAt,
      openedAt: log.openedAt,
      openedMachine: log.openedMachine,
      clickedAt: log.clickedAt,
      clickCount: log.clickCount,
      openCount: log.openCount,
      repliedAt: log.repliedAt,
      replyClass: log.replyClass,
      bouncedAt: log.bouncedAt,
      cancelledAt: log.cancelledAt,
      inFlight: log.inFlight,
      deliveryStatus: log.deliveryStatus,
      sendAttempted: log.sendAttempted,
      sendCancelledReason: log.routingReason,
    });

    statusCounts[status] += 1;

    if (log.openCount && log.openCount > 0) {
      rawOpenCount += log.openCount;
    }
    if (log.clickCount && log.clickCount > 0) {
      rawClickCount += log.clickCount;
    }

    if (!recipientKey) continue;

    if (status === 'cancelled') {
      cancelledRecipients.add(recipientKey);
      continue;
    }

    // A sent recipient is any recipient where send was attempted and not cancelled
    sentRecipients.add(recipientKey);

    if (status === 'bounced' || log.bouncedAt || log.deliveryStatus === 'bounced') {
      bounceRecipients.add(recipientKey);
    }
    if (isHumanReply(log.repliedAt, log.replyClass) || status === 'replied') {
      replyRecipients.add(recipientKey);
    }
    if (
      (log.clickedAt != null || (log.clickCount ?? 0) > 0 || log.deliveryStatus === 'clicked') &&
      status !== 'bounced'
    ) {
      clickRecipients.add(recipientKey);
    }
    if (
      ((log.openedAt != null && !log.openedMachine) ||
        ((log.openCount ?? 0) > 0 && !log.openedMachine) ||
        log.deliveryStatus === 'opened') &&
      status !== 'bounced'
    ) {
      openRecipients.add(recipientKey);
    }
  }

  const totalSentUnique = sentRecipients.size;
  const totalOpensUnique = openRecipients.size;
  const totalClicksUnique = clickRecipients.size;
  const totalRepliesUnique = replyRecipients.size;
  const totalBouncesUnique = bounceRecipients.size;
  const totalCancelledUnique = cancelledRecipients.size;

  const uniqueOpenRate =
    totalSentUnique > 0 ? Number(((totalOpensUnique / totalSentUnique) * 100).toFixed(1)) : 0;
  const uniqueClickRate =
    totalSentUnique > 0 ? Number(((totalClicksUnique / totalSentUnique) * 100).toFixed(1)) : 0;
  const uniqueReplyRate =
    totalSentUnique > 0 ? Number(((totalRepliesUnique / totalSentUnique) * 100).toFixed(1)) : 0;
  const uniqueBounceRate =
    totalSentUnique > 0 ? Number(((totalBouncesUnique / totalSentUnique) * 100).toFixed(1)) : 0;

  return {
    totalSentUnique,
    totalOpensUnique,
    totalClicksUnique,
    totalRepliesUnique,
    totalBouncesUnique,
    totalCancelledUnique,
    rawOpenCount,
    rawClickCount,
    uniqueOpenRate,
    uniqueClickRate,
    uniqueReplyRate,
    uniqueBounceRate,
    statusCounts,
    trackingCaveats: TRACKING_CAVEATS_DISCLOSURE,
  };
}
