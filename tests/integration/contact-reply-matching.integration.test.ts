import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';
import { buildApiRequest } from './helpers/api-request';

// Issue #142 — exercises lib/contact-reply-matching.ts directly against a
// real Mongo instance (mongodb-memory-server), with leads created through the
// actual POST /api/leads route so contactEmails[] is populated exactly the
// way production writes it, not hand-inserted to match what the matcher
// expects.

let mongod: MongoMemoryServer;
let leadsPOST: typeof import('../../app/api/leads/route').POST;
let matchReplyToLeads: typeof import('../../lib/contact-reply-matching').matchReplyToLeads;
let findMatchedContact: typeof import('../../lib/contact-reply-matching').findMatchedContact;
let generateContactSuggestion: typeof import('../../lib/contact-reply-matching').generateContactSuggestion;
let getClientPromise: typeof import('../../lib/mongodb').getClientPromise;

beforeAll(async () => {
  mongod = await startTestMongo();
  const leadsMod = await import('../../app/api/leads/route');
  leadsPOST = leadsMod.POST;
  const matchingMod = await import('../../lib/contact-reply-matching');
  matchReplyToLeads = matchingMod.matchReplyToLeads;
  findMatchedContact = matchingMod.findMatchedContact;
  generateContactSuggestion = matchingMod.generateContactSuggestion;
  const mongodbMod = await import('../../lib/mongodb');
  getClientPromise = mongodbMod.getClientPromise;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

function req(url: string, init?: Parameters<typeof buildApiRequest>[1]) {
  return buildApiRequest(url, init);
}

async function createLead(brand: 'cogmap' | 'seyu', entityName: string, contacts: any[]): Promise<string> {
  const res = await leadsPOST(req(`/api/leads?brand=${brand}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      entity_name: entityName,
      url: `https://${entityName.toLowerCase().replace(/\s+/g, '-')}.example.com`,
      country: 'US',
      kanbanColumn: 'DISCOVERED',
      ice: { impact: 5, confidence: 5, ease: 5 },
      contacts,
    }),
  }));
  expect(res.status).toBe(201);
  const body = await res.json();
  return body.lead._id;
}

async function getDb() {
  const client = await getClientPromise();
  return client.db();
}

describe('matchReplyToLeads (issue #142)', () => {
  it('returns no-match when no lead has the sender email in contactEmails[]', async () => {
    const db = await getDb();
    const result = await matchReplyToLeads(db, 'cogmap', 'default', 'nobody@nowhere.example.com');
    expect(result).toEqual({ kind: 'no-match' });
  });

  it('returns single-match for a sender email listed on exactly one lead', async () => {
    const leadId = await createLead('cogmap', 'Match Single FC', [{ name: 'Jane Doe', email: 'jane.single@example.com' }]);
    const db = await getDb();
    const result = await matchReplyToLeads(db, 'cogmap', 'default', 'JANE.SINGLE@Example.com');
    expect(result).toEqual({ kind: 'single-match', leadId });
  });

  it('returns multi-match when the same email is a contact on more than one lead', async () => {
    await createLead('cogmap', 'Multi Match A', [{ name: 'Shared Agent', email: 'shared.agent@example.com' }]);
    await createLead('cogmap', 'Multi Match B', [{ name: 'Shared Agent', email: 'shared.agent@example.com' }]);
    const db = await getDb();
    const result = await matchReplyToLeads(db, 'cogmap', 'default', 'shared.agent@example.com');
    expect(result.kind).toBe('multi-match');
    expect((result as any).leadIds).toHaveLength(2);
  });

  it('does not match a lead from a different brand', async () => {
    await createLead('seyu', 'Seyu Only Match Org', [{ name: 'Seyu Only', email: 'seyu.only@example.com' }]);
    const db = await getDb();
    const result = await matchReplyToLeads(db, 'cogmap', 'default', 'seyu.only@example.com');
    expect(result).toEqual({ kind: 'no-match' });
  });

  it('returns no-match for an empty sender address', async () => {
    const db = await getDb();
    const result = await matchReplyToLeads(db, 'cogmap', 'default', '');
    expect(result).toEqual({ kind: 'no-match' });
  });
});

describe('findMatchedContact (issue #142)', () => {
  it('finds the specific contact within the lead owning the sender email', async () => {
    const leadId = await createLead('cogmap', 'Find Contact FC', [
      { name: 'Other Contact', email: 'other@example.com' },
      { name: 'Target Contact', email: 'target.contact@example.com', title: 'Director' },
    ]);
    const db = await getDb();
    const contact = await findMatchedContact(db, 'cogmap', 'default', leadId, 'target.contact@example.com');
    expect(contact?.name).toBe('Target Contact');
    expect(contact?.title).toBe('Director');
  });

  it('returns null for an invalid leadId', async () => {
    const db = await getDb();
    const contact = await findMatchedContact(db, 'cogmap', 'default', 'not-an-object-id', 'a@b.com');
    expect(contact).toBeNull();
  });
});

describe('generateContactSuggestion (issue #142)', () => {
  it('creates a pending suggestion when the signature reveals a changed title/phone', async () => {
    const leadId = await createLead('cogmap', 'Suggestion FC', [
      { name: 'Alex Chen', email: 'alex.chen@example.com', title: 'Manager' },
    ]);
    const db = await getDb();
    const bodyText = [
      'Thanks, sounds good.',
      '',
      'Best regards,',
      'Alex Chen',
      'Director of Partnerships',
      '+1 555 987 6543',
    ].join('\n');

    const suggestion = await generateContactSuggestion(db, 'cogmap', 'default', leadId, 'alex.chen@example.com', bodyText, 'activity-1');
    expect(suggestion).not.toBeNull();
    expect(suggestion?.leadId).toBe(leadId);
    expect(suggestion?.status).toBe('pending');
    expect(suggestion?.current.title).toBe('Manager');
    expect(suggestion?.suggested.title).toBe('Director of Partnerships');
    expect(suggestion?.suggested.phone).toBe('+15559876543');
    expect(suggestion?.sourceActivityLogId).toBe('activity-1');

    const stored = await db.collection('contactSuggestions').findOne({ leadId });
    expect(stored).toBeDefined();
    expect(stored?.status).toBe('pending');
  });

  it('returns null when the signature matches what is already stored (no genuine diff)', async () => {
    const leadId = await createLead('cogmap', 'No Diff FC', [
      { name: 'Sam Rivera', email: 'sam.rivera@example.com', title: 'VP of Sales' },
    ]);
    const db = await getDb();
    const bodyText = ['Sure thing.', '', 'Regards,', 'Sam Rivera', 'VP of Sales'].join('\n');

    const suggestion = await generateContactSuggestion(db, 'cogmap', 'default', leadId, 'sam.rivera@example.com', bodyText, 'activity-2');
    expect(suggestion).toBeNull();
  });

  it('returns null when the body has no signature-shaped content', async () => {
    const leadId = await createLead('cogmap', 'No Signature FC', [
      { name: 'Taylor Kim', email: 'taylor.kim@example.com' },
    ]);
    const db = await getDb();
    const suggestion = await generateContactSuggestion(db, 'cogmap', 'default', leadId, 'taylor.kim@example.com', 'yes that works for me', 'activity-3');
    expect(suggestion).toBeNull();
  });

  it('returns null when the sender email does not match any contact on the lead', async () => {
    const leadId = await createLead('cogmap', 'Unmatched Sender FC', [
      { name: 'Real Contact', email: 'real.contact@example.com' },
    ]);
    const db = await getDb();
    const bodyText = ['Regards,', 'Someone Else', 'CEO', '+1 555 111 2222'].join('\n');
    const suggestion = await generateContactSuggestion(db, 'cogmap', 'default', leadId, 'unlisted@example.com', bodyText, 'activity-4');
    expect(suggestion).toBeNull();
  });
});
