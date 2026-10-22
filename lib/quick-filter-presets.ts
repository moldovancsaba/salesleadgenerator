import type { Lead } from '@/app/types';
import { getTicketSize } from '@/app/constants';

export type QuickFilterPreset = 'all' | 'my_leads' | 'needs_followup' | 'high_value' | 'unassigned';

export const HIGH_VALUE_THRESHOLD_EUR = 25000;

export function getLeadEffectiveValue(lead: Partial<Lead>): number {
  if (Array.isArray(lead.deals) && lead.deals.length > 0) {
    const activeDeals = lead.deals.filter((d) => d && (d as any).stage !== 'LOST');
    if (activeDeals.length > 0) {
      return activeDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
    }
  }
  const ts = getTicketSize(lead as Lead);
  if (ts && ts.kind === 'estimate') return ts.expected || 0;
  if (ts && ts.kind === 'legacy') return ts.value || 0;
  return 0;
}

export function isLeadNeedsFollowUp(lead: Partial<Lead>, nowMs: number = Date.now()): boolean {
  const dueRaw = (lead as any).nextActionDueAt || (lead as any).nextActionDate;
  if (!dueRaw) return false;
  const dueMs = new Date(dueRaw).getTime();
  if (Number.isNaN(dueMs)) return false;
  const endOfToday = new Date(nowMs);
  endOfToday.setHours(23, 59, 59, 999);
  return dueMs <= endOfToday.getTime();
}

export function matchesQuickFilterPreset(
  lead: Partial<Lead>,
  preset: QuickFilterPreset,
  userContext?: { userId?: string | null; userEmail?: string | null; currentUserId?: string | null; currentUserEmail?: string | null }
): boolean {
  if (preset === 'all') return true;
  if (preset === 'unassigned') {
    return !lead.assignedTo && !(lead as any).assignedToEmail;
  }
  if (preset === 'my_leads') {
    const uid = (userContext?.userId ?? userContext?.currentUserId)?.trim();
    const uemail = (userContext?.userEmail ?? userContext?.currentUserEmail)?.trim().toLowerCase();
    if (uid && lead.assignedTo === uid) return true;
    if (uemail && (lead as any).assignedToEmail?.toLowerCase() === uemail) return true;
    return false;
  }
  if (preset === 'needs_followup') {
    return isLeadNeedsFollowUp(lead);
  }
  if (preset === 'high_value') {
    return getLeadEffectiveValue(lead) >= HIGH_VALUE_THRESHOLD_EUR;
  }
  return true;
}
