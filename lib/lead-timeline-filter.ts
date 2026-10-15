/**
 * Lead timeline noise filtering helper functions (Issue #244).
 * Suppresses inbound and historical correspondence predating lead contact creation.
 */

export const PRE_LEAD_GRACE_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours

/**
 * Evaluates whether an email/correspondence timestamp predates lead creation.
 * Accounts for a grace period (default 48h) to absorb clock skew and delayed lead entry.
 *
 * @param messageDate - ISO string, Date object, or millisecond timestamp of the message
 * @param leadCreatedAt - ISO string, Date object, or millisecond timestamp of the lead's creation
 * @param graceWindowMs - Milliseconds before lead creation considered part of current deal (default: 48h)
 * @returns true if message strictly predates (leadCreatedAt - graceWindowMs)
 */
export function isMessageHistorical(
  messageDate: string | Date | number | null | undefined,
  leadCreatedAt: string | Date | number | null | undefined,
  graceWindowMs: number = PRE_LEAD_GRACE_WINDOW_MS
): boolean {
  if (!leadCreatedAt || !messageDate) return false;

  const leadCreatedMs = new Date(leadCreatedAt).getTime();
  if (isNaN(leadCreatedMs)) return false;

  const messageMs = new Date(messageDate).getTime();
  if (isNaN(messageMs)) return false;

  const safeGraceMs = typeof graceWindowMs === 'number' && !isNaN(graceWindowMs) && graceWindowMs >= 0
    ? graceWindowMs
    : PRE_LEAD_GRACE_WINDOW_MS;

  const thresholdMs = leadCreatedMs - safeGraceMs;
  return messageMs < thresholdMs;
}
