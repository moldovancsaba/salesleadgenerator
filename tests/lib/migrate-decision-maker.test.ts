import { describe, it, expect } from 'vitest';
import { migrateDecisionMakerCollection } from '../../lib/migrate-decision-maker';

// Minimal fake mirroring the subset of the mongodb driver's Collection API
// this module actually uses (find().{async iterate} + updateOne).
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

describe('migrateDecisionMakerCollection', () => {
  it('merges a legacy string decision_maker_contact into contacts[]', async () => {
    const db = fakeDb([
      { _id: '1', decision_maker_name: 'Jane Doe', decision_maker_contact: 'jane@example.com', contacts: [] },
    ]);
    const result = await migrateDecisionMakerCollection(db, 'leads', { apply: false });
    expect(result.scanned).toBe(1);
    expect(result.merged).toBe(1);
    expect(result.docs[0].outcome).toBe('merged');
  });

  it('does not throw on a non-string decision_maker_contact (real production bug, issue #45)', async () => {
    const db = fakeDb([
      { _id: '2', decision_maker_name: 'Bad Data Org', decision_maker_contact: { nested: 'object' }, contacts: [] },
      { _id: '3', decision_maker_name: 'Numeric Contact', decision_maker_contact: 12345, contacts: [] },
      { _id: '4', decision_maker_name: 'Array Contact', decision_maker_contact: ['a', 'b'], contacts: [] },
    ]);
    const result = await migrateDecisionMakerCollection(db, 'leads', { apply: false });
    expect(result.scanned).toBe(3);
    // name alone is still enough to merge a contact even when the contact
    // value itself is unusable garbage — email/phone just stay empty.
    expect(result.merged).toBe(3);
  });

  it('skips a doc with no name and no usable email/phone (cleared-only)', async () => {
    const db = fakeDb([{ _id: '5', decision_maker_contact: { nested: 'object' }, contacts: [] }]);
    const result = await migrateDecisionMakerCollection(db, 'leads', { apply: false });
    expect(result.clearedOnly).toBe(1);
    expect(result.merged).toBe(0);
  });

  it('does not write when apply is false', async () => {
    const db = fakeDb([{ _id: '6', decision_maker_name: 'Jane', contacts: [] }]);
    await migrateDecisionMakerCollection(db, 'leads', { apply: false });
    expect(db._updates).toHaveLength(0);
  });

  it('writes updateOne calls when apply is true', async () => {
    const db = fakeDb([{ _id: '7', decision_maker_name: 'Jane', contacts: [] }]);
    await migrateDecisionMakerCollection(db, 'leads', { apply: true });
    expect(db._updates).toHaveLength(1);
    expect(db._updates[0].set.decision_maker_name).toBe('');
    expect(db._updates[0].set.contacts[0].name).toBe('Jane');
    expect(db._updates[0].set.contacts[0].isDecisionMaker).toBe(true);
  });

  it('skips a contact already represented in contacts[] rather than duplicating it', async () => {
    const db = fakeDb([
      {
        _id: '8',
        decision_maker_name: 'Jane',
        decision_maker_contact: 'jane@example.com',
        contacts: [{ name: 'Jane', email: 'jane@example.com', isDecisionMaker: true }],
      },
    ]);
    const result = await migrateDecisionMakerCollection(db, 'leads', { apply: false });
    expect(result.alreadyRepresented).toBe(1);
    expect(result.merged).toBe(0);
  });
});
