import { describe, it, expect } from 'vitest';
import {
  getDefaultPipeline,
  sanitizePipelineStage,
  sanitizePipeline,
  validateStageMove,
  validatePipelineMove,
  canDeletePipeline,
  canDeleteStage,
} from '../../lib/pipelines';
import type { Pipeline } from '../../lib/pipelines';

const NOW = new Date('2026-10-12T00:00:00.000Z');

describe('getDefaultPipeline', () => {
  it('generates the canonical 6-column pipeline for a brand', () => {
    const pipeline = getDefaultPipeline('cogmap');
    expect(pipeline.brand).toBe('cogmap');
    expect(pipeline.isDefault).toBe(true);
    expect(pipeline.stages).toHaveLength(6);
    expect(pipeline.stages.map((s) => s.key)).toEqual([
      'DISCOVERED',
      'QUALIFIED',
      'ENGAGED',
      'PROPOSAL',
      'WON',
      'LOST',
    ]);
    expect(pipeline.stages.find((s) => s.key === 'WON')?.isWon).toBe(true);
    expect(pipeline.stages.find((s) => s.key === 'LOST')?.isLost).toBe(true);
    expect(pipeline.stages.find((s) => s.key === 'DISCOVERED')?.isAutoManaged).toBe(true);
  });
});

describe('sanitizePipelineStage', () => {
  it('sanitizes valid stage attributes', () => {
    const stage = sanitizePipelineStage(
      { key: 'discovery_call', label: 'Discovery Call', color: 'blue', probability: 30 },
      0
    );
    expect(stage).not.toBeNull();
    expect(stage?.key).toBe('DISCOVERY_CALL');
    expect(stage?.label).toBe('Discovery Call');
    expect(stage?.color).toBe('blue');
    expect(stage?.probability).toBe(30);
  });

  it('clamps probability to [0, 100]', () => {
    const high = sanitizePipelineStage({ key: 'st1', probability: 150 }, 0);
    expect(high?.probability).toBe(100);

    const low = sanitizePipelineStage({ key: 'st2', probability: -20 }, 1);
    expect(low?.probability).toBe(0);
  });

  it('rejects empty or invalid keys', () => {
    expect(sanitizePipelineStage({ key: '' }, 0)).toBeNull();
    expect(sanitizePipelineStage({ key: '   ' }, 0)).toBeNull();
    expect(sanitizePipelineStage(null, 0)).toBeNull();
  });
});

describe('sanitizePipeline', () => {
  it('sanitizes a complete pipeline and normalizes stage ordering', () => {
    const sanitized = sanitizePipeline(
      {
        brand: 'seyu',
        name: 'Enterprise Partnerships',
        stages: [
          { key: 'STAGE_B', order: 5 },
          { key: 'STAGE_A', order: 1 },
        ],
      },
      null,
      NOW
    );

    expect(sanitized).not.toBeNull();
    expect(sanitized?.brand).toBe('seyu');
    expect(sanitized?.name).toBe('Enterprise Partnerships');
    expect(sanitized?.stages).toHaveLength(2);
    expect(sanitized?.stages[0].key).toBe('STAGE_A');
    expect(sanitized?.stages[0].order).toBe(0);
    expect(sanitized?.stages[1].key).toBe('STAGE_B');
    expect(sanitized?.stages[1].order).toBe(1);
    expect(sanitized?.createdAt).toBe(NOW.toISOString());
  });

  it('rejects pipeline without brand or name', () => {
    expect(sanitizePipeline({ name: 'Test' }, null, NOW)).toBeNull();
    expect(sanitizePipeline({ brand: 'cogmap' }, null, NOW)).toBeNull();
  });

  it('rejects pipeline with empty stages array', () => {
    expect(sanitizePipeline({ brand: 'cogmap', name: 'Empty', stages: [] }, null, NOW)).toBeNull();
  });

  it('deduplicates stages with identical keys', () => {
    const sanitized = sanitizePipeline(
      {
        brand: 'dvsc',
        name: 'Sponsorships',
        stages: [
          { key: 'PITCH', label: 'Pitch 1' },
          { key: 'PITCH', label: 'Pitch Duplicate' },
        ],
      },
      null,
      NOW
    );

    expect(sanitized?.stages).toHaveLength(1);
    expect(sanitized?.stages[0].label).toBe('Pitch 1');
  });
});

describe('validateStageMove', () => {
  const pipeline = getDefaultPipeline('cogmap');

  it('allows transition between existing stages', () => {
    const res = validateStageMove(pipeline, 'ENGAGED', 'PROPOSAL');
    expect(res.valid).toBe(true);
  });

  it('rejects transition from non-existent stage', () => {
    const res = validateStageMove(pipeline, 'UNKNOWN_STAGE', 'PROPOSAL');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Source stage');
  });

  it('rejects transition to non-existent stage', () => {
    const res = validateStageMove(pipeline, 'ENGAGED', 'UNKNOWN_TARGET');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('Target stage');
  });
});

describe('validatePipelineMove', () => {
  const sourcePipe = getDefaultPipeline('cogmap');
  const targetPipe: Pipeline = {
    id: 'pipe_custom',
    brand: 'cogmap',
    name: 'Custom Pipeline',
    isDefault: false,
    stages: [
      { id: 's1', key: 'STAGE_1', label: 'Stage 1', color: 'blue', order: 0 },
      { id: 's2', key: 'STAGE_2', label: 'Stage 2', color: 'green', order: 1 },
    ],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };

  it('allows moving deal when target stage exists in destination pipeline', () => {
    const deal = { id: 'deal_1', pipelineId: sourcePipe.id, stageId: 'stage_engaged' };
    const res = validatePipelineMove(deal, sourcePipe, targetPipe, 's2');
    expect(res.valid).toBe(true);
  });

  it('rejects moving deal when target stage does not exist in destination pipeline', () => {
    const deal = { id: 'deal_1', pipelineId: sourcePipe.id, stageId: 'stage_engaged' };
    const res = validatePipelineMove(deal, sourcePipe, targetPipe, 'non_existent_stage');
    expect(res.valid).toBe(false);
    expect(res.reason).toContain('does not exist in destination pipeline');
  });
});

describe('canDeletePipeline', () => {
  const defaultPipe = getDefaultPipeline('cogmap');
  const customPipe: Pipeline = {
    id: 'pipe_2',
    brand: 'cogmap',
    name: 'Secondary Pipeline',
    isDefault: false,
    stages: [{ id: 'st1', key: 'ST1', label: 'St 1', color: 'gray', order: 0 }],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };

  it('forbids deleting the default pipeline', () => {
    const res = canDeletePipeline(defaultPipe, 0);
    expect(res.canDelete).toBe(false);
    expect(res.reason).toContain('default pipeline cannot be deleted');
  });

  it('forbids deleting a pipeline with active deals', () => {
    const res = canDeletePipeline(customPipe, 5);
    expect(res.canDelete).toBe(false);
    expect(res.reason).toContain('active deal(s) belong to it');
  });

  it('allows deleting an unpopulated non-default pipeline', () => {
    const res = canDeletePipeline(customPipe, 0);
    expect(res.canDelete).toBe(true);
  });
});

describe('canDeleteStage', () => {
  const pipeline = getDefaultPipeline('cogmap');

  it('forbids deleting the only stage in a pipeline', () => {
    const singleStagePipe: Pipeline = {
      ...pipeline,
      stages: [pipeline.stages[0]],
    };
    const res = canDeleteStage(singleStagePipe, pipeline.stages[0].key, 0);
    expect(res.canDelete).toBe(false);
    expect(res.reason).toContain('at least one stage');
  });

  it('forbids deleting a stage with active deals', () => {
    const res = canDeleteStage(pipeline, 'ENGAGED', 3);
    expect(res.canDelete).toBe(false);
    expect(res.reason).toContain('deal(s) are currently in this stage');
  });

  it('allows deleting a stage with no active deals', () => {
    const res = canDeleteStage(pipeline, 'ENGAGED', 0);
    expect(res.canDelete).toBe(true);
  });
});
