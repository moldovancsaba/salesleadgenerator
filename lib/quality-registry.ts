/**
 * Quality Registry - Enforces quality ceilings and validation rules
 * Based on Check architecture quality engine principles
 * 
 * Imported by: app/api/leads/route.ts (MODIFY action)
 */

export interface QualityDimensions {
  evidenceQuality: number;
  linguisticQuality: number;
  actionabilityQuality: number;
  strategicValue: number;
}

export interface QualityValidation {
  valid: boolean;
  error?: string;
  ceiling?: string;
}

/**
 * Quality ceiling rules by status
 * DRAFT: can modify freely
 * CHECKED: limited modifications, no quality regression
 * VERIFIED: locked, no modifications allowed
 */
export const qualityCeilings = {
  DRAFT: {
    canModify: true,
    canChangeStatus: true,
    maxQualityRegression: 0,
  },
  CHECKED: {
    canModify: true,
    canChangeStatus: true,
    maxQualityRegression: 10, // Allow up to 10% regression
  },
  VERIFIED: {
    canModify: false,
    canChangeStatus: false,
    maxQualityRegression: 0,
  },
};

/**
 * Enforce quality ceiling: lead quality cannot exceed the lowest upstream evidence quality.
 * If upstream evidence is DRAFT, lead cannot be CHECKED or VERIFIED.
 * 
 * @param proposedStatus - The proposed quality status for the lead
 * @param upstreamStatuses - Array of quality statuses from upstream evidence/sources
 * @returns The enforced quality status (may be downgraded)
 */
export function enforceQualityCeiling(
  proposedStatus: string,
  upstreamStatuses: string[]
): string {
  const hierarchy = ['DRAFT', 'CHECKED', 'VERIFIED'] as const;
  
  if (!proposedStatus || !upstreamStatuses || upstreamStatuses.length === 0) {
    return proposedStatus || 'DRAFT';
  }

  // Find the lowest upstream status
  const lowestUpstream = upstreamStatuses.reduce((lowest, current) => {
    const currentIndex = hierarchy.indexOf(current as any);
    const lowestIndex = hierarchy.indexOf(lowest as any);
    return currentIndex < lowestIndex ? current : lowest;
  }, 'VERIFIED');

  const proposedIndex = hierarchy.indexOf(proposedStatus as any);
  const ceilingIndex = hierarchy.indexOf(lowestUpstream as any);

  // Lead cannot be higher than the lowest upstream evidence
  if (proposedIndex > ceilingIndex) {
    return lowestUpstream;
  }

  return proposedStatus;
}

/**
 * Calculate overall quality score from dimensions (0-100)
 */
export function calculateQualityScore(dimensions: QualityDimensions): number {
  const avg = (
    dimensions.evidenceQuality +
    dimensions.linguisticQuality +
    dimensions.actionabilityQuality +
    dimensions.strategicValue
  ) / 4;
  return Math.round(avg * 100);
}

/**
 * Validate if a modification is allowed based on current quality status
 */
export function validateModification(
  currentStatus: 'DRAFT' | 'CHECKED' | 'VERIFIED',
  currentQuality: QualityDimensions | undefined,
  proposedQuality: QualityDimensions | undefined
): QualityValidation {
  const ceiling = qualityCeilings[currentStatus];

  if (!ceiling.canModify) {
    return {
      valid: false,
      error: `Cannot modify leads with status ${currentStatus}. They are locked.`,
      ceiling: currentStatus,
    };
  }

  // If no quality dimensions provided, allow modification
  if (!currentQuality || !proposedQuality) {
    return { valid: true };
  }

  // Check quality regression
  const currentScore = calculateQualityScore(currentQuality);
  const proposedScore = calculateQualityScore(proposedQuality);
  const regression = currentScore - proposedScore;

  if (regression > ceiling.maxQualityRegression) {
    return {
      valid: false,
      error: `Quality regression of ${regression}% exceeds allowed ceiling of ${ceiling.maxQualityRegression}% for status ${currentStatus}`,
      ceiling: currentStatus,
    };
  }

  return { valid: true };
}

/**
 * Determine appropriate quality status based on dimensions
 */
export function determineQualityStatus(
  dimensions: QualityDimensions
): 'DRAFT' | 'CHECKED' | 'VERIFIED' {
  const score = calculateQualityScore(dimensions);

  if (score >= 80) return 'VERIFIED';
  if (score >= 60) return 'CHECKED';
  return 'DRAFT';
}

/**
 * Validate quality dimensions are within valid ranges (0-1)
 */
export function validateQualityDimensions(dimensions: QualityDimensions): boolean {
  return (
    dimensions.evidenceQuality >= 0 &&
    dimensions.evidenceQuality <= 1 &&
    dimensions.linguisticQuality >= 0 &&
    dimensions.linguisticQuality <= 1 &&
    dimensions.actionabilityQuality >= 0 &&
    dimensions.actionabilityQuality <= 1 &&
    dimensions.strategicValue >= 0 &&
    dimensions.strategicValue <= 1
  );
}
