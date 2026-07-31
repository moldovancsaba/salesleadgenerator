// Firmographic-tiered ticket-size estimation (issue #79). Replaces the
// previously free-written estimated_annual_revenue_usd/pricingByCompany
// fields (zero validation anywhere — capable of an $8,000,000,000 estimate
// for a mid-market lead) with a deterministic function of data this app
// already collects: a lead's own size tier and, when configured, the
// brand's own deal-size bands / per-product pricing (app/lib/sales-settings.ts).
// Pure module — no React/Mongo/internal Date.now(), mirroring
// lib/tech-stack-scan.ts's/lib/title-normalization.ts's shape.

import type { CurrencyCode } from '@/app/lib/brand';

export type TicketSizeMethod = 'tier_band' | 'per_unit' | 'unconfigured' | 'manual_override';
export type TicketSizeConfidence = 'low' | 'medium' | 'high';
// Issue #145 — re-exported from app/lib/brand.ts's single currency source of
// truth rather than an independent 'USD' | 'EUR' union.
export type TicketSizeCurrency = CurrencyCode;
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
  // True when the lead had no reliable size-tier data (missing, or a value
  // that didn't match Small/Medium/Large/Enterprise) and this figure is the
  // smallest configured deal-size band, not a real per-lead estimate —
  // issue #112. Never set for manual_override.
  sizeAssumed?: boolean;
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

// Issue #94: the largestWon-based cap above is a complete no-op whenever an
// operator hasn't configured dealSize.largestWon — a very plausible
// real-world state, since nothing requires it to be set. This absolute
// ceiling applies unconditionally, regardless of configuration, so a
// tier_band/per_unit estimate can never be unboundedly large even for a
// brand-new brand with an empty Sales Settings doc. Deliberately currency-
// agnostic (this app has no FX conversion — see docs/ARCHITECTURE.md's
// revenue-target currency-mismatch handling) and well above any plausible
// real deal size for this app's sports-org customer base: a genuinely huge,
// legitimate enterprise deal must never itself be treated as suspicious —
// this exists only to catch the original $8B-style class of bug when the
// largestWon-based cap isn't configured to catch it another way. Kept in
// sync with app/lib/sales-settings.ts's MAX_DEAL_SIZE_INPUT, which bounds
// dealSize's own fields at the point they're entered — defense in depth,
// not a single point of failure.
const ABSOLUTE_CEILING = 50_000_000;

// v1's band width is a fixed multiplier, not a real historical variance —
// same "known simplification, replaced once real data exists" contract as
// the volume-discount table above.
const TIER_BAND_LOW_FACTOR = 0.5;
const TIER_BAND_HIGH_FACTOR = 2;
const TIER_BAND_HIGH_FACTOR_NO_CAP = 3;
const PER_UNIT_LOW_FACTOR = 0.7;
const PER_UNIT_HIGH_FACTOR = 1.3;

function applySanityCap(value: number, dealSize: DealSizeBands): number {
  const largestWonCap = dealSize.largestWon && dealSize.largestWon > 0
    ? dealSize.largestWon * SANITY_CAP_MULTIPLIER
    : Infinity;
  return Math.min(value, largestWonCap, ABSOLUTE_CEILING);
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

  // Issue #112: previously returned 'unconfigured' outright whenever a lead
  // had no reliable size-tier data (missing `size`, or a value that didn't
  // match the Small/Medium/Large/Enterprise enum — free text, wrong case,
  // etc.) — a large fraction of real leads never got any ticket size at
  // all. Deliberately does NOT guess a tier and run it through per_unit or
  // tier_band as normal: per_unit's volume discount is steeper for bigger
  // tiers (lib/ticket-size.ts's own VOLUME_DISCOUNT_BY_TIER), so assuming
  // 'Small' there can compute a LARGER number than assuming 'Enterprise'
  // would — the opposite of "smallest." Instead, directly takes whichever
  // dealSize band is smallest among whatever the brand has configured
  // (small/medium/large/enterprise, not necessarily 'small' itself if bands
  // aren't monotonic), still through the same sanity cap and range factors
  // as a real tier_band estimate, always confidence: 'low', and flagged
  // sizeAssumed so the UI can be honest that this isn't the lead's own
  // actual size. Falls through to 'unconfigured' only when the brand has
  // configured no dealSize band at all — genuinely nothing to compute from.
  if (!inputs.sizeTier) {
    const regionMultiplier = resolveRegionMultiplier(inputs);
    const bandValues = [dealSize.small, dealSize.medium, dealSize.large, dealSize.enterprise]
      .filter((v): v is number => typeof v === 'number' && v > 0);

    if (bandValues.length === 0) {
      return { method: 'unconfigured', computedAt };
    }

    const smallestBand = Math.min(...bandValues);
    const expected = applySanityCap(smallestBand * regionMultiplier, dealSize);
    const high = dealSize.largestWon
      ? Math.min(expected * TIER_BAND_HIGH_FACTOR, dealSize.largestWon * SANITY_CAP_MULTIPLIER)
      : Math.min(expected * TIER_BAND_HIGH_FACTOR_NO_CAP, ABSOLUTE_CEILING);

    return {
      low: expected * TIER_BAND_LOW_FACTOR,
      expected,
      high,
      currency: inputs.currency,
      method: 'tier_band',
      confidence: 'low',
      computedAt,
      sizeAssumed: true,
    };
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
      : Math.min(expected * TIER_BAND_HIGH_FACTOR_NO_CAP, ABSOLUTE_CEILING);
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
