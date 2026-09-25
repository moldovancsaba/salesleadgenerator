import type { Db } from 'mongodb';
import { encryptCredentials, decryptCredentials } from '../../lib/integration-crypto';
import {
  type IntegrationConnection, type IntegrationProvider, type IntegrationStatus,
  oauthConfigFor, apiKeyConfigFor,
} from '../../lib/integration-connections';
import { fetchWithRetry } from '../../lib/integration-http';

export const INTEGRATION_CONNECTIONS_COLLECTION = 'integration_connections';

const GOOGLE_OAUTH_CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID || '';
const GOOGLE_OAUTH_CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET || '';
const GOOGLE_OAUTH_REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI || '';

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(GOOGLE_OAUTH_CLIENT_ID && GOOGLE_OAUTH_CLIENT_SECRET && GOOGLE_OAUTH_REDIRECT_URI);
}

export { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI };

const indexesEnsured = new Set<string>();
export async function ensureIntegrationConnectionIndexes(db: Db): Promise<void> {
  if (indexesEnsured.has('done')) return;
  try {
    await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).createIndex(
      { brand: 1, tenantId: 1, provider: 1 },
      { unique: true }
    );
    indexesEnsured.add('done');
  } catch (error) {
    console.error('[integration-store] index creation failed', error);
  }
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
    accessToken: string; refreshToken?: string; expiresInSeconds: number;
    scopes: string[]; connectedBy: string;
  }
): Promise<void> {
  await ensureIntegrationConnectionIndexes(db);
  const now = new Date().toISOString();
  const blob = encryptCredentials({ accessToken: params.accessToken, refreshToken: params.refreshToken });
  const accessTokenExpiresAt = new Date(Date.now() + params.expiresInSeconds * 1000).toISOString();
  await db.collection(INTEGRATION_CONNECTIONS_COLLECTION).updateOne(
    { brand: params.brand, tenantId: params.tenantId, provider: params.provider },
    {
      $set: {
        authMethod: 'oauth2', encryptedCredentials: blob, accessTokenExpiresAt,
        scopes: params.scopes, connectedBy: params.connectedBy, status: 'active' as IntegrationStatus,
        connectedAt: now, updatedAt: now, revokedAt: null,
      },
      $setOnInsert: { id: makeId(), brand: params.brand, tenantId: params.tenantId, provider: params.provider },
      $unset: { lastSyncError: '' },
    },
    { upsert: true }
  );
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
      client_id: GOOGLE_OAUTH_CLIENT_ID,
      client_secret: GOOGLE_OAUTH_CLIENT_SECRET,
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
