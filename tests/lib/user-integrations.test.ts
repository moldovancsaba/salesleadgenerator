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
  listAllActiveUserConnections,
  listAllActiveGmailConnections,
  upsertOAuthConnection,
} from '../../app/lib/integration-store';

describe('User Integrations Store (issue #247)', () => {
  let mockDb: any;
  let storedDocs: any[];

  beforeEach(() => {
    storedDocs = [];
    mockDb = {
      collection: (name: string) => ({
        createIndex: vi.fn().mockResolvedValue('index_name'),
        findOne: vi.fn().mockImplementation((query: any) => {
          return Promise.resolve(
            storedDocs.find((doc) => {
              for (const [key, val] of Object.entries(query)) {
                if (typeof val === 'object' && val !== null && '$ne' in val) {
                  if (doc[key] === (val as any).$ne) return false;
                } else if (doc[key] !== val) {
                  return false;
                }
              }
              return true;
            }) || null
          );
        }),
        find: vi.fn().mockImplementation((query: any) => ({
          sort: vi.fn().mockReturnThis(),
          toArray: vi.fn().mockImplementation(() => {
            return Promise.resolve(
              storedDocs.filter((doc) => {
                for (const [key, val] of Object.entries(query)) {
                  if (typeof val === 'object' && val !== null) {
                    if ('$exists' in val && Boolean(doc[key] !== undefined) !== val.$exists) return false;
                    if ('$ne' in val && doc[key] === val.$ne) return false;
                  } else if (doc[key] !== val) {
                    return false;
                  }
                }
                return true;
              })
            );
          }),
        })),
        updateOne: vi.fn().mockImplementation((filter: any, update: any) => {
          let doc = storedDocs.find((d) => {
            if (filter.userId) return d.userId === filter.userId && d.provider === filter.provider;
            return d.brand === filter.brand && d.tenantId === filter.tenantId && d.provider === filter.provider;
          });
          if (!doc) {
            doc = { ...(update.$setOnInsert || {}), ...(update.$set || {}) };
            storedDocs.push(doc);
          } else {
            Object.assign(doc, update.$set || {});
          }
          return Promise.resolve({ acknowledged: true });
        }),
      }),
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
});

