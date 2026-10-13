// Suppression registry (issue #236 — Ingested from Vega CRM Invariant 1).
// Ensures no cadence, automated email, or rep send reaches an address or domain
// that has unsubscribed, bounced, complained, or been marked Do Not Contact.

import type { Db } from 'mongodb';

export type SuppressionKind = 'email' | 'domain';

export type SuppressionReason =
  | 'unsubscribed'
  | 'bounced'
  | 'complained'
  | 'manual'
  | 'do_not_contact';

export type SuppressedRecipient = {
  id?: string;
  brand: string;
  tenantId: string;
  kind: SuppressionKind;
  target: string; // normalized lowercase email or domain
  reason: SuppressionReason;
  createdAt: string;
  expiresAt?: string | null;
};

export const SUPPRESSION_COLLECTION = 'suppressed_recipients';

let suppressionIndexesEnsured = false;

export async function ensureSuppressionIndexes(db: Db): Promise<void> {
  if (suppressionIndexesEnsured) return;
  try {
    await db.collection(SUPPRESSION_COLLECTION).createIndex(
      { brand: 1, tenantId: 1, kind: 1, target: 1 },
      { unique: true }
    );
    await db.collection(SUPPRESSION_COLLECTION).createIndex({ expiresAt: 1 });
    suppressionIndexesEnsured = true;
  } catch (error) {
    console.error('[suppression] index creation failed:', error);
  }
}

export function normalizeSuppressionTarget(raw: string): { kind: SuppressionKind; target: string } | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;

  if (trimmed.includes('@')) {
    const parts = trimmed.split('@');
    if (parts.length === 2 && parts[0] && parts[1] && parts[1].includes('.')) {
      return { kind: 'email', target: trimmed };
    }
    return null;
  }

  // Domain format: e.g. "example.com"
  if (trimmed.includes('.') && !trimmed.includes('/') && !trimmed.includes(' ')) {
    return { kind: 'domain', target: trimmed };
  }

  return null;
}

/**
 * Checks whether an email address is currently suppressed by email or domain match.
 */
export async function isRecipientSuppressed(
  db: Db,
  brand: string,
  tenantId: string,
  email: string,
  now?: Date
): Promise<{ suppressed: boolean; reason?: SuppressionReason }> {
  if (!email || typeof email !== 'string') return { suppressed: false };
  const emailLower = email.trim().toLowerCase();
  if (!emailLower.includes('@')) return { suppressed: false };

  const domain = emailLower.split('@')[1];
  const nowIso = (now ?? new Date()).toISOString();

  await ensureSuppressionIndexes(db);

  const filter: Record<string, any> = {
    brand,
    tenantId,
    $or: [
      { kind: 'email', target: emailLower },
      { kind: 'domain', target: domain },
    ],
    $and: [
      {
        $or: [
          { expiresAt: null },
          { expiresAt: { $exists: false } },
          { expiresAt: { $gt: nowIso } },
        ],
      },
    ],
  };

  const doc = await db.collection(SUPPRESSION_COLLECTION).findOne(filter);
  if (doc) {
    return { suppressed: true, reason: doc.reason as SuppressionReason };
  }

  return { suppressed: false };
}

/**
 * Adds an email address or domain to the suppression registry.
 */
export async function suppressRecipient(
  db: Db,
  input: {
    brand: string;
    tenantId: string;
    target: string;
    reason: SuppressionReason;
    expiresAt?: string | null;
    now?: Date;
  }
): Promise<boolean> {
  const norm = normalizeSuppressionTarget(input.target);
  if (!norm) return false;

  await ensureSuppressionIndexes(db);

  const nowIso = (input.now ?? new Date()).toISOString();
  const record: SuppressedRecipient = {
    brand: input.brand,
    tenantId: input.tenantId,
    kind: norm.kind,
    target: norm.target,
    reason: input.reason,
    createdAt: nowIso,
    expiresAt: input.expiresAt ?? null,
  };

  await db.collection(SUPPRESSION_COLLECTION).updateOne(
    { brand: input.brand, tenantId: input.tenantId, kind: norm.kind, target: norm.target },
    { $set: record },
    { upsert: true }
  );

  return true;
}

/**
 * Removes an email address or domain from the suppression registry.
 */
export async function unsuppressRecipient(
  db: Db,
  brand: string,
  tenantId: string,
  target: string
): Promise<boolean> {
  const norm = normalizeSuppressionTarget(target);
  if (!norm) return false;

  await ensureSuppressionIndexes(db);

  const res = await db.collection(SUPPRESSION_COLLECTION).deleteOne({
    brand,
    tenantId,
    kind: norm.kind,
    target: norm.target,
  });

  return res.deletedCount > 0;
}
