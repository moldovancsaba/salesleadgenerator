// Multi-pipeline configuration, stage models, and pipeline-scoped deal validation (issue #235).
// Ingests CRM Handoff 02 & Handoff 09 into Sales Lead Generator:
// allows brands to configure multiple pipelines with custom stages, while keeping
// 100% backward compatibility for existing leads through the default 6-column pipeline.

import { COLUMNS } from '@/app/constants';

export type PipelineStage = {
  id: string;
  key: string;
  label: string;
  color: string;
  order: number;
  probability?: number;
  isWon?: boolean;
  isLost?: boolean;
  isAutoManaged?: boolean;
  description?: string;
};

export type Pipeline = {
  id: string;
  brand: string;
  tenantId?: string;
  name: string;
  description?: string;
  isDefault: boolean;
  stages: PipelineStage[];
  createdAt: string;
  updatedAt: string;
};

export type PipelineInput = Record<string, any>;

export const DEFAULT_PIPELINE_ID_PREFIX = 'default_';

export function makeDefaultPipelineId(brand: string): string {
  return `${DEFAULT_PIPELINE_ID_PREFIX}${brand.toLowerCase()}`;
}

export function isDefaultPipelineId(id: string, brand?: string): boolean {
  if (brand) {
    return id === makeDefaultPipelineId(brand) || id === 'default';
  }
  return id.startsWith(DEFAULT_PIPELINE_ID_PREFIX) || id === 'default';
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Returns the canonical default pipeline for a brand based on SLG's standard 6-column layout.
 */
export function getDefaultPipeline(brand: string, tenantId?: string): Pipeline {
  const brandClean = (brand || '').trim().toLowerCase();
  const stages: PipelineStage[] = COLUMNS.map((col, idx) => ({
    id: `stage_${col.key.toLowerCase()}`,
    key: col.key,
    label: col.label,
    color: col.color,
    order: idx,
    probability: col.key === 'WON' ? 100 : col.key === 'LOST' ? 0 : col.key === 'PROPOSAL' ? 50 : col.key === 'ENGAGED' ? 25 : undefined,
    isWon: col.key === 'WON',
    isLost: col.key === 'LOST',
    isAutoManaged: col.key === 'DISCOVERED' || col.key === 'QUALIFIED',
    description: col.description,
  }));

  const nowIso = '1970-01-01T00:00:00.000Z';

  return {
    id: makeDefaultPipelineId(brandClean),
    brand: brandClean,
    tenantId: tenantId || undefined,
    name: 'Default Pipeline',
    description: 'Standard sports sales pipeline (Discovered to Won/Lost)',
    isDefault: true,
    stages,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function sanitizePipelineStage(input: any, index: number): PipelineStage | null {
  if (!input || typeof input !== 'object') return null;

  const rawKey = typeof input.key === 'string' ? input.key.trim().toUpperCase() : '';
  const key = rawKey.replace(/[^A-Z0-9_-]/g, '');
  if (!key) return null;

  const rawLabel = typeof input.label === 'string' ? input.label.trim().slice(0, 100) : '';
  const label = rawLabel || key;

  const color = typeof input.color === 'string' && input.color.trim() ? input.color.trim().slice(0, 30) : 'gray';

  const rawOrder = Number(input.order);
  const order = Number.isFinite(rawOrder) ? rawOrder : index;

  let probability: number | undefined;
  if (input.probability !== undefined && input.probability !== null && input.probability !== '') {
    const rawProb = Number(input.probability);
    if (Number.isFinite(rawProb)) {
      probability = Math.max(0, Math.min(100, Math.round(rawProb)));
    }
  }

  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : makeId('stage');

  return {
    id,
    key,
    label,
    color,
    order,
    probability,
    isWon: input.isWon === true,
    isLost: input.isLost === true,
    isAutoManaged: input.isAutoManaged === true,
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 300) : undefined,
  };
}

export function sanitizePipeline(input: PipelineInput, existing?: Pipeline | null, now?: Date): Pipeline | null {
  if (!input || typeof input !== 'object') return null;

  const brand = typeof input.brand === 'string' ? input.brand.trim().toLowerCase() : existing?.brand || '';
  if (!brand) return null;

  const name = typeof input.name === 'string' ? input.name.trim().slice(0, 200) : existing?.name || '';
  if (!name) return null;

  const nowIso = (now ?? new Date()).toISOString();
  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : (existing?.id || makeId('pipe'));
  const createdAt = existing?.createdAt || (typeof input.createdAt === 'string' ? input.createdAt : nowIso);

  const rawStages = Array.isArray(input.stages) ? input.stages : existing?.stages || [];
  const seenKeys = new Set<string>();
  const sanitizedStages: PipelineStage[] = [];

  for (let i = 0; i < rawStages.length; i++) {
    const stage = sanitizePipelineStage(rawStages[i], i);
    if (stage && !seenKeys.has(stage.key)) {
      seenKeys.add(stage.key);
      sanitizedStages.push(stage);
    }
  }

  // A pipeline must have at least one stage
  if (sanitizedStages.length === 0) return null;

  // Sort stages by order
  sanitizedStages.sort((a, b) => a.order - b.order);

  // Normalize sequential orders
  sanitizedStages.forEach((st, idx) => {
    st.order = idx;
  });

  return {
    id,
    brand,
    tenantId: typeof input.tenantId === 'string' ? input.tenantId.trim() : existing?.tenantId,
    name,
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 500) : existing?.description,
    isDefault: existing ? existing.isDefault : input.isDefault === true,
    stages: sanitizedStages,
    createdAt,
    updatedAt: nowIso,
  };
}

/**
 * Validates a stage transition within the same pipeline.
 */
export function validateStageMove(
  pipeline: Pipeline,
  fromStageIdOrKey: string,
  toStageIdOrKey: string
): { valid: boolean; reason?: string } {
  if (!pipeline || !Array.isArray(pipeline.stages) || pipeline.stages.length === 0) {
    return { valid: false, reason: 'Invalid pipeline definition' };
  }

  const fromStage = pipeline.stages.find(
    (s) => s.id === fromStageIdOrKey || s.key === fromStageIdOrKey
  );
  if (!fromStage) {
    return { valid: false, reason: `Source stage '${fromStageIdOrKey}' not found in pipeline '${pipeline.name}'` };
  }

  const toStage = pipeline.stages.find(
    (s) => s.id === toStageIdOrKey || s.key === toStageIdOrKey
  );
  if (!toStage) {
    return { valid: false, reason: `Target stage '${toStageIdOrKey}' not found in pipeline '${pipeline.name}'` };
  }

  return { valid: true };
}

/**
 * Validates moving a deal from one pipeline to another, matching CRM invariant (Handoff 09).
 * Moving across pipelines requires an explicit target stage in the destination pipeline.
 */
export function validatePipelineMove(
  deal: { id: string; pipelineId?: string; stageId?: string },
  sourcePipeline: Pipeline,
  targetPipeline: Pipeline,
  targetStageIdOrKey: string
): { valid: boolean; reason?: string } {
  if (!deal || !deal.id) {
    return { valid: false, reason: 'Invalid deal' };
  }

  if (!targetPipeline || !Array.isArray(targetPipeline.stages) || targetPipeline.stages.length === 0) {
    return { valid: false, reason: 'Invalid destination pipeline' };
  }

  const targetStage = targetPipeline.stages.find(
    (s) => s.id === targetStageIdOrKey || s.key === targetStageIdOrKey
  );
  if (!targetStage) {
    return {
      valid: false,
      reason: `Target stage '${targetStageIdOrKey}' does not exist in destination pipeline '${targetPipeline.name}'`,
    };
  }

  return { valid: true };
}

/**
 * Deleting a pipeline is refused if it is the default pipeline or if active deals exist.
 * Preserves CRM invariant: `deals.pipeline_id` is ON DELETE RESTRICT.
 */
export function canDeletePipeline(
  pipeline: Pipeline,
  activeDealCount: number
): { canDelete: boolean; reason?: string } {
  if (!pipeline) {
    return { canDelete: false, reason: 'Pipeline not found' };
  }

  if (pipeline.isDefault) {
    return { canDelete: false, reason: 'The default pipeline cannot be deleted' };
  }

  if (activeDealCount > 0) {
    return {
      canDelete: false,
      reason: `Cannot delete pipeline '${pipeline.name}' because ${activeDealCount} active deal(s) belong to it`,
    };
  }

  return { canDelete: true };
}

/**
 * Deleting a stage is refused if deals exist in that stage or if it is the only stage in the pipeline.
 */
export function canDeleteStage(
  pipeline: Pipeline,
  stageIdOrKey: string,
  activeDealCount: number
): { canDelete: boolean; reason?: string } {
  if (!pipeline || !Array.isArray(pipeline.stages)) {
    return { canDelete: false, reason: 'Pipeline not found' };
  }

  if (pipeline.stages.length <= 1) {
    return { canDelete: false, reason: 'A pipeline must have at least one stage' };
  }

  const stage = pipeline.stages.find((s) => s.id === stageIdOrKey || s.key === stageIdOrKey);
  if (!stage) {
    return { canDelete: false, reason: `Stage '${stageIdOrKey}' not found in pipeline` };
  }

  if (activeDealCount > 0) {
    return {
      canDelete: false,
      reason: `Cannot delete stage '${stage.label}' because ${activeDealCount} deal(s) are currently in this stage`,
    };
  }

  return { canDelete: true };
}
