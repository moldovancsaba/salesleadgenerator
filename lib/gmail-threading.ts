import type { Db } from 'mongodb';
import { ACTIVITY_LOG_COLLECTION } from '../app/lib/activity-log-store';

// Issue #243 — RFC 2822 In-Reply-To and References header chaining and Gmail API threadId resolution

export type LeadThreadContext = {
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  subject?: string;
  lastMessageAt?: string;
  lastDirection?: 'inbound' | 'outbound';
};

/**
 * Normalizes subject line with standard single "Re: " prefix,
 * stripping any duplicate Re:, Fwd:, etc.
 */
export function formatReSubject(subject?: string): string {
  if (!subject || !subject.trim()) return 'Re: ';
  const cleaned = subject
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/gi, '')
    .trim();
  return `Re: ${cleaned}`;
}

/**
 * Ensures an RFC 2822 Message-ID is correctly formatted with angle brackets <...>.
 * Strips any internal storage prefixes like "gmail:".
 */
export function formatRfcMessageId(id?: string): string | undefined {
  if (!id || !id.trim()) return undefined;
  let clean = id.trim();
  if (clean.startsWith('gmail:')) {
    clean = clean.replace(/^gmail:/, '').trim();
  }
  // Strip any surrounding whitespace
  clean = clean.trim();
  if (!clean) return undefined;
  if (!clean.startsWith('<')) clean = `<${clean}`;
  if (!clean.endsWith('>')) clean = `${clean}>`;
  return clean;
}

/**
 * Resolves the most recent email thread context for a lead across
 * both outreach_logs (outbound) and activityLog (inbound/outbound).
 */
export async function resolveLeadThreadContext(
  db: Db,
  leadId: string,
  brand?: string,
  tenantId?: string
): Promise<LeadThreadContext | null> {
  const filter: Record<string, any> = { leadId };
  if (brand) filter.brand = brand;
  if (tenantId) filter.tenantId = tenantId;

  // 1. Check most recent outreach_log for this lead
  const lastOutreachLog = await db
    .collection('outreach_logs')
    .find({
      leadId,
      sendAttempted: true,
      routingAllowed: true,
      ...(brand ? { brand } : {}),
    })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray()
    .then((arr) => arr[0])
    .catch(() => null);

  // 2. Check most recent email entry in activityLog
  const lastActivityLog = await db
    .collection(ACTIVITY_LOG_COLLECTION)
    .find({
      leadId,
      type: { $in: ['email-outbound', 'email-inbound'] },
      ...(brand ? { brand } : {}),
    })
    .sort({ createdAt: -1 })
    .limit(1)
    .toArray()
    .then((arr) => arr[0])
    .catch(() => null);

  if (!lastOutreachLog && !lastActivityLog) {
    return null;
  }

  // Determine which is newer
  const outreachTime = lastOutreachLog?.createdAt ? new Date(lastOutreachLog.createdAt).getTime() : 0;
  const activityTime = lastActivityLog?.createdAt ? new Date(lastActivityLog.createdAt).getTime() : 0;

  if (lastOutreachLog && outreachTime >= activityTime) {
    const rawMsgId = lastOutreachLog.rfcMessageId || lastOutreachLog.gmailMessageId || lastOutreachLog.resendEmailId;
    const inReplyTo = formatRfcMessageId(rawMsgId);
    const threadId = lastOutreachLog.gmailThreadId;
    const subject = lastOutreachLog.subject;

    return {
      threadId: threadId || undefined,
      inReplyTo,
      references: inReplyTo,
      subject: subject || undefined,
      lastMessageAt: lastOutreachLog.createdAt instanceof Date ? lastOutreachLog.createdAt.toISOString() : String(lastOutreachLog.createdAt),
      lastDirection: 'outbound',
    };
  }

  if (lastActivityLog) {
    const rawMsgId = lastActivityLog.rfcMessageId || lastActivityLog.externalId;
    const inReplyTo = formatRfcMessageId(rawMsgId);
    const threadId = lastActivityLog.threadId;
    const subject = lastActivityLog.subject;

    return {
      threadId: threadId || undefined,
      inReplyTo,
      references: inReplyTo,
      subject: subject || undefined,
      lastMessageAt: lastActivityLog.createdAt instanceof Date ? lastActivityLog.createdAt.toISOString() : String(lastActivityLog.createdAt),
      lastDirection: lastActivityLog.direction || (lastActivityLog.type === 'email-inbound' ? 'inbound' : 'outbound'),
    };
  }

  return null;
}
