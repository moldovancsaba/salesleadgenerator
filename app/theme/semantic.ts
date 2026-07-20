/**
 * GDS Semantic Theme Constants for SLG
 * 
 * Maps domain concepts to GDS semantic tokens
 * No hardcoded colors — only semantic tone references
 */

export const semanticTones = {
  ingress: 'ingress',           // Entry points, navigation
  synthesis: 'synthesis',       // Data aggregation, analysis
  knowmore: 'knowmore',         // Knowledge, insights
  strategy: 'strategy',         // Strategic planning, goals
  checklist: 'checklist',       // Tasks, execution tracking
  tactical: 'tactical',         // Operational actions
  review: 'review',             // Decision gates, approvals
  neutral: 'neutral',           // Default state
} as const;

export type SemanticTone = typeof semanticTones[keyof typeof semanticTones];

/**
 * Map pipeline stages to semantic tones
 */
export const pipelineStageTone: Record<string, SemanticTone> = {
  DISCOVERED: 'ingress',
  QUALIFIED: 'synthesis',
  ENGAGED: 'tactical',
  PROPOSAL: 'strategy',
  WON: 'review',
  LOST: 'neutral',
};

/**
 * Map lead quality to semantic tones
 */
export const qualityTone: Record<string, SemanticTone> = {
  VERIFIED: 'review',
  CHECKED: 'strategy',
  DRAFT: 'checklist',
};

/**
 * Map region to semantic tones
 */
export const regionTone: Record<string, SemanticTone> = {
  US: 'ingress',
  CEE: 'synthesis',
  MENA: 'tactical',
};

/**
 * Map ICE score levels to semantic tones
 */
export const iceTone: (score: number) => SemanticTone = (score) => {
  if (score >= 720) return 'review';      // High confidence
  if (score >= 480) return 'strategy';    // Medium confidence
  if (score >= 200) return 'checklist';   // Low confidence
  return 'neutral';                       // Minimal data
};
