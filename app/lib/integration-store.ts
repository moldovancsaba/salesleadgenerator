import type { Db } from 'mongodb';
import { encryptCredentials, decryptCredentials } from '../../lib/integration-crypto';
import {
  type IntegrationConnection, type IntegrationProvider, type IntegrationStatus,
  oauthConfigFor, apiKeyConfigFor,
} from '../../lib/integration-connections';
import { fetchWithRetry } from '../../lib/integration-http';
import { resolveLinkedUserIdentities } from '../../lib/sso-access';

export const INTEGRATION_CONNECTIONS_COLLECTION = 'integration_connections';

const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || '';

export function isGoogleOAuthConfigured(): boolean {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI || GOOGLE_OAUTH_REDIRECT_URI;
  return Boolean(clientId && clientSecret && redirectUri);
}

export { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI };

const indexesEnsured = new Set<string>();
export async function ensureIntegrationConnectionIndexes(db: Db, force = false): Promise<void> {
  if (!force && indexesEnsured.has('done')) return;
  try {
    const col = db.collection(INTEGRATION_CONNECTIONS_COLLECTION);
    // If legacy unique index on { brand, tenantId, provider } exists from Issue #217,
    // drop it so user-level connections (which share brand/tenantId) can be saved without collision.
    if (typeof col.indexes === 'function') {
      const existing = await col.indexes().catch(() => []);
      const legacy = existing.find((i: any) => i.name === 'brand_1_tenantId_1_provider_1');
      if (legacy && typeof col.dropIndex === 'function') {
        try {
          await col.dropIndex('brand_1_tenantId_1_provider_1');
        } catch (dropErr) {
          console.warn('[integration-store] dropIndex brand_1_tenantId_1_provider_1 warning:', dropErr);
        }
      }
      const oldUserIndex = existing.find((i: any) => i.name === 'userId_1_provider_1');
      if (oldUserIndex && typeof col.dropIndex === 'function') {
        try {
          await col.dropIndex('userId_1_provider_1');
        } catch (dropErr) {
          console.warn('[integration-store] dropIndex userId_1_provider_1 warning:', dropErr);
        }
      }
    }

    // Partial compound index on userId + provider + userEmail for individual user accounts (issue 247, 252)
    // Allows a user to connect multiple distinct Google accounts for the same provider without collisions.
    await col.createIndex(
      { userId: 1, provider: 1, userEmail: 1 },
      {
        unique: true,
        partialFilterExpression: { userId: { $type: 'string' }, userEmail: { $type: 'string' } },
      }
    );
    // Compound index for brand/tenant scoped connections
    await col.createIndex(
      { brand: 1, tenantId: 1, provider: 1, userId: 1 },
      { unique: true }
    );
    indexesEnsured.add('done');
  } catch (error) {
    console.error('[integration-store] index creation failed', error);
  }
}

// Issue #228: the OAuth state for a Google connect is kept server-side,
// single-use, instead of trusting the browser cookie for brand, tenant,
// provider and user — that cookie was plain JSON anyone could rewrite. The
// cookie still carries `state` (binding the callback to the browser that
// started the flow) and the brand used only to pick a redirect target.
export const INTEGRATION_OAUTH_STATES_COLLECTION = 'integration_oauth_states';

export type PendingOAuthState = {
  state: string;
  provider: IntegrationProvider;
  brand: string;
  tenantId: string;
  ssoUserId: string;
  scopeType?: 'user' | 'brand';
  returnUrl?: string;
  expiresAt: Date;
};

let oauthStateIndexesEnsured = false;
async function ensureOAuthStateIndexes(db: Db): Promise<void> {
  if (oauthStateIndexesEnsured) return;
  try {
    await db.collection(INTEGRATION_OAUTH_STATES_COLLECTION).createIndex({ state: 1 }, { unique: true });
    // TTL cleanup only; expiry itself is enforced in consumePendingOAuthState,
    // since Mongo's TTL monitor runs about once a minute.
    await db.collection(INTEGRATION_OAUTH_STATES_COLLECTION).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    oauthStateIndexesEnsured = true;
  } catch (error) {
    console.error('[integration-store] oauth state index creation failed', error);
  }
}

export async function savePendingOAuthState(db: Db, record: PendingOAuthState): Promise<void> {
  await ensureOAuthStateIndexes(db);
  await db.collection(INTEGRATION_OAUTH_STATES_COLLECTION).insertOne({ ...record });
}

// Deletes on read, so a state can complete at most one callback — a replayed
// or second callback for the same state finds nothing.
export async function consumePendingOAuthState(db: Db, state: string): Promise<PendingOAuthState | null> {
  const doc = await db.collection(INTEGRATION_OAUTH_STATES_COLLECTION).findOneAndDelete({ state });
  if (!doc) return null;
  if (!(doc.expiresAt instanceof Date) || doc.expiresAt.getTime() <= Date.now()) return null;
  const { _id, ...rest } = doc;
  return rest as unknown as PendingOAuthState;
}

function makeId(): string {
  return `intconn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// Never includes encryptedCredentials — a stored ciphertext blob has zero
// legitimate UI use and no route (GET /api/integrations/connections, this
// repo's own convention for lib/scoped-api-keys.ts's listApiKeys) should
// ever return it.
export type SafeIntegrationConnection = Omit<IntegrationConnection, 'encryptedCredentials'>;

function toSafe(doc: any): SafeIntegrationConnection {
  const { encryptedCredentials, _id, ...rest } = doc;
  return rest as SafeIntegrationConnection;
}

export async function listConnections(db: Db, brand: string, tenantId: string): Promise<SafeIntegrationConnection[]> {
  const docs = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).find({ brand, tenantId }).sort({ provider: 1 }).toArray();
  return docs.map(toSafe);
}

export async function getConnectionById(db: Db, id: string): Promise<IntegrationConnection | null> {
  const doc = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).findOne({ id });
  return doc as unknown as IntegrationConnection | null;
}

// Looks up a brand's single connection for a given provider directly by
// its natural key, for a consuming feature that only has {brand, tenantId,
// provider} in hand and no connectionId (e.g. issue #216's Gmail-sync
// cron, which has no per-request caller to hand it one). Only ever returns
// an active connection — a revoked one is treated identically to "not
// connected," never silently retried.
export async function getActiveConnectionByProvider(
  db: Db, brand: string, tenantId: string, provider: IntegrationProvider
): Promise<IntegrationConnection | null> {
  const doc = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).findOne({ brand, tenantId, provider, status: { $ne: 'revoked' } });
  return doc as unknown as IntegrationConnection | null;
}

export async function upsertOAuthConnection(
  db: Db,
  params: {
    brand: string; tenantId: string; provider: IntegrationProvider;
    accessToken: string; refreshToken?: string; expiresInSeconds?: number;
    scopes: string[]; connectedBy: string;
    userId?: string; userEmail?: string; providerAccountLabel?: string;
  }
): Promise<void> {
  await ensureIntegrationConnectionIndexes(db);
  const now = new Date().toISOString();

  let refreshToken = params.refreshToken;
  if (!refreshToken && params.userId) {
    const existing = await getUserConnection(db, params.userId, params.provider, params.userEmail);
    if (existing?.encryptedCredentials) {
      try {
        const oldCreds = decryptCredentials<{ refreshToken?: string }>(existing.encryptedCredentials);
        if (oldCreds.refreshToken) refreshToken = oldCreds.refreshToken;
      } catch {
        // Non-fatal
      }
    }
  }

  const blob = encryptCredentials({ accessToken: params.accessToken, refreshToken });
  const expiresIn = Number(params.expiresInSeconds) || 3600;
  const accessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // If userId is present, key uniquely on userId + provider + userEmail (issue 252)
  // so users can connect multiple Google accounts.
  let filter: Record<string, any>;
  if (params.userId) {
    if (params.userEmail) {
      filter = { userId: params.userId, provider: params.provider, userEmail: params.userEmail };
    } else {
      filter = { userId: params.userId, provider: params.provider };
    }
  } else {
    filter = { brand: params.brand, tenantId: params.tenantId, provider: params.provider, userId: { $in: [null, undefined] } };
  }

  // Check if user already has an active connection for this provider; if none, set as default
  let isDefault = false;
  if (params.userId) {
    const existingActive = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).findOne({
      userId: params.userId,
      provider: params.provider,
      status: 'active',
    });
    isDefault = !existingActive;
  }

  const $set: Record<string, any> = {
    authMethod: 'oauth2', encryptedCredentials: blob, accessTokenExpiresAt,
    scopes: params.scopes, connectedBy: params.connectedBy, status: 'active' as IntegrationStatus,
    connectedAt: now, updatedAt: now, revokedAt: null, lastVerifiedAt: now,
  };
  if (params.userId) $set.userId = params.userId;
  if (params.userEmail) $set.userEmail = params.userEmail;
  if (params.providerAccountLabel) $set.providerAccountLabel = params.providerAccountLabel;

  await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).updateOne(
    filter,
    {
      $set,
      $setOnInsert: {
        id: makeId(),
        brand: params.brand,
        tenantId: params.tenantId,
        provider: params.provider,
        ...(params.userId ? { isDefault } : {}),
      },
      $unset: { lastSyncError: '' },
    },
    { upsert: true }
  );
}

// User-level connection accessors (issue #247, enhanced for multi-account in issue #252 and linked aliases in issue #271)
export async function getUserConnection(
  db: Db, userId: string, provider: IntegrationProvider, connectionIdOrEmail?: string
): Promise<IntegrationConnection | null> {
  const { userIds, emails } = await resolveLinkedUserIdentities(db, userId);

  const hasMultiple = userIds.length > 1 || emails.length > 0;
  const userClause: Record<string, any> = hasMultiple
    ? {
        $or: [
          { userId: { $in: userIds } },
          { connectedBy: { $in: userIds } },
          ...(emails.length > 0 ? [{ userEmail: { $in: emails } }] : []),
        ],
      }
    : { userId };

  const baseQuery: Record<string, any> = {
    ...userClause,
    provider,
    status: { $ne: 'revoked' },
  };

  if (connectionIdOrEmail) {
    const isEmail = connectionIdOrEmail.includes('@');
    if (isEmail) {
      const normEmail = connectionIdOrEmail.toLowerCase().trim();
      const byEmail = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).findOne({
        ...baseQuery,
        ...(hasMultiple
          ? { $or: [{ userEmail: normEmail }, { providerAccountLabel: normEmail }] }
          : { userEmail: normEmail }),
      });
      if (byEmail) return byEmail as unknown as IntegrationConnection;
    } else {
      const byId = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).findOne({
        ...baseQuery,
        id: connectionIdOrEmail,
      });
      if (byId) return byId as unknown as IntegrationConnection;
    }
    return null;
  }

  // Try finding explicit default first, otherwise fall back to any active connection
  const defaultDoc = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).findOne({
    ...baseQuery,
    isDefault: true,
  });
  if (defaultDoc) return defaultDoc as unknown as IntegrationConnection;

  const doc = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).findOne(baseQuery);
  return doc as unknown as IntegrationConnection | null;
}

export async function listUserConnections(
  db: Db, userId: string, provider?: IntegrationProvider
): Promise<SafeIntegrationConnection[]> {
  const { userIds, emails } = await resolveLinkedUserIdentities(db, userId);

  const hasMultiple = userIds.length > 1 || emails.length > 0;
  const query: Record<string, any> = {
    ...(hasMultiple
      ? {
          $or: [
            { userId: { $in: userIds } },
            { connectedBy: { $in: userIds } },
            ...(emails.length > 0 ? [{ userEmail: { $in: emails } }] : []),
          ],
        }
      : { userId }),
  };
  if (provider) query.provider = provider;
  const cursor = db.collection(INTEGRATION_CONNECTIONS_COLLECTION).find(query);
  const docs = typeof cursor.sort === 'function'
    ? await cursor.sort({ provider: 1, isDefault: -1, updatedAt: -1 }).toArray()
    : await cursor.toArray();
  return docs.map(toSafe);
}

export async function listActiveUserConnections(
  db: Db, userId: string, provider?: IntegrationProvider
): Promise<IntegrationConnection[]> {
  const { userIds, emails } = await resolveLinkedUserIdentities(db, userId);

  const hasMultiple = userIds.length > 1 || emails.length > 0;
  const query: Record<string, any> = {
    ...(hasMultiple
      ? {
          $or: [
            { userId: { $in: userIds } },
            { connectedBy: { $in: userIds } },
            ...(emails.length > 0 ? [{ userEmail: { $in: emails } }] : []),
          ],
        }
      : { userId }),
    status: 'active',
  };
  if (provider) query.provider = provider;
  const cursor = db.collection(INTEGRATION_CONNECTIONS_COLLECTION).find(query);
  const docs = typeof cursor.sort === 'function'
    ? await cursor.sort({ isDefault: -1, updatedAt: -1 }).toArray()
    : await cursor.toArray();
  return docs as unknown as IntegrationConnection[];
}

export async function listAllActiveUserConnections(
  db: Db, provider?: IntegrationProvider
): Promise<IntegrationConnection[]> {
  const query: Record<string, any> = {
    status: 'active',
    userId: { $exists: true, $ne: null },
  };
  if (provider) query.provider = provider;
  const docs = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).find(query).toArray();
  return docs as unknown as IntegrationConnection[];
}

export async function listAllActiveGmailConnections(db: Db): Promise<IntegrationConnection[]> {
  const docs = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).find({
    provider: 'gmail',
    status: 'active',
  }).toArray();
  return docs as unknown as IntegrationConnection[];
}

export async function disconnectUserConnection(
  db: Db, userId: string, provider: IntegrationProvider, connectionId?: string
): Promise<boolean> {
  const connection = connectionId
    ? await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).findOne({ id: connectionId, userId, provider, status: { $ne: 'revoked' } })
    : await getUserConnection(db, userId, provider);
  if (!connection) return false;
  await disconnectConnection(db, connection as unknown as IntegrationConnection);

  // If the disconnected connection was default, promote another active connection to default
  if ((connection as any).isDefault) {
    const nextActive = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION)
      .find({ userId, provider, status: 'active', id: { $ne: connection.id } })
      .sort({ updatedAt: -1 })
      .limit(1)
      .next();
    if (nextActive) {
      await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).updateOne(
        { id: nextActive.id },
        { $set: { isDefault: true, updatedAt: new Date().toISOString() } }
      );
    }
  }

  return true;
}

export async function setUserDefaultConnection(
  db: Db, userId: string, provider: IntegrationProvider, connectionId: string
): Promise<boolean> {
  const target = await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).findOne({
    id: connectionId, userId, provider, status: 'active',
  });
  if (!target) return false;

  const now = new Date().toISOString();
  await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).updateMany(
    { userId, provider },
    { $set: { isDefault: false, updatedAt: now } }
  );
  await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).updateOne(
    { id: connectionId },
    { $set: { isDefault: true, updatedAt: now } }
  );
  return true;
}

export async function upsertApiKeyConnection(
  db: Db,
  params: { brand: string; tenantId: string; provider: IntegrationProvider; apiKey: string; providerAccountLabel?: string; connectedBy: string }
): Promise<void> {
  await ensureIntegrationConnectionIndexes(db);
  const now = new Date().toISOString();
  const blob = encryptCredentials({ apiKey: params.apiKey });
  await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).updateOne(
    { brand: params.brand, tenantId: params.tenantId, provider: params.provider },
    {
      $set: {
        authMethod: 'api_key', encryptedCredentials: blob,
        ...(params.providerAccountLabel ? { providerAccountLabel: params.providerAccountLabel } : {}),
        connectedBy: params.connectedBy, status: 'active' as IntegrationStatus,
        connectedAt: now, updatedAt: now, revokedAt: null, lastVerifiedAt: now,
      },
      $setOnInsert: { id: makeId(), brand: params.brand, tenantId: params.tenantId, provider: params.provider },
      $unset: { lastSyncError: '' },
    },
    { upsert: true }
  );
}

// Best-effort remote revoke, then an unconditional local status flip —
// mirrors issue #210's identical "always locally revocable even if the
// remote call fails" precedent for its own scoped-key revocation. Calendly
// personal access tokens have no revoke-by-API endpoint (verified against
// Calendly's own docs) — the admin revokes at calendly.com directly, and
// this app's own status flips to 'revoked' regardless.
export async function disconnectConnection(db: Db, connection: IntegrationConnection): Promise<void> {
  if (connection.authMethod === 'oauth2') {
    try {
      const cfg = oauthConfigFor(connection.provider);
      if (cfg) {
        const creds = decryptCredentials<{ accessToken: string; refreshToken?: string }>(connection.encryptedCredentials);
        const tokenToRevoke = creds.refreshToken || creds.accessToken;
        await fetchWithRetry(cfg.revokeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokenToRevoke }),
        });
      }
    } catch (error) {
      console.error(`[integration-store] remote revoke failed for ${connection.provider}:`, error);
    }
  }

  const now = new Date().toISOString();
  await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).updateOne(
    { id: connection.id },
    { $set: { status: 'revoked' as IntegrationStatus, revokedAt: now, updatedAt: now } }
  );
}

export class ConnectionRevokedError extends Error {}

async function markConnectionError(db: Db, id: string, reason: string): Promise<void> {
  await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).updateOne(
    { id },
    { $set: { status: 'error' as IntegrationStatus, lastSyncError: reason, updatedAt: new Date().toISOString() } }
  );
}

const REFRESH_SAFETY_MARGIN_MS = 60_000;

// Token-refresh-on-demand (oauth2 only) — generalizes issue #207's
// identical pattern. Returns a currently-valid bearer credential (the raw
// access token for oauth2, the raw API key for api_key — the caller
// doesn't need to know which). Throws ConnectionRevokedError (never a raw
// fetch/HTTP error) when the provider itself rejects the refresh
// (`invalid_grant`) — the caller must show a graceful "reconnect needed"
// state, never a 500.
export async function getValidCredential(db: Db, connection: IntegrationConnection): Promise<string> {
  if (connection.authMethod === 'api_key') {
    const { apiKey } = decryptCredentials<{ apiKey: string }>(connection.encryptedCredentials);
    return apiKey;
  }

  const creds = decryptCredentials<{ accessToken: string; refreshToken?: string }>(connection.encryptedCredentials);
  const expiresAtMs = connection.accessTokenExpiresAt ? new Date(connection.accessTokenExpiresAt).getTime() : 0;
  if (Date.now() < expiresAtMs - REFRESH_SAFETY_MARGIN_MS) {
    return creds.accessToken;
  }

  if (!creds.refreshToken) {
    await markConnectionError(db, connection.id, 'no_refresh_token');
    throw new ConnectionRevokedError('No refresh token stored for this connection');
  }

  const cfg = oauthConfigFor(connection.provider);
  if (!cfg || !isGoogleOAuthConfigured()) {
    await markConnectionError(db, connection.id, 'oauth_not_configured');
    throw new ConnectionRevokedError('OAuth client is not configured');
  }

  const res = await fetchWithRetry(cfg.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: creds.refreshToken,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID || GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET || GOOGLE_OAUTH_CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    await markConnectionError(db, connection.id, body.error || `refresh_failed_${res.status}`);
    throw new ConnectionRevokedError(body.error_description || body.error || `Token refresh failed: ${res.status}`);
  }

  const tokens = await res.json();
  const newBlob = encryptCredentials({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token || creds.refreshToken });
  const newExpiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
  await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).updateOne(
    { id: connection.id },
    { $set: { encryptedCredentials: newBlob, accessTokenExpiresAt: newExpiresAt, status: 'active' as IntegrationStatus, updatedAt: new Date().toISOString() }, $unset: { lastSyncError: '' } }
  );
  return tokens.access_token;
}

// Re-runs the same cheap, read-only verification call used at connect time
// (§8/§18 of issue #217) and records the outcome — never a silent pass.
export async function testConnection(db: Db, connection: IntegrationConnection): Promise<{ status: IntegrationStatus; lastSyncError?: string }> {
  try {
    const credential = await getValidCredential(db, connection);
    const oauthCfg = oauthConfigFor(connection.provider);
    const apiKeyCfg = apiKeyConfigFor(connection.provider);

    let ok = false;
    if (oauthCfg) {
      const url = new URL(oauthCfg.tokenInfoUrl);
      url.searchParams.set('access_token', credential);
      const res = await fetchWithRetry(url.toString());
      ok = res.ok;
    } else if (apiKeyCfg) {
      const res = await fetchWithRetry(apiKeyCfg.verifyUrl, { headers: { Authorization: `Bearer ${credential}` } });
      ok = res.ok;
    }

    const now = new Date().toISOString();
    if (ok) {
      await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).updateOne(
        { id: connection.id },
        { $set: { status: 'active' as IntegrationStatus, lastVerifiedAt: now, updatedAt: now }, $unset: { lastSyncError: '' } }
      );
      return { status: 'active' };
    }

    await markConnectionError(db, connection.id, 'provider_rejected_credential');
    return { status: 'error', lastSyncError: 'provider_rejected_credential' };
  } catch (error) {
    const reason = error instanceof ConnectionRevokedError ? error.message : 'verification_failed';
    if (!(error instanceof ConnectionRevokedError)) {
      await markConnectionError(db, connection.id, reason);
    }
    return { status: 'error', lastSyncError: reason };
  }
}
