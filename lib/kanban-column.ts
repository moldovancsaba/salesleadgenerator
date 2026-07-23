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
export const ICE_SCORE_AGGREGATION_EXPR = {
  $let: {
    vars: {
      hasDirect: {
        $and: [
          { $gt: [{ $ifNull: ['$ice.impact', 0] }, 0] },
          { $gt: [{ $ifNull: ['$ice.confidence', 0] }, 0] },
          { $gt: [{ $ifNull: ['$ice.ease', 0] }, 0] },
        ],
      },
    },
    in: {
      $cond: [
        '$$hasDirect',
        { $multiply: ['$ice.impact', '$ice.confidence', '$ice.ease'] },
        { $ifNull: ['$scoreProfile.finalBlended.ice', 0] },
      ],
    },
  },
};
