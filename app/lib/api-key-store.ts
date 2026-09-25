// Scoped API keys (issue #210) — Mongo-aware layer. Pure decision logic
// lives in lib/scoped-api-keys.ts; this module only does I/O.

import type { Db } from 'mongodb';
import {
  generateRawApiKey, hashApiKey, keyPrefixOf, evaluateScopedKeyAuth, requiredScopeForMethod,
  type ApiKeyRecord, type ApiKeyScope, type ScopedKeyAuthResult,
} from '../../lib/scoped-api-keys';

export const API_KEYS_COLLECTION = 'api_keys';

const indexesEnsured = new Set<string>();
export async function ensureApiKeyIndexes(db: Db): Promise<void> {
  if (indexesEnsured.has('done')) return;
  try {
    await db.collection(API_KEYS_COLLECTION).createIndex({ hashedKey: 1 }, { unique: true });
    await db.collection(API_KEYS_COLLECTION).createIndex({ brand: 1 });
    indexesEnsured.add('done');
  } catch (error) {
    console.error('[api-key-store] index creation failed', error);
  }
}

function makeId(): string {
  return `apikey_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function createApiKey(
  db: Db,
  input: { name: string; brand: string; scopes: ApiKeyScope[] },
  createdBy: string
): Promise<{ record: ApiKeyRecord; rawKey: string }> {
  await ensureApiKeyIndexes(db);
  const rawKey = generateRawApiKey();
  const record: ApiKeyRecord = {
    id: makeId(),
    name: input.name,
    brand: input.brand,
    scopes: input.scopes,
    hashedKey: hashApiKey(rawKey),
    keyPrefix: keyPrefixOf(rawKey),
    createdBy,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null,
  };
  await db.collection(API_KEYS_COLLECTION).insertOne(record);
  return { record, rawKey };
}

// Never returns hashedKey — a stored hash has zero legitimate UI use and
// exposing it is needless surface (a deliberate, disclosed divergence from
// this issue's own §10 literal text, which listed hashedKey as part of the
// GET response; see docs/ARCHITECTURE.md).
export async function listApiKeys(db: Db, brand: string): Promise<Omit<ApiKeyRecord, 'hashedKey'>[]> {
  const docs = await db.collection(API_KEYS_COLLECTION).find({ brand }).sort({ createdAt: -1 }).toArray();
  return docs.map((d: any) => ({
    id: d.id, name: d.name, brand: d.brand, scopes: d.scopes, keyPrefix: d.keyPrefix,
    createdBy: d.createdBy, createdAt: d.createdAt, lastUsedAt: d.lastUsedAt, revokedAt: d.revokedAt,
  }));
}

export async function revokeApiKey(db: Db, id: string, brand: string): Promise<boolean> {
  const result = await db.collection(API_KEYS_COLLECTION).updateOne(
    { id, brand, revokedAt: null },
    { $set: { revokedAt: new Date().toISOString() } }
  );
  return result.modifiedCount > 0;
}

// The actual auth check a request-serving route calls. `lastUsedAt` is
// updated fire-and-forget (never awaited on the caller's critical path,
// issue #210 §16).
export async function verifyScopedApiKey(db: Db, rawKey: string, brand: string, method: string): Promise<ScopedKeyAuthResult> {
  const hashed = hashApiKey(rawKey);
  const keyDoc = await db.collection(API_KEYS_COLLECTION).findOne({ hashedKey: hashed });
  const result = evaluateScopedKeyAuth(keyDoc as ApiKeyRecord | null, brand, requiredScopeForMethod(method));
  if (result.authorized && keyDoc) {
    db.collection(API_KEYS_COLLECTION).updateOne({ id: (keyDoc as any).id }, { $set: { lastUsedAt: new Date().toISOString() } }).catch(() => {});
  }
  return result;
}
