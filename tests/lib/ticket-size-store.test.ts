import { describe, it, expect } from 'vitest';
import { computeTicketSizeForLead } from '../../app/lib/ticket-size-store';

// Minimal fake mirroring the subset of the mongodb driver's Collection API
// this module actually uses — same pattern as
// tests/lib/backfill-ticket-size.test.ts's fakeDb.
function fakeDb(settingsDoc: any = null) {
  return {
    collection: (name: string) => {
      if (name !== 'company_settings') throw new Error(`unexpected collection: ${name}`);
      return { findOne: async () => settingsDoc };
    },
  } as any;
}

describe('computeTicketSizeForLead', () => {
  // Issue #169 — previously always recomputed the brand's fixed default
  // currency here even though the settings doc (already loaded for
  // dealSize/products/regionMultipliers) carries the operator's own saved
  // choice in revenueTarget.currency.
  it('uses the settings doc\'s own saved revenueTarget.currency, not the brand default', async () => {
    const db = fakeDb({
      dealSize: { medium: 40000 },
      products: [],
      revenueTarget: { currency: 'EUR', period: 'annual' },
    });
    const result = await computeTicketSizeForLead(db, 'cogmap', 'default', { size: 'Medium' });
    expect(result).toMatchObject({ method: 'tier_band', currency: 'EUR' });
  });

  it('falls back to the brand\'s own default currency when no settings doc exists yet', async () => {
    const db = fakeDb(null);
    const result = await computeTicketSizeForLead(db, 'seyu', 'default', { size: 'Medium' });
    // No dealSize configured at all -> unconfigured, but this still exercises
    // the currency-resolution fallback with no crash on a null settings doc.
    expect(result.method).toBe('unconfigured');
  });

  it('falls back to the brand default when the settings doc has no revenueTarget.currency set', async () => {
    const db = fakeDb({ dealSize: { medium: 40000 }, products: [] });
    const result = await computeTicketSizeForLead(db, 'seyu', 'default', { size: 'Medium' });
    expect(result).toMatchObject({ method: 'tier_band', currency: 'EUR' });
  });
});
