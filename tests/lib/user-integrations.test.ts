import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomBytes } from 'crypto';

// Setup required encryption key before importing integration-store
process.env.INTEGRATION_CREDENTIALS_ENCRYPTION_KEY = randomBytes(32).toString('base64');
process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.GOOGLE_OAUTH_REDIRECT_URI = 'https://example.com/callback';

import {
  getUserConnection,
  listUserConnections,
  listActiveUserConnections,
  listAllActiveUserConnections,
  listAllActiveGmailConnections,
  upsertOAuthConnection,
  setUserDefaultConnection,
} from '../../app/lib/integration-store';

function matchesQuery(doc: any, query: any): boolean {
  if (!query || Object.keys(query).length === 0) return true;
  for (const [key, val] of Object.entries(query)) {
    if (key === '$or' && Array.isArray(val)) {
      if (!val.some((subQuery) => matchesQuery(doc, subQuery))) return false;
      continue;
    }
    if (typeof val === 'object' && val !== null) {
      if ('$exists' in val && Boolean(doc[key] !== undefined) !== val.$exists) return false;
      if ('$ne' in val && doc[key] === (val as any).$ne) return false;
      if ('$in' in val && Array.isArray((val as any).$in)) {
        if (!(val as any).$in.includes(doc[key])) return false;
        continue;
      }
    } else if (doc[key] !== val) {
      return false;
    }
  }
  return true;
}

describe('User Integrations Store (issue 247 & 252)', () => {
  let mockDb: any;
  let storedDocs: any[];
  let ssoDocs: any[];

  beforeEach(() => {
    storedDocs = [];
    ssoDocs = [];
    mockDb = {
      collection: (name: string) => {
        const pool = name === 'sso_user_access' ? ssoDocs : storedDocs;
        return {
          createIndex: vi.fn().mockResolvedValue('index_name'),
          findOne: vi.fn().mockImplementation((query: any) => {
            return Promise.resolve(pool.find((doc) => matchesQuery(doc, query)) || null);
          }),
          find: vi.fn().mockImplementation((query: any) => ({
            sort: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            next: vi.fn().mockImplementation(() => {
              return Promise.resolve(pool.find((doc) => matchesQuery(doc, query)) || null);
            }),
            toArray: vi.fn().mockImplementation(() => {
              return Promise.resolve(pool.filter((doc) => matchesQuery(doc, query)));
            }),
          })),
          updateOne: vi.fn().mockImplementation((filter: any, update: any) => {
            const setKeys = new Set(Object.keys(update.$set || {}));
            for (const key of Object.keys(update.$setOnInsert || {})) {
              if (setKeys.has(key)) {
                throw new Error(`Updating the path ${key} would create a conflict at ${key}`);
              }
            }
            let doc = pool.find((d) => {
              if (filter.id) return d.id === filter.id;
              if (filter.userId) {
                if (filter.userEmail) {
                  return d.userId === filter.userId && d.provider === filter.provider && d.userEmail === filter.userEmail;
                }
                return d.userId === filter.userId && d.provider === filter.provider;
              }
              return d.brand === filter.brand && d.tenantId === filter.tenantId && d.provider === filter.provider;
            });
            if (!doc) {
              doc = { ...(update.$setOnInsert || {}), ...(update.$set || {}) };
              pool.push(doc);
            } else {
              Object.assign(doc, update.$set);
            }
            return Promise.resolve({ matchedCount: 1, modifiedCount: 1 });
          }),
          updateMany: vi.fn().mockImplementation((filter: any, update: any) => {
            for (const doc of pool) {
              if (matchesQuery(doc, filter)) {
                Object.assign(doc, update.$set || {});
              }
            }
            return Promise.resolve({ acknowledged: true });
          }),
        };
      },
    };
  });

  it('upsertOAuthConnection stores user connection with userId and userEmail', async () => {
    await upsertOAuthConnection(mockDb, {
      brand: 'cogmap',
      tenantId: 'default',
      provider: 'gmail',
      accessToken: 'token_abc',
      refreshToken: 'refresh_abc',
      expiresInSeconds: 3600,
      scopes: ['https://www.googleapis.com/auth/gmail.send'],
      connectedBy: 'usr_123',
      userId: 'usr_123',
      userEmail: 'rep@example.com',
      providerAccountLabel: 'rep@example.com',
    });

    expect(storedDocs).toHaveLength(1);
    expect(storedDocs[0].userId).toBe('usr_123');
    expect(storedDocs[0].userEmail).toBe('rep@example.com');
    expect(storedDocs[0].providerAccountLabel).toBe('rep@example.com');
    expect(storedDocs[0].status).toBe('active');
    expect(storedDocs[0].encryptedCredentials).toBeDefined();
  });

  it('getUserConnection retrieves active connection for user and provider', async () => {
    storedDocs.push({
      id: 'conn_1',
      userId: 'usr_123',
      provider: 'gmail',
      userEmail: 'rep@example.com',
      status: 'active',
    });

    const conn = await getUserConnection(mockDb, 'usr_123', 'gmail');
    expect(conn).not.toBeNull();
    expect(conn?.id).toBe('conn_1');
    expect(conn?.userEmail).toBe('rep@example.com');
  });

  it('getUserConnection excludes revoked connection', async () => {
    storedDocs.push({
      id: 'conn_1',
      userId: 'usr_123',
      provider: 'gmail',
      userEmail: 'rep@example.com',
      status: 'revoked',
    });

    const conn = await getUserConnection(mockDb, 'usr_123', 'gmail');
    expect(conn).toBeNull();
  });

  it('listUserConnections strips encryptedCredentials from returned safe objects', async () => {
    storedDocs.push({
      id: 'conn_1',
      userId: 'usr_123',
      provider: 'gmail',
      userEmail: 'rep@example.com',
      status: 'active',
      encryptedCredentials: { iv: 'abc', ciphertext: 'xyz', tag: '123' },
    });

    const list = await listUserConnections(mockDb, 'usr_123');
    expect(list).toHaveLength(1);
    expect((list[0] as any).encryptedCredentials).toBeUndefined();
    expect(list[0].userEmail).toBe('rep@example.com');
  });

  it('listAllActiveGmailConnections returns all active Gmail connections', async () => {
    storedDocs.push(
      { id: 'conn_1', provider: 'gmail', status: 'active', userId: 'usr_1' },
      { id: 'conn_2', provider: 'gmail', status: 'active', userId: 'usr_2' },
      { id: 'conn_3', provider: 'google_calendar', status: 'active' },
      { id: 'conn_4', provider: 'gmail', status: 'revoked', userId: 'usr_3' }
    );

    const gmailConns = await listAllActiveGmailConnections(mockDb);
    expect(gmailConns).toHaveLength(2);
    expect(gmailConns.map((c) => c.id)).toEqual(['conn_1', 'conn_2']);
  });

  it('isGoogleOAuthConfigured reflects environment presence accurately', async () => {
    const { isGoogleOAuthConfigured } = await import('../../app/lib/integration-store');
    expect(isGoogleOAuthConfigured()).toBe(true);

    const origSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    expect(isGoogleOAuthConfigured()).toBe(false);
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = origSecret;
    expect(isGoogleOAuthConfigured()).toBe(true);
  });

  it('upsertOAuthConnection preserves existing refreshToken when params.refreshToken is omitted', async () => {
    const { decryptCredentials } = await import('../../lib/integration-crypto');

    // First insert with refresh token
    await upsertOAuthConnection(mockDb, {
      brand: 'cogmap',
      tenantId: 'default',
      provider: 'gmail',
      accessToken: 'token_1',
      refreshToken: 'refresh_keep_me',
      expiresInSeconds: 3600,
      scopes: ['gmail.send'],
      connectedBy: 'usr_123',
      userId: 'usr_123',
      userEmail: 'rep@example.com',
    });

    expect(storedDocs).toHaveLength(1);

    // Second upsert without refresh token (e.g. Google reconnect grant where refresh_token is not re-issued)
    await upsertOAuthConnection(mockDb, {
      brand: 'cogmap',
      tenantId: 'default',
      provider: 'gmail',
      accessToken: 'token_2',
      expiresInSeconds: 3600,
      scopes: ['gmail.send'],
      connectedBy: 'usr_123',
      userId: 'usr_123',
      userEmail: 'rep@example.com',
    });

    expect(storedDocs).toHaveLength(1);
    const creds = decryptCredentials<{ accessToken: string; refreshToken?: string }>(storedDocs[0].encryptedCredentials);
    expect(creds.accessToken).toBe('token_2');
    expect(creds.refreshToken).toBe('refresh_keep_me');
  });

  it('ensureIntegrationConnectionIndexes drops legacy index when present', async () => {
    const { ensureIntegrationConnectionIndexes } = await import('../../app/lib/integration-store');
    const droppedIndexes: string[] = [];
    const testDb: any = {
      collection: () => ({
        indexes: vi.fn().mockResolvedValue([{ name: 'brand_1_tenantId_1_provider_1' }]),
        dropIndex: vi.fn().mockImplementation((name: string) => {
          droppedIndexes.push(name);
          return Promise.resolve();
        }),
        createIndex: vi.fn().mockResolvedValue('ok'),
      }),
    };

    await ensureIntegrationConnectionIndexes(testDb, true);
    expect(droppedIndexes).toContain('brand_1_tenantId_1_provider_1');
  });

  it('supports multiple Google accounts for the same user with distinct emails (issue 252)', async () => {
    // First account connected becomes default automatically
    await upsertOAuthConnection(mockDb, {
      brand: 'cogmap',
      tenantId: 'default',
      provider: 'gmail',
      accessToken: 'token_personal',
      refreshToken: 'refresh_personal',
      scopes: ['gmail.send'],
      connectedBy: 'usr_sso_1',
      userId: 'usr_sso_1',
      userEmail: 'personal@gmail.com',
    });

    expect(storedDocs).toHaveLength(1);
    expect(storedDocs[0].userEmail).toBe('personal@gmail.com');
    expect(storedDocs[0].isDefault).toBe(true);

    // Second account connected for the same user is not default
    await upsertOAuthConnection(mockDb, {
      brand: 'cogmap',
      tenantId: 'default',
      provider: 'gmail',
      accessToken: 'token_work',
      refreshToken: 'refresh_work',
      scopes: ['gmail.send'],
      connectedBy: 'usr_sso_1',
      userId: 'usr_sso_1',
      userEmail: 'work@company.com',
    });

    expect(storedDocs).toHaveLength(2);
    expect(storedDocs[1].userEmail).toBe('work@company.com');
    expect(storedDocs[1].isDefault).toBe(false);

    // Default connection lookup returns personal@gmail.com
    const defaultConn = await getUserConnection(mockDb, 'usr_sso_1', 'gmail');
    expect(defaultConn?.userEmail).toBe('personal@gmail.com');

    // Targeted connection lookup returns work@company.com
    const targetedConn = await getUserConnection(mockDb, 'usr_sso_1', 'gmail', 'work@company.com');
    expect(targetedConn?.userEmail).toBe('work@company.com');

    // Switching default to work account
    const switched = await setUserDefaultConnection(mockDb, 'usr_sso_1', 'gmail', storedDocs[1].id);
    expect(switched).toBe(true);
    expect(storedDocs[0].isDefault).toBe(false);
    expect(storedDocs[1].isDefault).toBe(true);

    const newDefaultConn = await getUserConnection(mockDb, 'usr_sso_1', 'gmail');
    expect(newDefaultConn?.userEmail).toBe('work@company.com');
  });

  it('resolves active connections across linked SSO accounts and admin-managed aliases', async () => {
    // Setup SSO linked account: Csaba personal SSO ID linked with corporate Workspace email
    ssoDocs.push({
      ssoUserId: 'sso_csaba_personal',
      email: 'moldovancsaba@gmail.com',
      aliases: ['coo@seyuselfies.com', 'office@seyuselfies.com'],
    });

    // Connection created under corporate account
    storedDocs.push({
      id: 'conn_coo',
      userId: 'sso_csaba_corporate',
      brand: 'seyu',
      tenantId: 'default',
      provider: 'gmail',
      userEmail: 'coo@seyuselfies.com',
      status: 'active',
      isDefault: true,
      updatedAt: new Date().toISOString(),
    });

    // When queried using personal SSO ID 'sso_csaba_personal', it resolves the linked corporate connection
    const activeConns = await listActiveUserConnections(mockDb, 'sso_csaba_personal', 'gmail');
    expect(activeConns).toHaveLength(1);
    expect(activeConns[0].userEmail).toBe('coo@seyuselfies.com');

    // Targeted lookup for coo@seyuselfies.com using personal SSO ID succeeds
    const targetedConn = await getUserConnection(mockDb, 'sso_csaba_personal', 'gmail', 'coo@seyuselfies.com');
    expect(targetedConn).not.toBeNull();
    expect(targetedConn?.id).toBe('conn_coo');
  });

  it('listUserConnections excludes revoked connections', async () => {
    storedDocs.push(
      {
        id: 'conn_active',
        userId: 'usr_active_test',
        provider: 'gmail',
        userEmail: 'active@seyu.com',
        status: 'active',
        updatedAt: '2026-10-22T00:00:00.000Z',
      },
      {
        id: 'conn_revoked',
        userId: 'usr_active_test',
        provider: 'gmail',
        userEmail: 'revoked@seyu.com',
        status: 'revoked',
        revokedAt: '2026-10-22T00:00:00.000Z',
        updatedAt: '2026-10-22T00:00:00.000Z',
      }
    );

    const conns = await listUserConnections(mockDb, 'usr_active_test');
    expect(conns).toHaveLength(1);
    expect(conns[0].userEmail).toBe('active@seyu.com');
  });

  it('disconnectUserConnection revokes connection across linked accounts and promotes next active connection', async () => {
    ssoDocs.push({
      ssoUserId: 'sso_user_primary',
      email: 'primary@example.com',
      aliases: ['corp@company.com'],
    });

    storedDocs.push(
      {
        id: 'conn_corp',
        userId: 'sso_user_corp',
        provider: 'gmail',
        userEmail: 'corp@company.com',
        status: 'active',
        isDefault: true,
        updatedAt: '2026-10-22T00:00:00.000Z',
      },
      {
        id: 'conn_primary',
        userId: 'sso_user_primary',
        provider: 'gmail',
        userEmail: 'primary@example.com',
        status: 'active',
        isDefault: false,
        updatedAt: '2026-10-21T00:00:00.000Z',
      }
    );

    // Rep calls disconnect on the linked corporate connection using primary SSO id
    const { disconnectUserConnection } = await import('../../app/lib/integration-store');
    const ok = await disconnectUserConnection(mockDb, 'sso_user_primary', 'gmail', 'conn_corp');
    expect(ok).toBe(true);

    // Corporate connection is now revoked
    const revokedDoc = storedDocs.find((d) => d.id === 'conn_corp');
    expect(revokedDoc?.status).toBe('revoked');
    expect(revokedDoc?.revokedAt).toBeDefined();

    // Primary connection was promoted to default
    const promotedDoc = storedDocs.find((d) => d.id === 'conn_primary');
    expect(promotedDoc?.isDefault).toBe(true);

    // listUserConnections called with primary SSO id now only lists primary connection
    const remaining = await listUserConnections(mockDb, 'sso_user_primary');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userEmail).toBe('primary@example.com');
  });
});

