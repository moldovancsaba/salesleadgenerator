import { describe, it, expect } from 'vitest';
import { backfillTicketSizeCollection } from '../../lib/backfill-ticket-size';

const NOW = () => new Date('2026-07-25T00:00:00.000Z');

// Minimal fake mirroring the subset of the mongodb driver's Collection API
// this module actually uses — same pattern as
// tests/lib/backfill-title-normalization.test.ts's fakeDb, extended with a
// second named collection (company_settings) since this backfill needs one
// extra lookup the title-normalization one didn't.
function fakeDb(leadDocs: any[], settingsDoc: any = null) {
  const updates: Array<{ id: any; set: any }> = [];
  return {
    collection: (name: string) => {
      if (name === 'company_settings') {
        return { findOne: async () => settingsDoc };
      }
      return {
        find: () => ({
          [Symbol.asyncIterator]: async function* () {
            for (const doc of leadDocs) yield doc;
          },
        }),
        updateOne: async (filter: any, update: any) => {
          updates.push({ id: filter._id, set: update.$set });
        },
      };
    },
    _updates: updates,
  };
}

describe('backfillTicketSizeCollection', () => {
  it('computes and writes a tier_band estimate in apply mode', async () => {
    const db = fakeDb(
      [{ _id: '1', size: 'Medium' }],
      { dealSize: { medium: 40000, largestWon: 100000 }, products: [] }
    );
    const result = await backfillTicketSizeCollection(db, 'leads', 'cogmap', 'default', 'USD', { apply: true }, NOW);

    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);
    expect(db._updates).toHaveLength(1);
    expect(db._updates[0].set.ticketSizeEstimate).toMatchObject({ method: 'tier_band', expected: 40000 });
  });

  it('never writes in dry-run mode', async () => {
    const db = fakeDb([{ _id: '1', size: 'Small' }], { dealSize: { small: 5000 }, products: [] });
    const result = await backfillTicketSizeCollection(db, 'leads', 'cogmap', 'default', 'USD', { apply: false }, NOW);

    expect(result.updated).toBe(1);
    expect(db._updates).toHaveLength(0);
  });

  it('is idempotent — a second run over already-backfilled data finds nothing to change', async () => {
    const alreadyBackfilled = [{
      _id: '1', size: 'Small',
      ticketSizeEstimate: { method: 'tier_band', expected: 5000, low: 2500, high: 15000, currency: 'USD', confidence: 'low', computedAt: '2020-01-01T00:00:00.000Z' },
    }];
    const db = fakeDb(alreadyBackfilled, { dealSize: { small: 5000 }, products: [] });
    const result = await backfillTicketSizeCollection(db, 'leads', 'cogmap', 'default', 'USD', { apply: true }, NOW);

    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(db._updates).toHaveLength(0);
  });

  it('reports a changed method as updated even if the previous run had a different result', async () => {
    // Simulates a company_settings edit between two backfill runs — the
    // stored estimate's method/expected no longer match today's inputs.
    const stale = [{
      _id: '1', size: 'Small',
      ticketSizeEstimate: { method: 'unconfigured', computedAt: '2020-01-01T00:00:00.000Z' },
    }];
    const db = fakeDb(stale, { dealSize: { small: 5000 }, products: [] });
    const result = await backfillTicketSizeCollection(db, 'leads', 'cogmap', 'default', 'USD', { apply: true }, NOW);

    expect(result.updated).toBe(1);
    expect(db._updates[0].set.ticketSizeEstimate.method).toBe('tier_band');
  });

  it('backfills to an honest unconfigured state when the lead has no size and never fabricates a number', async () => {
    const db = fakeDb([{ _id: '1' }], { dealSize: { small: 5000 }, products: [] });
    const result = await backfillTicketSizeCollection(db, 'leads', 'cogmap', 'default', 'USD', { apply: true }, NOW);

    expect(result.updated).toBe(1);
    expect(db._updates[0].set.ticketSizeEstimate).toEqual({ method: 'unconfigured', computedAt: NOW().toISOString() });
  });

  it('handles a brand with no company_settings doc at all, backfilling every lead to unconfigured', async () => {
    const db = fakeDb([{ _id: '1', size: 'Enterprise' }], null);
    const result = await backfillTicketSizeCollection(db, 'leads', 'cogmap', 'default', 'USD', { apply: true }, NOW);

    expect(result.methodCounts.unconfigured).toBe(1);
    expect(db._updates[0].set.ticketSizeEstimate.method).toBe('unconfigured');
  });
});
