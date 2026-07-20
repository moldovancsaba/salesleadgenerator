import type { SemanticTone } from './semantic';

/**
 * Maps semantic tone names to Mantine color values
 * Use this function only in Mantine component color props
 */
export const semanticToneToMantineColor = (tone: SemanticTone): string => {
  const colorMap: Record<SemanticTone, string> = {
    ingress: 'blue',
    synthesis: 'indigo',
    knowmore: 'green',
    strategy: 'violet',
    checklist: 'orange',
    tactical: 'teal',
    review: 'grape',
    neutral: 'gray',
  };
  return colorMap[tone] || 'gray';
};

/**
 * Maps quality status to semantic tone
 */
export const qualityTone = (status: 'VERIFIED' | 'CHECKED' | 'DRAFT'): SemanticTone => {
  const toneMap: Record<string, SemanticTone> = {
    VERIFIED: 'review',
    CHECKED: 'tactical',
    DRAFT: 'neutral',
  };
  return toneMap[status] || 'neutral';
};

/**
 * Maps ICE score to semantic tone based on thresholds
 */
export const iceTone = (score: number): SemanticTone => {
  if (score >= 720) return 'review';
  if (score >= 480) return 'tactical';
  return 'neutral';
};

/**
 * Maps region to semantic tone
 */
export const regionTone = (region: 'US' | 'CEE' | 'MENA'): SemanticTone => {
  const toneMap: Record<string, SemanticTone> = {
    US: 'ingress',
    CEE: 'synthesis',
    MENA: 'checklist',
  };
  return toneMap[region] || 'neutral';
};
