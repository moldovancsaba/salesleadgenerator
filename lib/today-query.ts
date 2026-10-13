import type { Db } from 'mongodb';
import { getBrandConfig, type Brand } from '@/app/lib/brand';
import { tenantFilter } from './tenant';
import { contactKey, normalizeContact } from './contacts';
import {
  parseTodayWindow,
  computeOverdueDays,
  type TodayCadenceTask,
  type TodayFollowUp,
  type TodayDealAttention,
  type TodayViewData,
} from './today';

export type TodayQueryOptions = {
  timezone?: string;
  scope?: 'mine' | 'all';
  userId?: string;
  limit?: number;
  now?: Date;
  tenantId?: string;
};

/**
 * Aggregates the 4 Today view buckets from the brand's lead collection:
 * 1. cadenceTasks: Sequence manual steps (waitingForTask: true) sorted by taskDueAt
 * 2. overdueFollowUps: Scheduled reminders before today's window
 * 3. dueTodayFollowUps: Scheduled reminders within today's window
 * 4. dealsNeedingAttention: Active deals past expectedCloseDate or stale (inactive 7+ days)
 */
export async function getTodayViewData(
  db: Db,
  brand: Brand,
  options: TodayQueryOptions = {}
): Promise<TodayViewData> {
  const now = options.now ?? new Date();
  const window = parseTodayWindow(options.timezone, now);
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const scope: 'mine' | 'all' = options.scope === 'all' ? 'all' : 'mine';

  const config = await getBrandConfig(brand);
  if (!config) {
    throw new Error(`Invalid brand configuration for: ${brand}`);
  }

  const col = db.collection(config.dbCollection);

  // Tenant and rep ownership filter
  const baseFilter: Record<string, any> = { ...tenantFilter(options.tenantId || 'default') };
  if (scope === 'mine' && options.userId) {
    baseFilter.$or = [
      { assignedTo: options.userId },
      { assignedTo: null },
      { assignedTo: { $exists: false } },
    ];
  }

  // 1. Cadence manual tasks
  const cadenceFilter = {
    ...baseFilter,
    'activeCadence.waitingForTask': true,
  };
  const cadenceDocs = await col
    .find(cadenceFilter)
    .sort({ 'activeCadence.taskDueAt': 1, updatedAt: -1 })
    .limit(limit)
    .toArray();

  const cadenceTasks: TodayCadenceTask[] = cadenceDocs.map((doc) => {
    const active = doc.activeCadence;
    const firstContact = Array.isArray(doc.contacts) && doc.contacts[0] ? doc.contacts[0] : null;
    return {
      leadId: doc._id.toString(),
      entityName: doc.entity_name || 'Unnamed Lead',
      contactName: firstContact?.name,
      contactEmail: firstContact?.email,
      contactKey: firstContact ? contactKey(normalizeContact(firstContact)) : undefined,
      channel: (active?.stepChannel as any) || 'general',
      reminderNote: active?.reminderNote || doc.nextActionNote,
      taskDueAt: active?.taskDueAt || window.dayStart.toISOString(),
      stepIndex: (active?.currentStepIndex ?? 0) + 1,
      totalSteps: active?.totalSteps,
      cadenceName: active?.cadenceName,
      assignedTo: doc.assignedToDisplay || doc.assignedTo,
    };
  });

  // 2. Overdue follow-up reminders (excluding active cadence tasks)
  const overdueFilter = {
    ...baseFilter,
    nextActionDueAt: { $ne: null, $lt: window.dayStart.toISOString() },
    'activeCadence.waitingForTask': { $ne: true },
  };
  const overdueDocs = await col
    .find(overdueFilter)
    .sort({ nextActionDueAt: 1 })
    .limit(limit)
    .toArray();

  const overdueFollowUps: TodayFollowUp[] = overdueDocs.map((doc) => {
    const firstContact = Array.isArray(doc.contacts) && doc.contacts[0] ? doc.contacts[0] : null;
    return {
      leadId: doc._id.toString(),
      entityName: doc.entity_name || 'Unnamed Lead',
      contactName: firstContact?.name,
      contactEmail: firstContact?.email,
      contactKey: firstContact ? contactKey(normalizeContact(firstContact)) : undefined,
      nextActionNote: doc.nextActionNote,
      nextActionDueAt: doc.nextActionDueAt,
      overdueDays: computeOverdueDays(doc.nextActionDueAt, now),
      assignedTo: doc.assignedToDisplay || doc.assignedTo,
    };
  });

  // 3. Due today follow-up reminders (excluding active cadence tasks)
  const dueTodayFilter = {
    ...baseFilter,
    nextActionDueAt: {
      $gte: window.dayStart.toISOString(),
      $lt: window.dayEnd.toISOString(),
    },
    'activeCadence.waitingForTask': { $ne: true },
  };
  const dueTodayDocs = await col
    .find(dueTodayFilter)
    .sort({ nextActionDueAt: 1 })
    .limit(limit)
    .toArray();

  const dueTodayFollowUps: TodayFollowUp[] = dueTodayDocs.map((doc) => {
    const firstContact = Array.isArray(doc.contacts) && doc.contacts[0] ? doc.contacts[0] : null;
    return {
      leadId: doc._id.toString(),
      entityName: doc.entity_name || 'Unnamed Lead',
      contactName: firstContact?.name,
      contactEmail: firstContact?.email,
      contactKey: firstContact ? contactKey(normalizeContact(firstContact)) : undefined,
      nextActionNote: doc.nextActionNote,
      nextActionDueAt: doc.nextActionDueAt,
      overdueDays: 0,
      assignedTo: doc.assignedToDisplay || doc.assignedTo,
    };
  });

  // 4. Deals needing attention (open deals with past close date or stale inactive for 7+ days)
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const dealsFilter = {
    ...baseFilter,
    kanbanColumn: { $nin: ['WON', 'LOST'] },
    deals: { $exists: true, $not: { $size: 0 } },
  };
  const dealLeadDocs = await col
    .find(dealsFilter)
    .sort({ updatedAt: -1 })
    .limit(limit * 2)
    .toArray();

  const dealsNeedingAttention: TodayDealAttention[] = [];
  for (const doc of dealLeadDocs) {
    if (!Array.isArray(doc.deals)) continue;
    for (const deal of doc.deals) {
      if (
        deal.stageId === 'won' ||
        deal.stageId === 'lost' ||
        deal.stageId === 'WON' ||
        deal.stageId === 'LOST'
      ) {
        continue;
      }
      let reason: 'past_close_date' | 'stale_stage' | null = null;
      let daysOverdueOrInactive = 0;

      if (deal.expectedCloseDate) {
        const closeDate = new Date(deal.expectedCloseDate);
        if (!Number.isNaN(closeDate.getTime()) && closeDate < window.dayStart) {
          reason = 'past_close_date';
          daysOverdueOrInactive = computeOverdueDays(deal.expectedCloseDate, now);
        }
      }

      if (!reason) {
        const lastUpdatedStr = deal.updatedAt || doc.updatedAt;
        if (lastUpdatedStr) {
          const lastUpdated = new Date(lastUpdatedStr);
          if (!Number.isNaN(lastUpdated.getTime()) && lastUpdated < sevenDaysAgo) {
            reason = 'stale_stage';
            daysOverdueOrInactive = computeOverdueDays(lastUpdatedStr, now);
          }
        }
      }

      if (reason) {
        dealsNeedingAttention.push({
          leadId: doc._id.toString(),
          dealId: deal.id,
          entityName: doc.entity_name || 'Unnamed Lead',
          dealTitle: deal.label || `Deal #${String(deal.id).slice(0, 8)}`,
          dealValue: deal.value,
          pipelineStage: deal.stageId || doc.kanbanColumn,
          expectedCloseDate: deal.expectedCloseDate,
          daysOverdueOrInactive,
          reason,
        });
      }
    }
  }

  // Sort: past close date first, then highest days overdue / inactive
  dealsNeedingAttention.sort((a, b) => {
    if (a.reason !== b.reason) {
      return a.reason === 'past_close_date' ? -1 : 1;
    }
    return b.daysOverdueOrInactive - a.daysOverdueOrInactive;
  });

  const limitedDeals = dealsNeedingAttention.slice(0, limit);

  return {
    date: window.dateStr,
    timezone: window.timezone,
    scope,
    counts: {
      total:
        cadenceTasks.length +
        overdueFollowUps.length +
        dueTodayFollowUps.length +
        limitedDeals.length,
      cadenceTasks: cadenceTasks.length,
      overdueFollowUps: overdueFollowUps.length,
      dueTodayFollowUps: dueTodayFollowUps.length,
      dealsNeedingAttention: limitedDeals.length,
    },
    cadenceTasks,
    overdueFollowUps,
    dueTodayFollowUps,
    dealsNeedingAttention: limitedDeals,
  };
}
