import { readFileSync } from 'fs';
import { join } from 'path';
import type { Db } from 'mongodb';
import {
  DEFAULT_DISCOVERY_INTERVAL_MINUTES,
  DEFAULT_ENRICHMENT_INTERVAL_MINUTES,
  isAutomatedResearchWrite,
  resolveLeadLastResearchedAt,
  type OperationTelemetry,
  type ResearchOperationType,
  type ResearchRunStatus,
  type WorkspaceResearchTelemetry,
} from './research-telemetry-shared';

export {
  DEFAULT_DISCOVERY_INTERVAL_MINUTES,
  DEFAULT_ENRICHMENT_INTERVAL_MINUTES,
  isAutomatedResearchWrite,
  resolveLeadLastResearchedAt,
  type OperationTelemetry,
  type ResearchOperationType,
  type ResearchRunStatus,
  type WorkspaceResearchTelemetry,
};

const TENANT_OPERATIONS_COLLECTION = 'tenant_operations';

function parseCronOrIntervalToMinutes(raw: unknown, fallback: number): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
    return Math.round(raw);
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const directNum = Number(trimmed);
    if (Number.isFinite(directNum) && directNum > 0) {
      return Math.round(directNum);
    }
    // Parse standard cron step patterns like "*/30 * * * *" or "0 */2 * * *" or "0 * * * *"
    const parts = trimmed.split(/\s+/);
    if (parts.length === 5) {
      const [minPart, hourPart] = parts;
      const stepMin = /^\*\/(\d+)$/.exec(minPart);
      if (stepMin && hourPart === '*') {
        return Math.max(1, parseInt(stepMin[1], 10));
      }
      const stepHour = /^\*\/(\d+)$/.exec(hourPart);
      if (/^\d+$/.test(minPart) && stepHour) {
        return Math.max(1, parseInt(stepHour[1], 10) * 60);
      }
      if (/^\d+$/.test(minPart) && hourPart === '*') {
        return 60;
      }
      if (/^\d+$/.test(minPart) && /^\d+$/.test(hourPart)) {
        return 1440;
      }
    }
  }
  return fallback > 0 ? null : null;
}

/**
 * Reads only the requested workspace's own entry from Agents/contentcreator/tenants.json
 * when present on disk (strictly scoped to `brand`, never reading other tenants).
 */
function readOwnTenantConfigSchedule(
  brand: string,
  operation: ResearchOperationType
): { enabled?: boolean; intervalMinutes?: number } | null {
  try {
    const tenantsPath = join(process.cwd(), '..', 'Agents', 'contentcreator', 'tenants.json');
    const raw = readFileSync(tenantsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    const ownEntry = parsed?.tenants?.[brand]?.[operation];
    if (!ownEntry || typeof ownEntry !== 'object') return null;

    const enabled = typeof ownEntry.enabled === 'boolean' ? ownEntry.enabled : undefined;
    const intervalCandidate =
      parseCronOrIntervalToMinutes(ownEntry.intervalMinutes, 0) ??
      parseCronOrIntervalToMinutes(ownEntry.interval_minutes, 0) ??
      parseCronOrIntervalToMinutes(ownEntry.schedule, 0) ??
      parseCronOrIntervalToMinutes(ownEntry.cron, 0) ??
      undefined;

    return { enabled, intervalMinutes: intervalCandidate };
  } catch {
    return null;
  }
}

export async function recordResearchTelemetryRun(
  db: Db,
  params: {
    brand: string;
    tenantId: string;
    operation: ResearchOperationType;
    status: 'succeeded' | 'failed';
    leadId?: string;
    entityName?: string;
    error?: string;
    intervalMinutes?: number;
    now?: Date;
  }
): Promise<void> {
  const nowIso = (params.now ?? new Date()).toISOString();
  const normalizedTenant = params.tenantId || params.brand;
  const $set: Record<string, any> = {
    lastRunAt: nowIso,
    lastRunStatus: params.status,
    lastError: params.status === 'failed' ? (params.error || 'Run failed') : null,
    updatedAt: nowIso,
  };
  if (params.leadId) $set.lastLeadId = params.leadId;
  if (params.entityName) $set.lastEntityName = params.entityName;
  if (typeof params.intervalMinutes === 'number' && Number.isFinite(params.intervalMinutes) && params.intervalMinutes > 0) {
    $set.intervalMinutes = Math.round(params.intervalMinutes);
  }

  const $inc: Record<string, number> =
    params.status === 'succeeded'
      ? { runsSucceededCount: 1 }
      : { runsFailedCount: 1 };

  await db.collection(TENANT_OPERATIONS_COLLECTION).updateOne(
    { brand: params.brand, tenantId: normalizedTenant, operation: params.operation },
    {
      $set,
      $inc,
      $setOnInsert: {
        brand: params.brand,
        tenantId: normalizedTenant,
        operation: params.operation,
        enabled: true,
      },
    },
    { upsert: true }
  );
}

function buildOperationTelemetry(
  brand: string,
  operation: ResearchOperationType,
  doc: Record<string, any> | undefined
): OperationTelemetry {
  const disk = readOwnTenantConfigSchedule(brand, operation);
  const defaultInterval =
    operation === 'discovery'
      ? DEFAULT_DISCOVERY_INTERVAL_MINUTES
      : DEFAULT_ENRICHMENT_INTERVAL_MINUTES;

  let intervalMinutes = defaultInterval;
  let intervalSource: OperationTelemetry['intervalSource'] = 'default';

  if (typeof doc?.intervalMinutes === 'number' && Number.isFinite(doc.intervalMinutes) && doc.intervalMinutes > 0) {
    intervalMinutes = Math.round(doc.intervalMinutes);
    intervalSource = 'mongodb';
  } else if (typeof disk?.intervalMinutes === 'number' && disk.intervalMinutes > 0) {
    intervalMinutes = disk.intervalMinutes;
    intervalSource = 'tenants_config';
  }

  const enabled =
    typeof doc?.enabled === 'boolean'
      ? doc.enabled
      : typeof disk?.enabled === 'boolean'
      ? disk.enabled
      : true;

  const rawStatus = doc?.lastRunStatus;
  const lastRunStatus: ResearchRunStatus =
    rawStatus === 'succeeded' || rawStatus === 'failed'
      ? rawStatus
      : doc?.lastRunAt
      ? 'succeeded'
      : 'never_run';

  return {
    operation,
    enabled,
    intervalMinutes,
    intervalSource,
    lastRunAt: typeof doc?.lastRunAt === 'string' ? doc.lastRunAt : null,
    lastRunStatus,
    lastError: typeof doc?.lastError === 'string' ? doc.lastError : null,
    lastLeadId: typeof doc?.lastLeadId === 'string' ? doc.lastLeadId : null,
    lastEntityName: typeof doc?.lastEntityName === 'string' ? doc.lastEntityName : null,
    runsSucceededCount: typeof doc?.runsSucceededCount === 'number' ? doc.runsSucceededCount : 0,
    runsFailedCount: typeof doc?.runsFailedCount === 'number' ? doc.runsFailedCount : 0,
    updatedAt: typeof doc?.updatedAt === 'string' ? doc.updatedAt : null,
  };
}

export async function getWorkspaceResearchTelemetry(
  db: Db,
  brand: string,
  tenantId?: string
): Promise<WorkspaceResearchTelemetry> {
  const effectiveTenant = tenantId && tenantId !== 'default' ? tenantId : brand;
  const docs = await db
    .collection(TENANT_OPERATIONS_COLLECTION)
    .find({
      brand,
      tenantId: { $in: Array.from(new Set([effectiveTenant, brand, 'default'])) },
    })
    .toArray();

  const pickBestDoc = (op: ResearchOperationType): Record<string, any> | undefined => {
    const matching = docs.filter((d: any) => d.operation === op);
    if (matching.length === 0) return undefined;
    return (
      matching.find((d: any) => typeof d.lastRunAt === 'string') ||
      matching.find((d: any) => d.tenantId === effectiveTenant) ||
      matching[0]
    );
  };

  return {
    brand,
    tenantId: effectiveTenant,
    discovery: buildOperationTelemetry(brand, 'discovery', pickBestDoc('discovery')),
    enrichment: buildOperationTelemetry(brand, 'enrichment', pickBestDoc('enrichment')),
  };
}
