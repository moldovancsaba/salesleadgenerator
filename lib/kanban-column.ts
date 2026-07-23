// Auto-managed columns: leads are placed here by ICE score alone, and
// re-placed automatically whenever their score changes. Every other column
// (ENGAGED, PROPOSAL, WON, LOST) is exclusively user-managed — a lead only
// gets there via an explicit action (drag-and-drop, PIN, ACCEPT, DECLINE),
// and once there it's never auto-moved again regardless of score changes.
export const AUTO_MANAGED_COLUMNS = ['DISCOVERED', 'QUALIFIED'] as const;
export type AutoManagedColumn = (typeof AUTO_MANAGED_COLUMNS)[number];

export const QUALIFIED_ICE_THRESHOLD = 500;

export function deriveKanbanColumn(iceScore: number): AutoManagedColumn {
  return iceScore >= QUALIFIED_ICE_THRESHOLD ? 'QUALIFIED' : 'DISCOVERED';
}

export function isAutoManagedColumn(column: string): column is AutoManagedColumn {
  return (AUTO_MANAGED_COLUMNS as readonly string[]).includes(column);
}

// Mongo aggregation expression computing the same ICE score as
// app/constants.ts's getIceScore(): direct impact*confidence*ease when all
// three are truthy, else scoreProfile.finalBlended.ice, else 0. Used to sort
// DISCOVERED/QUALIFIED columns by score without a stored, denormalized field.
//
// $convert (not a bare $gt/$multiply on the raw fields) is deliberate: a
// stored ice.impact/confidence/ease can be a numeric-looking string instead
// of a real number (a write path that skips normalizeLead()'s coercion would
// persist one) — $multiply throws on a string operand, which would fail the
// whole aggregation for every document in the column, not just the bad one.
// $convert with onError/onNull:0 recovers the real numeric value from a
// numeric string, and falls back to 0 (routing to the scoreProfile fallback
// below) for anything genuinely non-numeric or missing — self-healing
// against already-corrupted historical data with no migration required.
export const ICE_SCORE_AGGREGATION_EXPR = {
  $let: {
    vars: {
      impact: { $convert: { input: '$ice.impact', to: 'double', onError: 0, onNull: 0 } },
      confidence: { $convert: { input: '$ice.confidence', to: 'double', onError: 0, onNull: 0 } },
      ease: { $convert: { input: '$ice.ease', to: 'double', onError: 0, onNull: 0 } },
    },
    in: {
      $cond: [
        {
          $and: [
            { $gt: ['$$impact', 0] },
            { $gt: ['$$confidence', 0] },
            { $gt: ['$$ease', 0] },
          ],
        },
        { $multiply: ['$$impact', '$$confidence', '$$ease'] },
        { $ifNull: ['$scoreProfile.finalBlended.ice', 0] },
      ],
    },
  },
};
