import { describe, it, expect } from 'vitest';
import { backfillBuyingRoleCollection } from '../../lib/backfill-buying-role';

// Minimal fake mirroring the subset of the mongodb driver's Collection API
// this module actually uses — same pattern as
// tests/lib/backfill-title-normalization.test.ts's fakeDb.
function fakeDb(docs: any[]) {
  const updates: Array<{ id: any; set: any }> = [];
  return {
    collection: () => ({
      find: () => ({
        [Symbol.asyncIterator]: async function* () {
          for (const doc of docs) yield doc;
        },
      }),
      updateOne: async (filter: any, update: any) => {
        updates.push({ id: filter._id, set: update.$set });
      },
    }),
    _updates: updates,
  };
}

describe('backfillBuyingRoleCollection', () => {
  it('derives and writes buyingRole/isDecisionMaker for a legacy isDecisionMaker-only contact, in apply mode', async () => {
    const db = fakeDb([{ _id: '1', contacts: [{ name: 'Jane', isDecisionMaker: true }] }]);
    const result = await backfillBuyingRoleCollection(db, 'leads', { apply: true });

    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.contactsUpdated).toBe(1);
    expect(db._updates).toHaveLength(1);
    expect(db._updates[0].set.contacts[0]).toMatchObject({ buyingRole: 'decision_maker', isDecisionMaker: true });
  });

  it('a never-classified contact backfills to unknown/false', async () => {
    const db = fakeDb([{ _id: '1', contacts: [{ name: 'Jane' }] }]);
    const result = await backfillBuyingRoleCollection(db, 'leads', { apply: true });
    expect(result.contactsUpdated).toBe(1);
    expect(db._updates[0].set.contacts[0]).toMatchObject({ buyingRole: 'unknown', isDecisionMaker: false });
  });

  it('never writes in dry-run mode (apply: false)', async () => {
    const db = fakeDb([{ _id: '1', contacts: [{ name: 'Jane', isDecisionMaker: true }] }]);
    const result = await backfillBuyingRoleCollection(db, 'leads', { apply: false });

    expect(result.updated).toBe(1);
    expect(db._updates).toHaveLength(0);
  });

  // Issue #206's own required test: a second apply run after the first must
  // report 0 updates everywhere — idempotency by construction.
  it('is idempotent — a second run over already-backfilled data finds nothing to change', async () => {
    const alreadyBackfilled = [{ _id: '1', contacts: [{ name: 'Jane', buyingRole: 'champion', isDecisionMaker: false }] }];
    const db = fakeDb(alreadyBackfilled);
    const result = await backfillBuyingRoleCollection(db, 'leads', { apply: true });

    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(db._updates).toHaveLength(0);
  });

  it('treats a document with no contacts as unchanged, never throwing', async () => {
    const db = fakeDb([{ _id: '1', contacts: [] }, { _id: '2' }]);
    const result = await backfillBuyingRoleCollection(db, 'leads', { apply: true });
    expect(result.updated).toBe(0);
    expect(result.contactsUpdated).toBe(0);
    expect(db._updates).toHaveLength(0);
  });

  it('mixed legacy and already-migrated documents in one collection: only the legacy one updates', async () => {
    const db = fakeDb([
      { _id: '1', contacts: [{ name: 'Legacy', isDecisionMaker: true }] },
      { _id: '2', contacts: [{ name: 'Migrated', buyingRole: 'blocker', isDecisionMaker: false }] },
    ]);
    const result = await backfillBuyingRoleCollection(db, 'leads', { apply: true });
    expect(result.updated).toBe(1);
    expect(result.unchanged).toBe(1);
    expect(db._updates).toHaveLength(1);
    expect(db._updates[0].id).toBe('1');
  });

  it('only updates the contacts within a document whose derived values actually changed', async () => {
    const db = fakeDb([
      {
        _id: '1',
        contacts: [
          { name: 'Already Right', buyingRole: 'economic_buyer', isDecisionMaker: true },
          { name: 'Needs Backfill', isDecisionMaker: true },
        ],
      },
    ]);
    const result = await backfillBuyingRoleCollection(db, 'leads', { apply: true });
    expect(result.contactsUpdated).toBe(1);
    expect(db._updates[0].set.contacts[0]).toMatchObject({ name: 'Already Right', buyingRole: 'economic_buyer' });
    expect(db._updates[0].set.contacts[1]).toMatchObject({ name: 'Needs Backfill', buyingRole: 'decision_maker', isDecisionMaker: true });
  });
});
