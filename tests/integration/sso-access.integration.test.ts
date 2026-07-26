import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { startTestMongo, stopTestMongo } from './helpers/mongo-test-server';

let mongod: MongoMemoryServer;
let upsertUserSeen: typeof import('../../lib/sso-access').upsertUserSeen;
let getUserAccess: typeof import('../../lib/sso-access').getUserAccess;
let listAllUserAccess: typeof import('../../lib/sso-access').listAllUserAccess;
let setUserOrgAccess: typeof import('../../lib/sso-access').setUserOrgAccess;

beforeAll(async () => {
  mongod = await startTestMongo();
  const mod = await import('../../lib/sso-access');
  upsertUserSeen = mod.upsertUserSeen;
  getUserAccess = mod.getUserAccess;
  listAllUserAccess = mod.listAllUserAccess;
  setUserOrgAccess = mod.setUserOrgAccess;
}, 60000);

afterAll(async () => {
  await stopTestMongo(mongod);
});

async function getDb() {
  const clientPromise = (await import('../../lib/mongodb')).default;
  const client = await clientPromise;
  return client.db();
}

describe('lib/sso-access — real MongoDB round trip', () => {
  it('upsertUserSeen creates a new record with empty orgAccess on first login', async () => {
    const db = await getDb();
    const record = await upsertUserSeen(db, { ssoUserId: 'sso-user-1', email: 'newperson@example.com', name: 'New Person' });
    expect(record.ssoUserId).toBe('sso-user-1');
    expect(record.email).toBe('newperson@example.com');
    expect(record.orgAccess).toEqual({});
    expect(record.createdAt).toBeTruthy();
  });

  it('upsertUserSeen on a second login updates email/name without touching orgAccess', async () => {
    const db = await getDb();
    await upsertUserSeen(db, { ssoUserId: 'sso-user-2', email: 'old@example.com', name: 'Old Name' });
    await setUserOrgAccess(db, 'sso-user-2', 'cogmap', 'admin');

    const record = await upsertUserSeen(db, { ssoUserId: 'sso-user-2', email: 'new@example.com', name: 'New Name' });
    expect(record.email).toBe('new@example.com');
    expect(record.name).toBe('New Name');
    expect(record.orgAccess).toEqual({ cogmap: 'admin' });
  });

  it('setUserOrgAccess grants and later revokes access to a single brand', async () => {
    const db = await getDb();
    await upsertUserSeen(db, { ssoUserId: 'sso-user-3', email: 'grantee@example.com' });

    const granted = await setUserOrgAccess(db, 'sso-user-3', 'seyu', 'user');
    expect(granted?.orgAccess).toEqual({ seyu: 'user' });

    const revoked = await setUserOrgAccess(db, 'sso-user-3', 'seyu', null);
    expect(revoked?.orgAccess).toEqual({});
  });

  it('setUserOrgAccess manages cogmap and seyu independently on the same user', async () => {
    const db = await getDb();
    await upsertUserSeen(db, { ssoUserId: 'sso-user-4', email: 'both@example.com' });
    await setUserOrgAccess(db, 'sso-user-4', 'cogmap', 'user');
    const record = await setUserOrgAccess(db, 'sso-user-4', 'seyu', 'admin');
    expect(record?.orgAccess).toEqual({ cogmap: 'user', seyu: 'admin' });
  });

  it('setUserOrgAccess returns null for a user who has never logged in', async () => {
    const db = await getDb();
    const result = await setUserOrgAccess(db, 'never-seen-user', 'cogmap', 'user');
    expect(result).toBeNull();
  });

  it('setUserOrgAccess rejects an unknown brand', async () => {
    const db = await getDb();
    await upsertUserSeen(db, { ssoUserId: 'sso-user-5', email: 'x@example.com' });
    await expect(setUserOrgAccess(db, 'sso-user-5', 'not-a-real-brand' as any, 'user')).rejects.toThrow();
  });

  it('getUserAccess returns null for an unknown user', async () => {
    const db = await getDb();
    expect(await getUserAccess(db, 'totally-unknown')).toBeNull();
  });

  it('listAllUserAccess returns every user seen so far', async () => {
    const db = await getDb();
    const all = await listAllUserAccess(db);
    const ids = all.map((r) => r.ssoUserId);
    expect(ids).toEqual(expect.arrayContaining(['sso-user-1', 'sso-user-2', 'sso-user-3', 'sso-user-4', 'sso-user-5']));
  });
});
