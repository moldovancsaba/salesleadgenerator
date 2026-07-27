// Extracted from app/api/leads/route.ts (previously private to that file) so
// lib/lead-merge.ts (issue #128) can recompute a merged lead's scoreProfile
// from its final, possibly-conflict-resolved ice values without duplicating
// this logic — scoreProfile is always a pure function of impact/confidence/
// ease, so it must be recomputed whenever ice changes, never carried over
// stale from whichever lead happened to be chosen as merge primary.

export function computeIceScore(impact: number, confidence: number, ease: number): number {
  return impact * confidence * ease
}

export function buildScoreProfile(impact: number, confidence: number, ease: number) {
  const iceScore = computeIceScore(impact, confidence, ease)
  return {
    agentProposal: { impact, confidence, effort: ease },
    calibratedHeuristic: { impact, confidence, effort: ease },
    finalBlended: {
      ice: iceScore,
      quality: Math.round((impact / 10) * 100),
      urgency: Math.round((confidence / 10) * 100),
      freshness: 50,
      humanSignal: 50,
      risk: Math.round(((10 - ease) / 10) * 100),
    },
    qualityDimensions: {
      evidenceQuality: confidence / 10,
      linguisticQuality: 0.8,
      actionabilityQuality: impact / 10,
      strategicValue: impact / 10,
    },
  }
}
