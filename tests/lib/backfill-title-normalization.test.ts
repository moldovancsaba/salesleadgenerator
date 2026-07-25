import { describe, it, expect } from 'vitest';
import { backfillTitleNormalizationCollection } from '../../lib/backfill-title-normalization';

// Minimal fake mirroring the subset of the mongodb driver's Collection API
// this module actually uses — same pattern as
// tests/lib/migrate-decision-maker.test.ts's fakeDb.
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

describe('backfillTitleNormalizationCollection', () => {
  it('derives and writes seniorityTier/department for a contact missing both, in apply mode', async () => {
    const db = fakeDb([{ _id: '1', contacts: [{ name: 'Jane', title: 'VP of Sales' }] }]);
    const result = await backfillTitleNormalizationCollection(db, 'leads', { apply: true });

    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.contactsUpdated).toBe(1);
    expect(db._updates).toHaveLength(1);
    expect(db._updates[0].set.contacts[0]).toMatchObject({ seniorityTier: 'VP', department: 'Sales' });
  });

  it('never writes in dry-run mode (apply: false)', async () => {
    const db = fakeDb([{ _id: '1', contacts: [{ name: 'Jane', title: 'CEO' }] }]);
    const result = await backfillTitleNormalizationCollection(db, 'leads', { apply: false });

    expect(result.updated).toBe(1);
    expect(db._updates).toHaveLength(0);
  });

  it('is idempotent — a second run over already-backfilled data finds nothing to change', async () => {
    const alreadyBackfilled = [{ _id: '1', contacts: [{ name: 'Jane', title: 'CEO', seniorityTier: 'C-level', department: 'Executive' }] }];
    const db = fakeDb(alreadyBackfilled);
    const result = await backfillTitleNormalizationCollection(db, 'leads', { apply: true });

    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(db._updates).toHaveLength(0);
  });

  it('treats a document with no contacts as unchanged, never throwing', async () => {
    // The real Mongo query filters these out server-side
    // ({ contacts: { $exists: true, $not: { $size: 0 } } }) — this fake db
    // doesn't model query-level filtering, so it exercises the same
    // in-memory logic a real empty-contacts doc would hit if it slipped
    // through, confirming it degrades to "unchanged" rather than throwing.
    const db = fakeDb([{ _id: '1', contacts: [] }, { _id: '2' }]);
    const result = await backfillTitleNormalizationCollection(db, 'leads', { apply: true });
    expect(result.updated).toBe(0);
    expect(result.contactsUpdated).toBe(0);
    expect(db._updates).toHaveLength(0);
  });

  it('only updates the contacts within a document whose derived values actually changed', async () => {
    const db = fakeDb([
      {
        _id: '1',
        contacts: [
          { name: 'Already Right', title: 'CEO', seniorityTier: 'C-level', department: 'Executive' },
          { name: 'Needs Backfill', title: 'Sales Manager' },
        ],
      },
    ]);
    const result = await backfillTitleNormalizationCollection(db, 'leads', { apply: true });
    expect(result.contactsUpdated).toBe(1);
    expect(db._updates[0].set.contacts[0]).toMatchObject({ name: 'Already Right', seniorityTier: 'C-level' });
    expect(db._updates[0].set.contacts[1]).toMatchObject({ name: 'Needs Backfill', seniorityTier: 'Manager', department: 'Sales' });
  });
});
