// Firmographic-tiered ticket-size estimation (issue #79). Replaces the
// previously free-written estimated_annual_revenue_usd/pricingByCompany
// fields (zero validation anywhere — capable of an $8,000,000,000 estimate
// for a mid-market lead) with a deterministic function of data this app
// already collects: a lead's own size tier and, when configured, the
// brand's own deal-size bands / per-product pricing (app/lib/sales-settings.ts).
// Pure module — no React/Mongo/internal Date.now(), mirroring
// lib/tech-stack-scan.ts's/lib/title-normalization.ts's shape.

export type TicketSizeMethod = 'tier_band' | 'per_unit' | 'unconfigured' | 'manual_override';
export type TicketSizeConfidence = 'low' | 'medium' | 'high';
export type TicketSizeCurrency = 'USD' | 'EUR';
export type TicketSizeTier = 'Small' | 'Medium' | 'Large' | 'Enterprise';

export interface TicketSizeEstimate {
  low: number;
  expected: number;
  high: number;
  currency: TicketSizeCurrency;
  method: 'tier_band' | 'per_unit' | 'manual_override';
  confidence: TicketSizeConfidence;
  computedAt: string;
  // Present only when method === 'manual_override' (issue #86) — a rep's
  // direct knowledge of a specific deal, deliberately exempt from the
  // sanity cap and from every automated recompute (#82) once set. A reason
  // is required by createManualTicketSizeOverride() below, mirroring
  // DECLINE's own required declineReason, so #83's calibration report can
  // at least see how often and why humans override the model.
  overrideReason?: string;
  overriddenBy?: string;
}

export interface TicketSizeUnconfigured {
  method: 'unconfigured';
  computedAt: string;
}

export type TicketSizeResult = TicketSizeEstimate | TicketSizeUnconfigured;

export interface TicketSizeInputs {
  sizeTier: TicketSizeTier | undefined;
  unitCount: number | undefined;
  currency: TicketSizeCurrency;
  // Operator-configured, per-region adjustment (issue #84) — e.g. a CEE or
  // MENA deal may realistically run smaller than a US one for the same
  // company-size tier. Applied before the sanity cap, so it can shrink or
  // grow an estimate but never let it escape the 2x-largestWon ceiling.
  // Absent, non-finite, or <=0 collapses to a 1.0 no-op — region is genuinely
  // free text at the API boundary (no server-side enum), so an unrecognized
  // or unconfigured region must never zero out or corrupt an estimate.
  regionMultiplier?: number;
}

export interface DealSizeBands {
  small?: number;
  medium?: number;
  large?: number;
  enterprise?: number;
  largestWon?: number;
}

export interface TicketSizeProductInput {
  customerSize: string[];
  perUnitRate?: number;
}

// Enterprise buyers typically pay a fraction of what SMB customers pay per
// seat/participant for identical functionality — a flat per-unit rate
// across all tiers is a documented modeling error (see issue #79's cited
// industry research). Values are deliberately simple, fixed placeholders
// for v1; issue #83 (closed-won calibration) is what eventually replaces
// these with real, data-derived discount curves.
const VOLUME_DISCOUNT_BY_TIER: Record<Lowercase<TicketSizeTier>, number> = {
  small: 1.0,
  medium: 0.85,
  large: 0.65,
  enterprise: 0.4,
};

// No single estimate may exceed this multiple of the largest real deal ever
// won for the brand — the direct, structural fix for the $8B-style outlier
// that prompted this module: once an operator sets a realistic
// dealSize.largestWon, no estimate can exceed 2x it, regardless of what an
// upstream agent free-wrote or how large/well-known the company is.
const SANITY_CAP_MULTIPLIER = 2;

// v1's band width is a fixed multiplier, not a real historical variance —
// same "known simplification, replaced once real data exists" contract as
// the volume-discount table above.
const TIER_BAND_LOW_FACTOR = 0.5;
const TIER_BAND_HIGH_FACTOR = 2;
const TIER_BAND_HIGH_FACTOR_NO_CAP = 3;
const PER_UNIT_LOW_FACTOR = 0.7;
const PER_UNIT_HIGH_FACTOR = 1.3;

function applySanityCap(value: number, dealSize: DealSizeBands): number {
  if (!dealSize.largestWon || dealSize.largestWon <= 0) return value;
  return Math.min(value, dealSize.largestWon * SANITY_CAP_MULTIPLIER);
}

function resolveRegionMultiplier(inputs: TicketSizeInputs): number {
  const m = inputs.regionMultiplier;
  return typeof m === 'number' && Number.isFinite(m) && m > 0 ? m : 1;
}

export function estimateTicketSize(
  inputs: TicketSizeInputs,
  dealSize: DealSizeBands,
  products: TicketSizeProductInput[],
  now: () => Date = () => new Date()
): TicketSizeResult {
  const computedAt = now().toISOString();

  if (!inputs.sizeTier) {
    return { method: 'unconfigured', computedAt };
  }

  const tierKey = inputs.sizeTier.toLowerCase() as Lowercase<TicketSizeTier>;

  // Method 1: per_unit — a product explicitly priced for this tier, with a
  // real unit-count signal (e.g. CogMap's estimated_participants).
  const product = products.find((p) => p.customerSize.includes(tierKey) && typeof p.perUnitRate === 'number' && p.perUnitRate > 0);
  const regionMultiplier = resolveRegionMultiplier(inputs);
  if (product && typeof inputs.unitCount === 'number' && inputs.unitCount > 0) {
    const raw = product.perUnitRate! * inputs.unitCount * 12 * VOLUME_DISCOUNT_BY_TIER[tierKey] * regionMultiplier;
    const expected = applySanityCap(raw, dealSize);
    return {
      low: expected * PER_UNIT_LOW_FACTOR,
      expected,
      high: expected * PER_UNIT_HIGH_FACTOR,
      currency: inputs.currency,
      method: 'per_unit',
      confidence: 'medium',
      computedAt,
    };
  }

  // Method 2: tier_band — the brand's own configured deal-size band.
  const tierValue = dealSize[tierKey];
  if (typeof tierValue === 'number' && tierValue > 0) {
    const expected = applySanityCap(tierValue * regionMultiplier, dealSize);
    const high = dealSize.largestWon
      ? Math.min(expected * TIER_BAND_HIGH_FACTOR, dealSize.largestWon * SANITY_CAP_MULTIPLIER)
      : expected * TIER_BAND_HIGH_FACTOR_NO_CAP;
    return {
      low: expected * TIER_BAND_LOW_FACTOR,
      expected,
      high,
      currency: inputs.currency,
      method: 'tier_band',
      confidence: dealSize.largestWon ? 'medium' : 'low',
      computedAt,
    };
  }

  // Neither a matching per-unit product nor a deal-size band exists for
  // this brand/tier yet — an honest "not configured," never a fabricated
  // number (mirrors lib/tech-stack-scan.ts's never-fabricate contract).
  return { method: 'unconfigured', computedAt };
}

export interface TicketSizeManualOverrideInput {
  expected: number;
  reason: string;
  overriddenBy?: string;
}

// A human's direct knowledge of a specific deal (a verbal budget number, a
// comparable recent close) may beat the firmographic model — issue #86.
// Deliberately NOT run through applySanityCap(): the cap exists to catch an
// unvalidated, agent-written number; a manual override is the opposite — an
// explicit, reason-required human judgment call, the same trust level CLAUDE.md
// Rule 7 already extends to any real user action. low/high both equal expected
// since this is a specific figure, not a modeled band.
export function createManualTicketSizeOverride(
  input: TicketSizeManualOverrideInput,
  currency: TicketSizeCurrency,
  now: () => Date = () => new Date()
): TicketSizeEstimate {
  return {
    low: input.expected,
    expected: input.expected,
    high: input.expected,
    currency,
    method: 'manual_override',
    confidence: 'high',
    computedAt: now().toISOString(),
    overrideReason: input.reason,
    overriddenBy: input.overriddenBy,
  };
}
