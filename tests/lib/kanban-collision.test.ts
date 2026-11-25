import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClientRect, DroppableContainer } from '@dnd-kit/core';
import {
  fromColumnShellId,
  kanbanCollisionDetection,
  resolveColumnForDroppableId,
  resolveDropDestination,
  toColumnShellId,
} from '@/lib/kanban-collision';

function makeRect(left: number, top: number, width: number, height: number): ClientRect {
  return { left, top, width, height, right: left + width, bottom: top + height };
}

function makeContainer(id: string): DroppableContainer {
  return {
    id,
    key: id,
    disabled: false,
    node: { current: null },
    rect: { current: null },
    data: { current: undefined },
  } as DroppableContainer;
}

describe('kanban-collision (cross-column reliability)', () => {
  const columnIds = new Set(['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST']);

  it('round-trips column shell IDs cleanly', () => {
    expect(toColumnShellId('PROPOSAL')).toBe('col-shell:PROPOSAL');
    expect(fromColumnShellId('col-shell:PROPOSAL')).toBe('PROPOSAL');
    expect(fromColumnShellId('PROPOSAL')).toBeNull();
  });

  it('resolves card, drop-zone, and shell IDs to their owning column', () => {
    const itemToColumn = new Map([['lead-1', 'DISCOVERED']]);
    const context = { columnIds, itemToColumn };

    expect(resolveColumnForDroppableId('lead-1', context)).toBe('DISCOVERED');
    expect(resolveColumnForDroppableId('PROPOSAL', context)).toBe('PROPOSAL');
    expect(resolveColumnForDroppableId('col-shell:WON', context)).toBe('WON');
    expect(resolveColumnForDroppableId('unknown-id', context)).toBeNull();
  });

  it('resolves drop destinations for cards, column drop zones, and shell wrappers', () => {
    const cols = [
      { id: 'DISCOVERED', items: [{ id: 'd1' }, { id: 'd2' }] },
      { id: 'PROPOSAL', items: [] },
      { id: 'WON', items: [{ id: 'w1' }] },
    ];

    expect(resolveDropDestination('d2', cols)).toEqual({ columnId: 'DISCOVERED', toIndex: 1 });
    expect(resolveDropDestination('PROPOSAL', cols)).toEqual({ columnId: 'PROPOSAL', toIndex: 0 });
    expect(resolveDropDestination('col-shell:WON', cols)).toEqual({ columnId: 'WON', toIndex: 1 });
    expect(resolveDropDestination('missing', cols)).toBeNull();
  });

  it('targets empty or short neighbor column even when tall adjacent cards are horizontally closer than its vertical midpoint', () => {
    // DISCOVERED (x=0..320) is 3000px tall with cards at y=300..3000.
    // PROPOSAL (x=336..656) is empty and stretches full height 200..3200 (center y=1700).
    // Dragging a card from DISCOVERED to top-of-PROPOSAL (pointer at x=496, y=310):
    // Under bare closestCenter, d2 at (160, 310) is 336px away while PROPOSAL center (496, 1700) is 1390px away!
    // Container-first collision detection must pick PROPOSAL both near the top and near the bottom.
    const itemToColumn = new Map([
      ['d1', 'DISCOVERED'],
      ['d2', 'DISCOVERED'],
      ['d3', 'DISCOVERED'],
    ]);

    const droppableRects = new Map<string | number, ClientRect>([
      ['col-shell:DISCOVERED', makeRect(0, 200, 320, 3000)],
      ['DISCOVERED', makeRect(16, 260, 288, 2920)],
      ['d1', makeRect(16, 260, 288, 220)],
      ['d2', makeRect(16, 490, 288, 220)],
      ['d3', makeRect(16, 2600, 288, 220)],
      ['col-shell:PROPOSAL', makeRect(336, 200, 320, 3000)],
      ['PROPOSAL', makeRect(352, 260, 288, 2920)],
    ]);

    const droppableContainers = Array.from(droppableRects.keys()).map((id) => makeContainer(String(id)));
    const active = { id: 'd1', data: { current: undefined }, rect: { current: { initial: null, translated: null } } } as any;

    // Drop near top of empty PROPOSAL column
    const topHits = kanbanCollisionDetection(
      {
        active,
        collisionRect: makeRect(350, 260, 300, 120),
        droppableRects,
        droppableContainers,
        pointerCoordinates: { x: 496, y: 310 },
      },
      { columnIds, itemToColumn },
    );
    expect(topHits[0]?.id).toBe('PROPOSAL');

    // Drop near bottom of empty PROPOSAL column
    const bottomHits = kanbanCollisionDetection(
      {
        active,
        collisionRect: makeRect(350, 2600, 300, 120),
        droppableRects,
        droppableContainers,
        pointerCoordinates: { x: 496, y: 2660 },
      },
      { columnIds, itemToColumn },
    );
    expect(bottomHits[0]?.id).toBe('PROPOSAL');

    // Drop on column header of PROPOSAL (inside shell, above [data-gds-kanban-drop-zone])
    const headerHits = kanbanCollisionDetection(
      {
        active,
        collisionRect: makeRect(350, 205, 300, 80),
        droppableRects,
        droppableContainers,
        pointerCoordinates: { x: 496, y: 225 },
      },
      { columnIds, itemToColumn },
    );
    expect(headerHits[0]?.id).toBe('PROPOSAL');
  });

  it('targets a card inside the hovered column when dragging across columns onto an existing card', () => {
    const itemToColumn = new Map([
      ['d1', 'DISCOVERED'],
      ['e1', 'ENGAGED'],
      ['e2', 'ENGAGED'],
    ]);

    const droppableRects = new Map<string | number, ClientRect>([
      ['col-shell:DISCOVERED', makeRect(0, 200, 320, 800)],
      ['DISCOVERED', makeRect(16, 260, 288, 720)],
      ['d1', makeRect(16, 260, 288, 220)],
      ['col-shell:ENGAGED', makeRect(336, 200, 320, 800)],
      ['ENGAGED', makeRect(352, 260, 288, 720)],
      ['e1', makeRect(352, 260, 288, 220)],
      ['e2', makeRect(352, 490, 288, 220)],
    ]);

    const droppableContainers = Array.from(droppableRects.keys()).map((id) => makeContainer(String(id)));
    const active = { id: 'd1', data: { current: undefined }, rect: { current: { initial: null, translated: null } } } as any;

    const hits = kanbanCollisionDetection(
      {
        active,
        collisionRect: makeRect(350, 500, 300, 120),
        droppableRects,
        droppableContainers,
        pointerCoordinates: { x: 496, y: 550 },
      },
      { columnIds, itemToColumn },
    );

    expect(hits[0]?.id).toBe('e2');
  });

  it('supports same-column reorder on cards and below the last card', () => {
    const itemToColumn = new Map([
      ['e1', 'ENGAGED'],
      ['e2', 'ENGAGED'],
      ['e3', 'ENGAGED'],
    ]);

    const droppableRects = new Map<string | number, ClientRect>([
      ['col-shell:ENGAGED', makeRect(0, 200, 320, 1200)],
      ['ENGAGED', makeRect(16, 260, 288, 1120)],
      ['e1', makeRect(16, 260, 288, 200)],
      ['e2', makeRect(16, 470, 288, 200)],
      ['e3', makeRect(16, 680, 288, 200)],
    ]);

    const droppableContainers = Array.from(droppableRects.keys()).map((id) => makeContainer(String(id)));
    const active = { id: 'e1', data: { current: undefined }, rect: { current: { initial: null, translated: null } } } as any;

    // Hover in gap between e2 and e3 -> snaps strictly within ENGAGED
    const gapHits = kanbanCollisionDetection(
      {
        active,
        collisionRect: makeRect(16, 610, 288, 100),
        droppableRects,
        droppableContainers,
        pointerCoordinates: { x: 160, y: 675 },
      },
      { columnIds, itemToColumn },
    );
    expect(['e2', 'e3']).toContain(String(gapHits[0]?.id));

    // Drop below last card e3 (pointer y=1000 > e3.bottom=880) -> targets column end
    const endHits = kanbanCollisionDetection(
      {
        active,
        collisionRect: makeRect(16, 950, 288, 100),
        droppableRects,
        droppableContainers,
        pointerCoordinates: { x: 160, y: 1000 },
      },
      { columnIds, itemToColumn },
    );
    expect(endHits[0]?.id).toBe('ENGAGED');
  });

  it('falls back cleanly for keyboard dragging when pointerCoordinates is null', () => {
    const itemToColumn = new Map([['d1', 'DISCOVERED']]);
    const droppableRects = new Map<string | number, ClientRect>([
      ['col-shell:DISCOVERED', makeRect(0, 200, 320, 800)],
      ['DISCOVERED', makeRect(16, 260, 288, 720)],
      ['d1', makeRect(16, 260, 288, 220)],
      ['col-shell:QUALIFIED', makeRect(336, 200, 320, 800)],
      ['QUALIFIED', makeRect(352, 260, 288, 720)],
    ]);
    const droppableContainers = Array.from(droppableRects.keys()).map((id) => makeContainer(String(id)));
    const active = { id: 'd1', data: { current: undefined }, rect: { current: { initial: null, translated: null } } } as any;

    const hits = kanbanCollisionDetection(
      {
        active,
        collisionRect: makeRect(352, 260, 288, 220),
        droppableRects,
        droppableContainers,
        pointerCoordinates: null,
      },
      { columnIds, itemToColumn },
    );
    expect(hits[0]?.id).toBe('QUALIFIED');
  });

  it('stretches [data-gds-kanban-drop-zone] vertically in globals.css so empty and short columns remain droppable full-height', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
    expect(css).toContain('[data-gds-kanban-column] [data-gds-kanban-drop-zone]');
    expect(css).toContain('flex: 1 1 auto !important;');
    expect(css).toContain('[data-gds-kanban-drop-target="true"] > [data-gds-kanban-column]');
  });
});
