import {
  closestCenter,
  pointerWithin,
  rectIntersection,
  type ClientRect,
  type Collision,
  type CollisionDetection,
  type DroppableContainer,
} from '@dnd-kit/core';

export const COLUMN_SHELL_PREFIX = 'col-shell:';

export function toColumnShellId(columnId: string): string {
  return `${COLUMN_SHELL_PREFIX}${columnId}`;
}

export function fromColumnShellId(id: string): string | null {
  return id.startsWith(COLUMN_SHELL_PREFIX) ? id.slice(COLUMN_SHELL_PREFIX.length) : null;
}

export type KanbanCollisionContext = {
  columnIds: ReadonlySet<string>;
  itemToColumn: ReadonlyMap<string, string>;
};

export type ColumnLike = {
  id: string;
  items: ReadonlyArray<{ id: string }>;
};

/**
 * Resolves which column ID a droppable (card item, column drop zone, or
 * outer column shell) belongs to.
 */
export function resolveColumnForDroppableId(
  id: string,
  context: KanbanCollisionContext,
): string | null {
  const shellColumnId = fromColumnShellId(id);
  if (shellColumnId && context.columnIds.has(shellColumnId)) {
    return shellColumnId;
  }
  if (context.columnIds.has(id)) {
    return id;
  }
  return context.itemToColumn.get(id) ?? null;
}

/**
 * Translates any `@dnd-kit` drop target ID (card ID, column drop-zone ID,
 * or outer column-shell ID) into a concrete column ID and insertion index.
 */
export function resolveDropDestination(
  overId: string,
  columns: ReadonlyArray<ColumnLike>,
): { columnId: string; toIndex: number } | null {
  const unwrapped = fromColumnShellId(overId) ?? overId;
  const directColumn = columns.find((column) => column.id === unwrapped);
  if (directColumn) {
    return { columnId: directColumn.id, toIndex: directColumn.items.length };
  }

  for (const column of columns) {
    const idx = column.items.findIndex((item) => item.id === overId);
    if (idx !== -1) {
      return { columnId: column.id, toIndex: idx };
    }
  }
  return null;
}

function getColumnContainerRect(
  columnId: string,
  droppableRects: Map<string | number, ClientRect>,
): ClientRect | undefined {
  return droppableRects.get(toColumnShellId(columnId)) ?? droppableRects.get(columnId);
}

function distanceToRect(rect: ClientRect, x: number, y: number): number {
  const dx = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
  const dy = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
  return dx * dx + dy * dy;
}

function resolveHoveredColumnId(
  hits: Collision[],
  context: KanbanCollisionContext,
  args: Parameters<CollisionDetection>[0],
): string | null {
  const candidateColumns: string[] = [];
  const seen = new Set<string>();

  // Prefer direct card / drop-zone hits first before shell hits when ordering ties.
  const orderedHits = [...hits].sort((a, b) => {
    const aShell = fromColumnShellId(String(a.id)) !== null ? 1 : 0;
    const bShell = fromColumnShellId(String(b.id)) !== null ? 1 : 0;
    return aShell - bShell;
  });

  for (const hit of orderedHits) {
    const colId = resolveColumnForDroppableId(String(hit.id), context);
    if (colId && !seen.has(colId)) {
      seen.add(colId);
      candidateColumns.push(colId);
    }
  }

  if (candidateColumns.length === 0) return null;
  if (candidateColumns.length === 1) return candidateColumns[0];

  const refX = args.pointerCoordinates?.x ?? (args.collisionRect.left + args.collisionRect.width / 2);
  const refY = args.pointerCoordinates?.y ?? (args.collisionRect.top + args.collisionRect.height / 2);
  let bestCol = candidateColumns[0];
  let bestDist = Infinity;

  for (const colId of candidateColumns) {
    const rect = getColumnContainerRect(colId, args.droppableRects);
    if (!rect) continue;
    const dist = distanceToRect(rect, refX, refY);
    if (dist < bestDist) {
      bestDist = dist;
      bestCol = colId;
    }
  }

  return bestCol;
}

function findColumnFallbackCollision(
  columnId: string,
  droppableContainers: DroppableContainer[],
): Collision[] {
  const zone = droppableContainers.find((c) => String(c.id) === columnId);
  if (zone) {
    return [{ id: zone.id, data: { droppableContainer: zone, value: 0 } }];
  }
  const shellId = toColumnShellId(columnId);
  const shell = droppableContainers.find((c) => String(c.id) === shellId);
  if (shell) {
    return [{ id: shell.id, data: { droppableContainer: shell, value: 0 } }];
  }
  return [];
}

/**
 * Container-first multi-column collision detection for Kanban boards.
 *
 * Unlike bare `closestCenter` (which lets neighbor columns' cards steal drops
 * whenever an empty or shorter column's vertical center is >336px away from the
 * pointer), this locks onto the hovered column first using `pointerWithin` (with
 * `rectIntersection` and `closestCenter` fallbacks for gutter/keyboard drags),
 * then resolves item ordering strictly inside that hovered column.
 */
export function kanbanCollisionDetection(
  args: Parameters<CollisionDetection>[0],
  context: KanbanCollisionContext,
): Collision[] {
  const activeId = String(args.active.id);
  const activeColumnId = context.itemToColumn.get(activeId) ?? null;

  const pointerHits = args.pointerCoordinates ? pointerWithin(args) : [];
  const intersecting = pointerHits.length > 0 ? pointerHits : rectIntersection(args);

  if (intersecting.length === 0) {
    // Only fall back to closestCenter when there is no pointer (keyboard drag)
    // so keyboard navigation across empty/unequal columns still works cleanly.
    return args.pointerCoordinates === null ? closestCenter(args) : [];
  }

  const targetColumnId = resolveHoveredColumnId(intersecting, context, args);
  if (!targetColumnId) {
    return args.pointerCoordinates === null ? closestCenter(args) : [];
  }

  const isSameColumn = targetColumnId === activeColumnId;

  // Item droppables inside the hovered column only (never cross-bleed into neighbors).
  const itemHitsInTarget = intersecting.filter((hit) => {
    const id = String(hit.id);
    if (id === activeId) return false;
    return context.itemToColumn.get(id) === targetColumnId;
  });

  if (itemHitsInTarget.length > 0) {
    return itemHitsInTarget;
  }

  // For same-column drags hovering in the gap between cards, find the closest
  // item inside this column unless the pointer sits below the bottom item.
  const targetItemContainers = args.droppableContainers.filter((container) => {
    const id = String(container.id);
    return id !== activeId && context.itemToColumn.get(id) === targetColumnId;
  });

  if (isSameColumn && targetItemContainers.length > 0) {
    const pointerY = args.pointerCoordinates?.y;
    let maxBottom = -Infinity;
    for (const container of targetItemContainers) {
      const rect = args.droppableRects.get(container.id);
      if (rect && rect.bottom > maxBottom) {
        maxBottom = rect.bottom;
      }
    }

    if (pointerY == null || pointerY <= maxBottom) {
      const nearestInColumn = closestCenter({
        ...args,
        droppableContainers: targetItemContainers,
      });
      if (nearestInColumn.length > 0) {
        return nearestInColumn;
      }
    }
  }

  // Cross-column drop onto empty column / header / below cards / gap, or
  // same-column drop below the last item: target the column container itself.
  return findColumnFallbackCollision(targetColumnId, args.droppableContainers);
}
