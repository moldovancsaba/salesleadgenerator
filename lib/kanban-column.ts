export function deriveKanbanColumn(iceScore: number): string {
  if (iceScore >= 720) return 'ENGAGED'
  if (iceScore >= 480) return 'QUALIFIED'
  return 'DISCOVERED'
}
