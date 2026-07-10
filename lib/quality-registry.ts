/**
 * Quality Ceiling Enforcement (Check-inspired)
 * Prevents verified leads from depending on unverified evidence
 */

import type { Lead } from '@/models/Lead'

export type QualityStatus = 'DRAFT' | 'CHECKED' | 'VERIFIED'

export const QUALITY_STATUS_CHAIN: QualityStatus[] = ['DRAFT', 'CHECKED', 'VERIFIED']

export function getQualityLevel(status: QualityStatus): number {
  return QUALITY_STATUS_CHAIN.indexOf(status)
}

export function enforceQualityCeiling(
  leadQuality: QualityStatus,
  upstreamQualityLevels: QualityStatus[]
): QualityStatus {
  if (upstreamQualityLevels.length === 0) return leadQuality
  
  const weakestUpstream = upstreamQualityLevels.reduce((min, current) => {
    return getQualityLevel(current) < getQualityLevel(min) ? current : min
  })
  
  return getQualityLevel(weakestUpstream) < getQualityLevel(leadQuality)
    ? weakestUpstream
    : leadQuality
}

export function canPromoteQuality(
  current: QualityStatus,
  target: QualityStatus
): boolean {
  return QUALITY_STATUS_CHAIN.indexOf(target) <= QUALITY_STATUS_CHAIN.indexOf(current)
}
