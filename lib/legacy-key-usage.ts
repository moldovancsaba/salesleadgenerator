import type { Db } from 'mongodb';
import { isMongoConfigured, getClientPromise } from './mongodb';

// Issue #220: before SLG_API_KEY can be deleted, the owner needs proof that
// nothing still sends it. Runtime logs keep about a day, so every accepted
// legacy-key request is counted here in daily buckets per {method, route},
// kept for 120 days, and shown on /admin/api-keys.
export const LEGACY_KEY_USAGE_COLLECTION = 'legacy_api_key_usage';
const RETENTION_SECONDS = 120 * 24 * 60 * 60;

// Ids in a path would make every lead its own bucket; they're collapsed so a
// bucket names a route, not a record.
export function normalizeUsagePath(pathname: string): string {
  return pathname
    .replace(/\/[0-9a-f]{24}(?=\/|$)/gi, '/:id')
    .replace(/\/\d+(?=\/|$)/g, '/:id');
}

let indexEnsured = false;
async function ensureIndexes(db: Db): Promise<void> {
  if (indexEnsured) return;
  await db.collection(LEGACY_KEY_USAGE_COLLECTION).createIndex({ day: 1, method: 1, path: 1 }, { unique: true });
  await db.collection(LEGACY_KEY_USAGE_COLLECTION).createIndex({ firstSeenAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });
  indexEnsured = true;
}

export async function recordLegacyKeyUseNow(db: Db, method: string, url: string, userAgent: string | null, now = new Date()): Promise<void> {
  await ensureIndexes(db);
  const path = normalizeUsagePath(new URL(url).pathname);
  await db.collection(LEGACY_KEY_USAGE_COLLECTION).updateOne(
    { day: now.toISOString().slice(0, 10), method, path },
    {
      $inc: { count: 1 },
      $set: { lastSeenAt: now, lastUserAgent: (userAgent || '').slice(0, 200) },
      $setOnInsert: { firstSeenAt: now },
    },
    { upsert: true }
  );
}

// Fire-and-forget from the auth helpers: recording must never slow down or
// fail the request it describes.
export function recordLegacyKeyUse(request: Request): void {
  if (!isMongoConfigured()) return;
  getClientPromise()
    .then((client) => recordLegacyKeyUseNow(client.db(), request.method, request.url, request.headers.get('user-agent')))
    .catch((error) => console.error('[legacy-key-usage] record failed', error));
}

export type LegacyKeyUsageSummary = { method: string; path: string; count: number; days: number; lastSeenAt: string };

export async function summarizeLegacyKeyUsage(db: Db, sinceDays: number): Promise<LegacyKeyUsageSummary[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const rows = await db.collection(LEGACY_KEY_USAGE_COLLECTION).aggregate([
    { $match: { day: { $gte: since } } },
    { $group: { _id: { method: '$method', path: '$path' }, count: { $sum: '$count' }, days: { $sum: 1 }, lastSeenAt: { $max: '$lastSeenAt' } } },
    { $sort: { lastSeenAt: -1 } },
  ]).toArray();
  return rows.map((r: any) => ({
    method: r._id.method, path: r._id.path, count: r.count, days: r.days,
    lastSeenAt: new Date(r.lastSeenAt).toISOString(),
  }));
}
