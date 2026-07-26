import { describe, it, expect } from 'vitest';
import { estimateTicketSize, createManualTicketSizeOverride } from '../../lib/ticket-size';
import type { DealSizeBands, TicketSizeInputs, TicketSizeProductInput } from '../../lib/ticket-size';

const NOW = new Date('2026-07-25T00:00:00.000Z');
const now = () => NOW;

function inputs(overrides: Partial<TicketSizeInputs> = {}): TicketSizeInputs {
  return { sizeTier: 'Medium', unitCount: undefined, currency: 'USD', ...overrides };
}

describe('estimateTicketSize', () => {
  it('returns unconfigured when the lead has no size tier and the brand has no deal-size bands configured either', () => {
    const result = estimateTicketSize(inputs({ sizeTier: undefined }), {}, [], now);
    expect(result.method).toBe('unconfigured');
    expect(result.computedAt).toBe(NOW.toISOString());
  });

  it('returns unconfigured when the brand has no deal-size bands or matching product', () => {
    const result = estimateTicketSize(inputs(), {}, [], now);
    expect(result.method).toBe('unconfigured');
  });

  describe('no reliable size-tier data (issue #112)', () => {
    it('uses the smallest configured deal-size band instead of unconfigured', () => {
      const dealSize: DealSizeBands = { small: 10000, medium: 40000, large: 100000, enterprise: 250000, largestWon: 300000 };
      const result = estimateTicketSize(inputs({ sizeTier: undefined }), dealSize, [], now);
      if (result.method !== 'tier_band') throw new Error('expected tier_band');
      expect(result.expected).toBe(10000);
      expect(result.confidence).toBe('low');
      expect(result.sizeAssumed).toBe(true);
    });

    it('picks the smallest configured band even when it is not literally "small" (non-monotonic config)', () => {
      const dealSize: DealSizeBands = { medium: 15000, large: 100000 };
      const result = estimateTicketSize(inputs({ sizeTier: undefined }), dealSize, [], now);
      if (result.method !== 'tier_band') throw new Error('expected tier_band');
      expect(result.expected).toBe(15000);
    });

    it('never uses per_unit for an assumed tier, even when a per-unit product and a real unit count exist', () => {
      // per_unit's volume discount is steeper for bigger tiers, so guessing
      // any specific tier here could compute a LARGER number than the
      // smallest configured band — this must never happen for an unreliable lead.
      const dealSize: DealSizeBands = { small: 5000 };
      const products: TicketSizeProductInput[] = [{ customerSize: ['small', 'enterprise'], perUnitRate: 1000 }];
      const result = estimateTicketSize(inputs({ sizeTier: undefined, unitCount: 10000 }), dealSize, products, now);
      expect(result.method).toBe('tier_band');
      if (result.method !== 'tier_band') throw new Error('expected tier_band');
      expect(result.expected).toBe(5000);
    });

    it('still applies the sanity cap and region multiplier to the assumed-smallest estimate', () => {
      const dealSize: DealSizeBands = { small: 8_000_000_000, largestWon: 500_000 };
      const result = estimateTicketSize(inputs({ sizeTier: undefined, regionMultiplier: 2 }), dealSize, [], now);
      if (result.method !== 'tier_band') throw new Error('expected tier_band');
      expect(result.expected).toBe(1_000_000); // capped at 2x largestWon, region multiplier included
    });

    it('is genuinely unconfigured, not defaulted, when the brand has no deal-size bands at all', () => {
      const result = estimateTicketSize(inputs({ sizeTier: undefined }), {}, [], now);
      expect(result.method).toBe('unconfigured');
      expect((result as any).sizeAssumed).toBeUndefined();
    });
  });

  it('computes a tier_band estimate from the brand deal-size config', () => {
    const dealSize: DealSizeBands = { small: 10000, medium: 40000, large: 100000, enterprise: 250000, largestWon: 300000 };
    const result = estimateTicketSize(inputs({ sizeTier: 'Medium' }), dealSize, [], now);
    expect(result.method).toBe('tier_band');
    if (result.method !== 'tier_band') throw new Error('expected tier_band');
    expect(result.expected).toBe(40000);
    expect(result.low).toBe(20000);
    expect(result.currency).toBe('USD');
    expect(result.confidence).toBe('medium');
  });

  it('gives low confidence when no largestWon is configured', () => {
    const dealSize: DealSizeBands = { medium: 40000 };
    const result = estimateTicketSize(inputs({ sizeTier: 'Medium' }), dealSize, [], now);
    if (result.method !== 'tier_band') throw new Error('expected tier_band');
    expect(result.confidence).toBe('low');
  });

  it('maps every size tier to its own band', () => {
    const dealSize: DealSizeBands = { small: 5000, medium: 20000, large: 80000, enterprise: 200000, largestWon: 250000 };
    for (const [tier, expected] of [['Small', 5000], ['Medium', 20000], ['Large', 80000], ['Enterprise', 200000]] as const) {
      const result = estimateTicketSize(inputs({ sizeTier: tier }), dealSize, [], now);
      if (result.method !== 'tier_band') throw new Error(`expected tier_band for ${tier}`);
      expect(result.expected).toBe(expected);
    }
  });

  it('caps a tier_band estimate at 2x the largest deal ever won (the $8B-bug fix)', () => {
    // Simulates a brand that configured a wildly out-of-scale band value —
    // the sanity cap must still clamp the output to a sane figure derived
    // from real historical data (largestWon), never letting an absurd input
    // propagate through untouched.
    const dealSize: DealSizeBands = { enterprise: 8_000_000_000, largestWon: 500_000 };
    const result = estimateTicketSize(inputs({ sizeTier: 'Enterprise' }), dealSize, [], now);
    if (result.method !== 'tier_band') throw new Error('expected tier_band');
    expect(result.expected).toBe(1_000_000); // 2x largestWon, not 8B
    expect(result.high).toBeLessThanOrEqual(1_000_000);
  });

  it('caps a tier_band estimate to an absolute ceiling even when largestWon is completely unset (issue #94)', () => {
    // The previously-uncapped case: the sanity cap used to be a total no-op
    // whenever largestWon was unconfigured — a very plausible real-world
    // state for a brand-new brand. An absolute ceiling now applies
    // regardless of configuration.
    const dealSize: DealSizeBands = { enterprise: 8_000_000_000 };
    const result = estimateTicketSize(inputs({ sizeTier: 'Enterprise' }), dealSize, [], now);
    if (result.method !== 'tier_band') throw new Error('expected tier_band');
    expect(result.expected).toBe(50_000_000);
    expect(result.high).toBeLessThanOrEqual(50_000_000);
  });

  it('caps a per_unit estimate to the same absolute ceiling when largestWon is unset (issue #94)', () => {
    const products: TicketSizeProductInput[] = [{ customerSize: ['enterprise'], perUnitRate: 1_000_000 }];
    const result = estimateTicketSize(inputs({ sizeTier: 'Enterprise', unitCount: 1000 }), {}, products, now);
    if (result.method !== 'per_unit') throw new Error('expected per_unit');
    expect(result.expected).toBe(50_000_000);
  });

  it('computes a per_unit estimate when a matching product and unit count exist', () => {
    const products: TicketSizeProductInput[] = [{ customerSize: ['small', 'medium'], perUnitRate: 10 }];
    const result = estimateTicketSize(inputs({ sizeTier: 'Small', unitCount: 100 }), {}, products, now);
    expect(result.method).toBe('per_unit');
    if (result.method !== 'per_unit') throw new Error('expected per_unit');
    // 10 * 100 * 12 * 1.0 (small tier discount factor)
    expect(result.expected).toBe(12000);
  });

  it('applies a steeper volume discount for larger tiers on identical per-unit inputs', () => {
    const products: TicketSizeProductInput[] = [{ customerSize: ['small', 'enterprise'], perUnitRate: 10 }];
    const small = estimateTicketSize(inputs({ sizeTier: 'Small', unitCount: 100 }), {}, products, now);
    const enterprise = estimateTicketSize(inputs({ sizeTier: 'Enterprise', unitCount: 100 }), {}, products, now);
    if (small.method !== 'per_unit' || enterprise.method !== 'per_unit') throw new Error('expected per_unit for both');
    expect(enterprise.expected).toBeLessThan(small.expected);
  });

  it('falls through to tier_band when a product matches the tier but there is no unit count', () => {
    const dealSize: DealSizeBands = { small: 5000 };
    const products: TicketSizeProductInput[] = [{ customerSize: ['small'], perUnitRate: 10 }];
    const result = estimateTicketSize(inputs({ sizeTier: 'Small', unitCount: undefined }), dealSize, products, now);
    expect(result.method).toBe('tier_band');
  });

  it('prefers per_unit over tier_band when both are available', () => {
    const dealSize: DealSizeBands = { small: 5000 };
    const products: TicketSizeProductInput[] = [{ customerSize: ['small'], perUnitRate: 10 }];
    const result = estimateTicketSize(inputs({ sizeTier: 'Small', unitCount: 50 }), dealSize, products, now);
    expect(result.method).toBe('per_unit');
  });

  it('caps a per_unit estimate at 2x the largest deal ever won', () => {
    const products: TicketSizeProductInput[] = [{ customerSize: ['enterprise'], perUnitRate: 1_000_000 }];
    const result = estimateTicketSize(
      inputs({ sizeTier: 'Enterprise', unitCount: 10000 }),
      { largestWon: 500_000 },
      products,
      now
    );
    if (result.method !== 'per_unit') throw new Error('expected per_unit');
    expect(result.expected).toBe(1_000_000);
  });

  it('is deterministic via the injected now() dependency', () => {
    const dealSize: DealSizeBands = { small: 5000 };
    const result = estimateTicketSize(inputs({ sizeTier: 'Small' }), dealSize, [], () => new Date('2020-01-01T00:00:00.000Z'));
    expect(result.computedAt).toBe('2020-01-01T00:00:00.000Z');
  });

  describe('regionMultiplier (issue #84)', () => {
    it('scales a tier_band estimate by the configured region multiplier', () => {
      const dealSize: DealSizeBands = { medium: 40000, largestWon: 300000 };
      const result = estimateTicketSize(inputs({ sizeTier: 'Medium', regionMultiplier: 0.5 }), dealSize, [], now);
      if (result.method !== 'tier_band') throw new Error('expected tier_band');
      expect(result.expected).toBe(20000);
    });

    it('scales a per_unit estimate by the configured region multiplier', () => {
      const products: TicketSizeProductInput[] = [{ customerSize: ['small'], perUnitRate: 10 }];
      const result = estimateTicketSize(inputs({ sizeTier: 'Small', unitCount: 100, regionMultiplier: 1.5 }), {}, products, now);
      if (result.method !== 'per_unit') throw new Error('expected per_unit');
      expect(result.expected).toBe(18000); // 12000 base * 1.5
    });

    it('defaults to a 1.0 no-op when regionMultiplier is omitted', () => {
      const dealSize: DealSizeBands = { medium: 40000 };
      const withDefault = estimateTicketSize(inputs({ sizeTier: 'Medium' }), dealSize, [], now);
      const explicit = estimateTicketSize(inputs({ sizeTier: 'Medium', regionMultiplier: 1 }), dealSize, [], now);
      expect(withDefault).toEqual(explicit);
    });

    it('treats a zero, negative, or non-finite regionMultiplier as a 1.0 no-op rather than corrupting the estimate', () => {
      const dealSize: DealSizeBands = { medium: 40000 };
      for (const bad of [0, -1, NaN, Infinity]) {
        const result = estimateTicketSize(inputs({ sizeTier: 'Medium', regionMultiplier: bad }), dealSize, [], now);
        if (result.method !== 'tier_band') throw new Error('expected tier_band');
        expect(result.expected).toBe(40000);
      }
    });

    it('still applies the sanity cap after the region multiplier — the multiplier cannot bypass the $8B-bug fix', () => {
      const dealSize: DealSizeBands = { enterprise: 8_000_000_000, largestWon: 500_000 };
      const result = estimateTicketSize(inputs({ sizeTier: 'Enterprise', regionMultiplier: 3 }), dealSize, [], now);
      if (result.method !== 'tier_band') throw new Error('expected tier_band');
      expect(result.expected).toBe(1_000_000); // still 2x largestWon
    });
  });

  describe('createManualTicketSizeOverride (issue #86)', () => {
    it('builds a manual_override estimate with low/expected/high all equal to the given figure', () => {
      const result = createManualTicketSizeOverride({ expected: 75000, reason: 'Verbal budget confirmed by prospect', overriddenBy: 'webapp-user' }, 'USD', now);
      expect(result.method).toBe('manual_override');
      expect(result.low).toBe(75000);
      expect(result.expected).toBe(75000);
      expect(result.high).toBe(75000);
      expect(result.currency).toBe('USD');
      expect(result.confidence).toBe('high');
      expect(result.overrideReason).toBe('Verbal budget confirmed by prospect');
      expect(result.overriddenBy).toBe('webapp-user');
      expect(result.computedAt).toBe(NOW.toISOString());
    });

    it('is not subject to the sanity cap — a deliberate human judgment call, unlike an unvalidated agent-written figure', () => {
      const result = createManualTicketSizeOverride({ expected: 50_000_000, reason: 'Confirmed multi-year framework deal' }, 'USD', now);
      expect(result.expected).toBe(50_000_000);
    });
  });
});
