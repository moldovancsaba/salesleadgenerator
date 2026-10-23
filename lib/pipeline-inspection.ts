// Pipeline Inspection & Deal Movement Waterfall (issue #277) — pure,
// framework/DB-free classification of pipeline movement over a rolling window.

import { computeStaleness, DEFAULT_STALE_THRESHOLDS, type KanbanColumn } from './stale-deal';
import { sumDeals, type Deal } from './deals';

export type InspectionWindowDays = 7 | 14 | 30 | 90;
export const INSPECTION_WINDOWS: InspectionWindowDays[] = [7, 14, 30, 90];

export type InspectionMovementBucket =
  | 'new'
  | 'advanced'
  | 'regressed'
  | 'won'
  | 'lost'
  | 'slipped';

export type InspectionLeadInput = {
  _id: string;
  entity_name: string;
  kanbanColumn: string;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  deals?: Deal[];
  ticketSizeEstimate?: {
    expected?: number;
    currency?: string;
  } | null;
  estimatedTicketSize?: number;
  actualDealValueUsd?: number;
  assignedToEmail?: string;
};

export type InspectionOutcomeLog = {
  leadId: string;
  createdAt: string | Date;
  beforeState?: { kanbanColumn?: string } | null;
  afterState?: { kanbanColumn?: string } | null;
};

export type InspectionLeadRow = {
  leadId: string;
  entityName: string;
  bucket: InspectionMovementBucket;
  fromStage: string | null;
  toStage: string;
  value: number;
  currency: string;
  assignedToEmail?: string;
  movedAt: string;
  staleDays?: number;
};

export type InspectionBucketSummary = {
  bucket: InspectionMovementBucket;
  label: string;
  count: number;
  totalValue: number;
};

export type PipelineInspectionReport = {
  windowDays: InspectionWindowDays;
  windowStartIso: string;
  computedAt: string;
  buckets: Record<InspectionMovementBucket, InspectionBucketSummary>;
  movements: InspectionLeadRow[];
  netPipelineDeltaValue: number;
  netPipelineDeltaCount: number;
};

const STAGE_ORDER: Record<string, number> = {
  BACKLOG: 0,
  DISCOVERED: 1,
  QUALIFIED: 2,
  ENGAGED: 3,
  PROPOSAL: 4,
  WON: 5,
  LOST: -1,
};

export const BUCKET_LABELS: Record<InspectionMovementBucket, string> = {
  new: 'New Pipeline',
  advanced: 'Stage Advanced',
  regressed: 'Stage Regressed',
  won: 'Closed Won',
  lost: 'Closed Lost',
  slipped: 'Slipped / Stale',
};

export function resolveLeadCommercialValue(
  lead: InspectionLeadInput,
  defaultCurrency: string = 'EUR'
): { value: number; currency: string } {
  if (Array.isArray(lead.deals) && lead.deals.length > 0) {
    const dealSum = sumDeals(lead.deals);
    if (dealSum > 0) {
      return { value: dealSum, currency: lead.deals[0].currency || defaultCurrency };
    }
  }
  if (typeof lead.actualDealValueUsd === 'number' && lead.actualDealValueUsd > 0) {
    return { value: lead.actualDealValueUsd, currency: 'USD' };
  }
  if (
    lead.ticketSizeEstimate &&
    typeof lead.ticketSizeEstimate.expected === 'number' &&
    lead.ticketSizeEstimate.expected > 0
  ) {
    return {
      value: lead.ticketSizeEstimate.expected,
      currency: lead.ticketSizeEstimate.currency || defaultCurrency,
    };
  }
  if (typeof lead.estimatedTicketSize === 'number' && lead.estimatedTicketSize > 0) {
    return { value: lead.estimatedTicketSize, currency: defaultCurrency };
  }
  return { value: 0, currency: defaultCurrency };
}

function getStageRank(stage: string | undefined | null): number {
  if (!stage) return 1;
  return STAGE_ORDER[stage] ?? 2;
}

export function computePipelineInspection(
  leads: InspectionLeadInput[],
  logs: InspectionOutcomeLog[],
  windowDays: InspectionWindowDays = 30,
  now: Date = new Date(),
  defaultCurrency: string = 'EUR'
): PipelineInspectionReport {
  const windowStartMs = now.getTime() - windowDays * 86_400_000;
  const windowStartIso = new Date(windowStartMs).toISOString();

  const buckets: Record<InspectionMovementBucket, InspectionBucketSummary> = {
    new: { bucket: 'new', label: BUCKET_LABELS.new, count: 0, totalValue: 0 },
    advanced: { bucket: 'advanced', label: BUCKET_LABELS.advanced, count: 0, totalValue: 0 },
    regressed: { bucket: 'regressed', label: BUCKET_LABELS.regressed, count: 0, totalValue: 0 },
    won: { bucket: 'won', label: BUCKET_LABELS.won, count: 0, totalValue: 0 },
    lost: { bucket: 'lost', label: BUCKET_LABELS.lost, count: 0, totalValue: 0 },
    slipped: { bucket: 'slipped', label: BUCKET_LABELS.slipped, count: 0, totalValue: 0 },
  };

  // Group logs in window by leadId, sorted chronologically
  const logsByLead = new Map<string, InspectionOutcomeLog[]>();
  for (const log of logs) {
    if (!log || !log.leadId || !log.createdAt) continue;
    const ts = new Date(log.createdAt).getTime();
    if (Number.isNaN(ts) || ts < windowStartMs) continue;
    const before = log.beforeState?.kanbanColumn;
    const after = log.afterState?.kanbanColumn;
    if (!after || before === after) continue;
    const list = logsByLead.get(log.leadId) || [];
    list.push(log);
    logsByLead.set(log.leadId, list);
  }

  for (const list of logsByLead.values()) {
    list.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const movements: InspectionLeadRow[] = [];

  for (const lead of leads) {
    const leadId = String(lead._id);
    const { value, currency } = resolveLeadCommercialValue(lead, defaultCurrency);
    const createdMs = lead.createdAt ? new Date(lead.createdAt).getTime() : NaN;
    const isCreatedInWindow = !Number.isNaN(createdMs) && createdMs >= windowStartMs;
    const leadLogs = logsByLead.get(leadId) || [];

    const firstTransition = leadLogs[0];
    const lastTransition = leadLogs[leadLogs.length - 1];
    const currentStage = lead.kanbanColumn || 'DISCOVERED';

    // Check if deal closed WON or LOST in window
    if (lastTransition && currentStage === 'WON') {
      const row: InspectionLeadRow = {
        leadId,
        entityName: lead.entity_name || 'Unnamed Lead',
        bucket: 'won',
        fromStage: firstTransition?.beforeState?.kanbanColumn || null,
        toStage: 'WON',
        value,
        currency,
        assignedToEmail: lead.assignedToEmail,
        movedAt: new Date(lastTransition.createdAt).toISOString(),
      };
      movements.push(row);
      buckets.won.count += 1;
      buckets.won.totalValue += value;
      continue;
    }

    if (lastTransition && currentStage === 'LOST') {
      const row: InspectionLeadRow = {
        leadId,
        entityName: lead.entity_name || 'Unnamed Lead',
        bucket: 'lost',
        fromStage: firstTransition?.beforeState?.kanbanColumn || null,
        toStage: 'LOST',
        value,
        currency,
        assignedToEmail: lead.assignedToEmail,
        movedAt: new Date(lastTransition.createdAt).toISOString(),
      };
      movements.push(row);
      buckets.lost.count += 1;
      buckets.lost.totalValue += value;
      continue;
    }

    if (isCreatedInWindow && currentStage !== 'LOST') {
      const row: InspectionLeadRow = {
        leadId,
        entityName: lead.entity_name || 'Unnamed Lead',
        bucket: 'new',
        fromStage: null,
        toStage: currentStage,
        value,
        currency,
        assignedToEmail: lead.assignedToEmail,
        movedAt: new Date(createdMs).toISOString(),
      };
      movements.push(row);
      buckets.new.count += 1;
      buckets.new.totalValue += value;
      continue;
    }

    if (firstTransition && lastTransition) {
      const startStage = firstTransition.beforeState?.kanbanColumn || currentStage;
      const endStage = lastTransition.afterState?.kanbanColumn || currentStage;
      const startRank = getStageRank(startStage);
      const endRank = getStageRank(endStage);

      if (endRank > startRank) {
        const row: InspectionLeadRow = {
          leadId,
          entityName: lead.entity_name || 'Unnamed Lead',
          bucket: 'advanced',
          fromStage: startStage,
          toStage: endStage,
          value,
          currency,
          assignedToEmail: lead.assignedToEmail,
          movedAt: new Date(lastTransition.createdAt).toISOString(),
        };
        movements.push(row);
        buckets.advanced.count += 1;
        buckets.advanced.totalValue += value;
        continue;
      }

      if (endRank < startRank) {
        const row: InspectionLeadRow = {
          leadId,
          entityName: lead.entity_name || 'Unnamed Lead',
          bucket: 'regressed',
          fromStage: startStage,
          toStage: endStage,
          value,
          currency,
          assignedToEmail: lead.assignedToEmail,
          movedAt: new Date(lastTransition.createdAt).toISOString(),
        };
        movements.push(row);
        buckets.regressed.count += 1;
        buckets.regressed.totalValue += value;
        continue;
      }
    }

    // Check if active pipeline deal has slipped / gone stale
    if (currentStage !== 'WON' && currentStage !== 'LOST' && currentStage !== 'BACKLOG') {
      const staleness = computeStaleness(
        {
          kanbanColumn: currentStage as KanbanColumn,
          updatedAt: lead.updatedAt ? new Date(lead.updatedAt).toISOString() : undefined,
        },
        DEFAULT_STALE_THRESHOLDS,
        now
      );
      if (staleness) {
        const row: InspectionLeadRow = {
          leadId,
          entityName: lead.entity_name || 'Unnamed Lead',
          bucket: 'slipped',
          fromStage: currentStage,
          toStage: currentStage,
          value,
          currency,
          assignedToEmail: lead.assignedToEmail,
          movedAt: lead.updatedAt ? new Date(lead.updatedAt).toISOString() : now.toISOString(),
          staleDays: staleness.daysSince,
        };
        movements.push(row);
        buckets.slipped.count += 1;
        buckets.slipped.totalValue += value;
      }
    }
  }

  movements.sort((a, b) => b.value - a.value || new Date(b.movedAt).getTime() - new Date(a.movedAt).getTime());

  const netPipelineDeltaValue =
    buckets.new.totalValue +
    buckets.advanced.totalValue -
    buckets.lost.totalValue -
    buckets.regressed.totalValue;
  const netPipelineDeltaCount =
    buckets.new.count + buckets.advanced.count - buckets.lost.count - buckets.regressed.count;

  return {
    windowDays,
    windowStartIso,
    computedAt: now.toISOString(),
    buckets,
    movements: movements.slice(0, 100),
    netPipelineDeltaValue,
    netPipelineDeltaCount,
  };
}
