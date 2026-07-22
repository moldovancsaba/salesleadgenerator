import type { Db } from 'mongodb';

export const DEFAULT_PIPELINE_WEIGHTS: Record<string, number> = {
  DISCOVERED: 0.01,
  QUALIFIED: 0.05,
  ENGAGED: 0.10,
  PROPOSAL: 0.25,
  WON: 1.0,
  LOST: 0.0,
};

export async function getPipelineWeights(db: Db): Promise<Record<string, number>> {
  try {
    const doc = await db.collection('settings').findOne({ key: 'pipeline_weights' });
    return doc?.weights || DEFAULT_PIPELINE_WEIGHTS;
  } catch {
    return DEFAULT_PIPELINE_WEIGHTS;
  }
}
