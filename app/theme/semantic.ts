export type SemanticTone = 'ingress' | 'synthesis' | 'tactical' | 'strategy' | 'review' | 'checklist' | 'neutral';

export const ICE_TONES: Record<number, SemanticTone> = {
  0: 'ingress',
  1: 'ingress',
  2: 'synthesis',
  3: 'tactical',
  4: 'strategy',
  5: 'review',
};

export const QUALITY_TONES: Record<string, SemanticTone> = {
  DRAFT: 'checklist',
  CHECKED: 'strategy',
  VERIFIED: 'review',
};

export const REGION_TONES: Record<string, SemanticTone> = {
  US: 'ingress',
  CEE: 'synthesis',
  MENA: 'tactical',
};

export function iceTone(score: number): SemanticTone {
  if (score >= 700) return 'review';
  if (score >= 480) return 'tactical';
  if (score >= 200) return 'strategy';
  return 'ingress';
}

export function qualityTone(quality: string): SemanticTone {
  return QUALITY_TONES[quality] || 'checklist';
}

export function regionTone(region: string): SemanticTone {
  return REGION_TONES[region] || 'neutral';
}
