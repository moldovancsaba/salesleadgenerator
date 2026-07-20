import type { MantineColor } from '@mantine/core';
import type { SemanticTone } from '../theme/semantic';

/**
 * Semantic tone mapping to Mantine colors
 * Single source of truth for all Mantine color mappings
 * Aligned with app/theme/semantic.ts tone definitions
 */
export const semanticToneToMantineColor = (tone: SemanticTone): MantineColor => {
  const mapping: Record<SemanticTone, MantineColor> = {
    ingress: 'blue',
    synthesis: 'indigo',
    knowmore: 'green',
    strategy: 'violet',
    checklist: 'orange',
    tactical: 'teal',
    review: 'grape',
    neutral: 'gray',
  };
  return mapping[tone] || 'gray';
};

/**
 * Quality status to Mantine color
 * Maps quality states to appropriate semantic tones
 */
export const qualityStatusToMantineColor = (status: string): MantineColor => {
  const mapping: Record<string, MantineColor> = {
    VERIFIED: 'grape',    // review tone
    CHECKED: 'violet',    // strategy tone
    DRAFT: 'orange',      // checklist tone
  };
  return mapping[status] || 'gray';
};

/**
 * Region to Mantine color
 * Maps regions to appropriate semantic tones
 */
export const regionToMantineColor = (region: string): MantineColor => {
  const mapping: Record<string, MantineColor> = {
    US: 'blue',           // ingress tone
    CEE: 'indigo',        // synthesis tone
    MENA: 'teal',         // tactical tone
  };
  return mapping[region] || 'gray';
};

/**
 * ICE score level to Mantine color
 * Maps ICE score thresholds to appropriate semantic tones
 */
export const iceScoreToMantineColor = (score: number): MantineColor => {
  if (score >= 720) return 'grape';   // review tone - high confidence
  if (score >= 480) return 'violet';  // strategy tone - medium confidence
  if (score >= 200) return 'orange';  // checklist tone - low confidence
  return 'gray';                      // neutral - minimal data
};
