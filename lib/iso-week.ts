// Pure ISO-8601 week-key calculation (e.g. "2026-W30"). UTC-anchored,
// independent of any tenant's local timezone — avoids DST-boundary
// ambiguity for a periodKey shared across tenants. No internal `Date.now()`
// — the caller passes `date` explicitly (mirrors lib/stale-deal.ts's shape).

export function isoWeekKey(date: Date): string {
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO weeks start on Monday; getUTCDay() is 0 (Sun) - 6 (Sat), so map
  // Sunday to 7 and shift to the Thursday of this week — the day that
  // determines which ISO year/week a given date belongs to.
  const dayNum = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
