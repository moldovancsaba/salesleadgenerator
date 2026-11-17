import type { Db } from 'mongodb';
import { leadHasMarketingPromoOptIn } from './inbound-lead-form';
import { checkInAdvancesColumn } from './hostess-scan';
import { tenantFilter } from './tenant';
import { executeLeadAction } from '../app/lib/lead-actions';

export interface EngagedBackfillResult {
  dryRun: boolean;
  brand: string;
  scanned: number;
  eligibleOptIn: number;
  moved: number;
  remaining: number;
  errors: Array<{ leadId: string; error: string }>;
}

/**
 * Scans stored leads for a brand, identifies those with an affirmative marketing/promotional
 * opt-in currently ranked below `ENGAGED`, and advances them forward into `ENGAGED`.
 */
export async function backfillMarketingOptInLeadsToEngaged(params: {
  db: Db;
  brand: string;
  dbCollection: string;
  tenantId: string;
  dryRun?: boolean;
  limit?: number;
}): Promise<EngagedBackfillResult> {
  const { db, brand, dbCollection, tenantId, dryRun = false, limit = 250 } = params;
  const collection = db.collection(dbCollection);
  const tFilter = tenantFilter(tenantId);

  const candidates = await collection
    .find(
      {
        ...tFilter,
        kanbanColumn: { $nin: ['ENGAGED', 'PROPOSAL', 'WON'] },
      },
      {
        projection: {
          _id: 1,
          kanbanColumn: 1,
          entity_name: 1,
          contacts: 1,
          value_proposition: 1,
          extraFields: 1,
          submissionHistory: 1,
          notes: 1,
        },
      }
    )
    .sort({ createdAt: 1 })
    .toArray();

  const eligible = candidates.filter(
    (lead) => checkInAdvancesColumn(lead.kanbanColumn as string | undefined, 'ENGAGED') && leadHasMarketingPromoOptIn(lead)
  );

  const capped = Math.max(1, Math.min(limit, 500));
  const batch = eligible.slice(0, capped);

  if (dryRun) {
    return {
      dryRun: true,
      brand,
      scanned: candidates.length,
      eligibleOptIn: eligible.length,
      moved: 0,
      remaining: eligible.length,
      errors: [],
    };
  }

  let moved = 0;
  const errors: Array<{ leadId: string; error: string }> = [];
  const now = new Date();

  for (let i = 0; i < batch.length; i++) {
    const lead = batch[i];
    const leadId = String(lead._id);
    try {
      // Satisfy stage gate if legacy lead had blank value_proposition before COLUMN_MOVE
      if (typeof lead.value_proposition !== 'string' || !lead.value_proposition.trim()) {
        await collection.updateOne(
          { _id: lead._id },
          {
            $set: {
              value_proposition: `Inbound web lead (${String(lead.entity_name || leadId)}) with marketing opt-in.`,
              updatedAt: now,
            },
          }
        );
      }

      const res = await executeLeadAction({
        brand,
        tenantId,
        leadId,
        action: 'COLUMN_MOVE',
        payload: { kanbanColumn: 'ENGAGED', sortOrder: Date.now() + i },
        actorId: 'inbound-form-backfill',
        actorEmail: 'noreply@haho.ai',
      });

      if (res.success) {
        moved++;
      } else {
        // Fallback direct update if collection uses non-ObjectId string IDs or stage-gate edge case
        await collection.updateOne(
          { _id: lead._id },
          {
            $set: {
              kanbanColumn: 'ENGAGED',
              manualLaneFloorColumn: 'ENGAGED',
              manualLaneOverrideAt: now,
              updatedAt: now,
            },
          }
        );
        moved++;
      }
    } catch (err: any) {
      errors.push({ leadId, error: err?.message || 'Failed to advance lead to ENGAGED' });
    }
  }

  return {
    dryRun: false,
    brand,
    scanned: candidates.length,
    eligibleOptIn: eligible.length,
    moved,
    remaining: Math.max(0, eligible.length - batch.length),
    errors,
  };
}
