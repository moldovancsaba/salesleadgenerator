export type ResearchOperationType = 'discovery' | 'enrichment';
export type ResearchRunStatus = 'succeeded' | 'failed' | 'never_run';

export type OperationTelemetry = {
  operation: ResearchOperationType;
  enabled: boolean;
  intervalMinutes: number;
  intervalSource: 'mongodb' | 'tenants_config' | 'default';
  lastRunAt: string | null;
  lastRunStatus: ResearchRunStatus;
  lastError: string | null;
  lastLeadId: string | null;
  lastEntityName: string | null;
  runsSucceededCount: number;
  runsFailedCount: number;
  updatedAt: string | null;
};

export type WorkspaceResearchTelemetry = {
  brand: string;
  tenantId: string;
  discovery: OperationTelemetry;
  enrichment: OperationTelemetry;
};

export const DEFAULT_DISCOVERY_INTERVAL_MINUTES = 60;
export const DEFAULT_ENRICHMENT_INTERVAL_MINUTES = 30;

export function isAutomatedResearchWrite(params: {
  hasMachineApiKey: boolean;
  source?: string | null;
}): boolean {
  if (params.hasMachineApiKey) return true;
  const s = (params.source || '').trim().toLowerCase();
  if (!s) return false;
  return (
    s.includes('research') ||
    s.includes('discovery') ||
    s.includes('enrich') ||
    s.includes('cron') ||
    s.includes('agent') ||
    s.includes('openclaw')
  );
}

export function resolveLeadLastResearchedAt(lead: {
  lastResearchedAt?: string | null;
  fieldVerifications?: Array<{ verifiedAt?: string | null }> | null;
  contacts?: Array<{ lastVerifiedAt?: string | null }> | null;
  source?: string | null;
  createdAt?: string | Date | null;
}): string | null {
  if (typeof lead.lastResearchedAt === 'string' && lead.lastResearchedAt.trim()) {
    return lead.lastResearchedAt;
  }

  let latestMs = 0;
  let latestIso: string | null = null;

  if (Array.isArray(lead.fieldVerifications)) {
    for (const fv of lead.fieldVerifications) {
      if (typeof fv?.verifiedAt === 'string') {
        const ms = new Date(fv.verifiedAt).getTime();
        if (Number.isFinite(ms) && ms > latestMs) {
          latestMs = ms;
          latestIso = fv.verifiedAt;
        }
      }
    }
  }

  if (Array.isArray(lead.contacts)) {
    for (const c of lead.contacts) {
      if (typeof c?.lastVerifiedAt === 'string') {
        const ms = new Date(c.lastVerifiedAt).getTime();
        if (Number.isFinite(ms) && ms > latestMs) {
          latestMs = ms;
          latestIso = c.lastVerifiedAt;
        }
      }
    }
  }

  if (latestIso) return latestIso;

  if (isAutomatedResearchWrite({ hasMachineApiKey: false, source: lead.source }) && lead.createdAt) {
    const d = lead.createdAt instanceof Date ? lead.createdAt : new Date(lead.createdAt);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  return null;
}
