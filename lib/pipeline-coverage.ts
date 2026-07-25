// Pure pipeline-coverage-ratio computation (issue #60): weighted pipeline
// forecast ÷ a brand's own revenue target. No Mongo/React — the caller
// (app/lib/forecast.ts) supplies the already-fetched target and weighted
// total.

export type RevenueTargetCurrency = 'USD' | 'EUR'
export type RevenueTargetPeriod = 'monthly' | 'quarterly' | 'annual'

export type RevenueTargetInput = {
  amount?: number
  currency: RevenueTargetCurrency
  period: RevenueTargetPeriod
}

export type CoverageBenchmark = 'below' | 'in_range' | 'above' | 'unset'

export type Coverage = {
  target: number
  targetPeriod: RevenueTargetPeriod
  targetCurrency: RevenueTargetCurrency
  weightedPipeline: number
  ratio: number
  benchmark: CoverageBenchmark
  currencyMismatch: boolean
}

// A missing target, or an amount that is 0/negative/non-finite, is treated
// identically as "no target configured" — returns null, never a false "0%"
// alarm. Currency is explicit and user-set (no FX rate source exists in this
// app); a brand/target currency mismatch never gets silently converted —
// it's surfaced as benchmark: 'unset' plus currencyMismatch: true so the UI
// can warn instead of showing a misleading ratio.
export function computeCoverage(
  target: RevenueTargetInput | undefined | null,
  weightedPipeline: number,
  pipelineCurrency: RevenueTargetCurrency
): Coverage | null {
  if (!target || !target.amount || !Number.isFinite(target.amount) || target.amount <= 0) return null

  const ratio = Math.round((weightedPipeline / target.amount) * 1000) / 1000
  const currencyMismatch = target.currency !== pipelineCurrency
  const benchmark: CoverageBenchmark = currencyMismatch
    ? 'unset'
    : ratio < 3
      ? 'below'
      : ratio <= 5
        ? 'in_range'
        : 'above'

  return {
    target: target.amount,
    targetPeriod: target.period,
    targetCurrency: target.currency,
    weightedPipeline,
    ratio,
    benchmark,
    currencyMismatch,
  }
}
