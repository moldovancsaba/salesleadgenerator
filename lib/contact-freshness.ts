// Pure per-contact staleness calculation. No React, no Mongo, no internal
// Date.now() — the caller passes `now` explicitly (mirrors lib/stale-deal.ts
// and lib/kanban-column-visibility.ts's shape). Consumed by the "Next-step
// nudges" roadmap issue — keep this signature stable.

export type StalenessCheckableContact = {
  lastVerifiedAt?: string | null;
};

function readThresholdFromEnv(): number {
  const raw = process.env.CONTACT_STALENESS_THRESHOLD_DAYS;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 180;
}

// Read once at module load — changing the env var takes effect on next
// deploy/restart, not live, matching how other module-scoped config in this
// repo (e.g. lib/api-auth.ts's SLG_API_KEY) is read.
export const DEFAULT_STALENESS_THRESHOLD_DAYS = readThresholdFromEnv();

// Missing lastVerifiedAt is treated as stale (unknown, not "fresh at
// creation") — see issue #66's Rollback/Recovery section. A future
// timestamp (clock skew) is treated as not-stale rather than throwing.
export function isContactStale(
  contact: StalenessCheckableContact,
  thresholdDays: number,
  now: Date = new Date()
): boolean {
  if (!contact.lastVerifiedAt) return true;
  const verified = new Date(contact.lastVerifiedAt);
  if (Number.isNaN(verified.getTime())) return true;
  const ageMs = now.getTime() - verified.getTime();
  if (ageMs < 0) return false;
  return ageMs >= thresholdDays * 86_400_000;
}

// Zero contacts returns 0, not 100% — the caller must treat a zero-contact
// lead as a separate "not applicable" bucket, not as fully stale.
export function staleContactRatio(
  contacts: StalenessCheckableContact[],
  thresholdDays: number,
  now: Date = new Date()
): number {
  if (!contacts || contacts.length === 0) return 0;
  const staleCount = contacts.filter((c) => isContactStale(c, thresholdDays, now)).length;
  return staleCount / contacts.length;
}
