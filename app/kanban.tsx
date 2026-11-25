'use client';

import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from 'react';
import { Box, Group, Loader, Button, Checkbox, Text, Select, TextInput, Stack, ScrollArea, Paper } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { KanbanColumn as GdsKanbanColumn, StatusBadge, useGdsKanbanOrientation } from '@sovereignsquad/gds-core/client';
import type { KanbanItem as GdsKanbanItem, KanbanColumnData as GdsKanbanColumnData } from '@sovereignsquad/gds-core/client';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import type { Lead, KanbanColumn } from './types';
import type { CurrencyCode } from './lib/brand';
import { LeadCard } from './card';
import { COLUMNS } from './constants';
import { computeStaleness, DEFAULT_STALE_THRESHOLDS, type KanbanColumn as StaleDealColumn, type StaleDealResult } from '../lib/stale-deal';
import { getNextStepNudge, type Nudge } from '../lib/next-step-nudge';
import { DEFAULT_WIP_LIMITS, resolveWipThreshold, isOverWipLimit } from '../lib/wip-limits';
import type { LeadFilter } from '../lib/saved-filters';
import { TOUR_SELECTOR } from './lib/tour/selectors';
import { isAutoManagedColumn } from '../lib/kanban-column';
import { decideMoveItemAction, resolveReorderNeighbors } from '../lib/kanban-reorder';
import {
  kanbanCollisionDetection,
  resolveColumnForDroppableId,
  resolveDropDestination,
  toColumnShellId,
} from '../lib/kanban-collision';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isVerticalScrollIntent } from '../lib/desktop-scroll-passthrough';
import { matchesQuickFilterPreset, type QuickFilterPreset } from '../lib/quick-filter-presets';

type ColumnState = {
  leads: Lead[];
  count: number;
  hasMore: boolean;
  cursor: string | null;
  loading: boolean;
};

type ColumnForecast = {
  leads: number;
  rawRevenue: number;
  probability: number;
  weightedRevenue: number;
};

type BoardProps = {
  brand: string;
  tenantId?: string;
  onOpenLead: (lead: Lead) => void;
  forecast?: Record<string, ColumnForecast> | null;
  forecastCurrency?: CurrencyCode;
  filter?: LeadFilter;
  // Owned by the parent (app/sales/[brand]/sales-page-client.tsx) so the
  // toggle button can live in the same slim toolbar row as the Filters
  // trigger, rather than each mounting its own separate row (issue #53
  // follow-up — the board's own internal selection state below still
  // resets whenever this flips off).
  selectMode?: boolean;
  // Issue #126 — defaults to the 6-column Pipeline set (app/constants.ts's
  // COLUMNS). The parent passes app/constants.ts's BACKLOG_COLUMN_DEF to
  // mount this exact same component as the one-column Backlog board
  // instead — same Select mode, same bulk actions, same filters, same
  // renderItem, nothing duplicated. Must be a referentially-stable array
  // (a module-level constant, not an inline literal) since the bootstrap
  // effect below depends on it by reference.
  columnDefs?: typeof COLUMNS;
  // Reuses the exact same handler app/detail.tsx's Accept/Decline buttons call
  // (app/sales/[brand]/sales-page-client.tsx's handleAction) so an inline
  // per-card Accept/Decline is never a second, drifting implementation of the
  // same action — added 2026-09-02 alongside bulk Accept: reviewing at scale
  // previously required opening every lead's own modal one at a time.
  onAction?: (leadId: string, action: string, payload?: Record<string, unknown>) => Promise<void>;
  onVisibleLeadsChange?: (leads: Lead[]) => void;
  quickPreset?: QuickFilterPreset;
  currentUserId?: string | null;
  currentUserEmail?: string | null;
};

type LeadKanbanItem = {
  id: string;
  title: string;
  ariaLabel: string;
  lead: Lead;
};

type LeadKanbanColumn = {
  id: string;
  title: ReactNode;
  // Issue #213 — GDS's own KanbanColumnData.title accepts a ReactNode (an
  // icon+label, a colored dot, a custom count pill, …), and its own doc
  // comment requires ariaLabel be set whenever title isn't plain text so
  // move-menu targets/drag announcements keep a meaningful accessible name.
  // Only actually differs from `title` once the WIP cue badge is shown.
  ariaLabel?: string;
  items: LeadKanbanItem[];
  totalCount: number;
};

// GDS's KanbanColumn has no dedicated "load more" slot for server-paginated
// columns — it renders whatever `items` it's given, full stop. Rather than
// duplicate GDS's internal DndContext/sensors setup ourselves (the
// @dnd-kit dependency is deliberately encapsulated, never a consumer
// import, per the 3.11.0 changelog), this renders inline at the end of the
// last card's body via `renderItem`, visually set off with a top divider
// so it still reads as "below" the card rather than part of it.
function LoadMoreSentinel({ onLoadMore }: { onLoadMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onLoadMoreRef = useRef(onLoadMore);

  useEffect(() => {
    onLoadMoreRef.current = onLoadMore;
  }, [onLoadMore]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        onLoadMoreRef.current();
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <Box ref={ref} pt="xs" mt="xs" style={{ borderTop: '1px solid var(--gds-border-card)' }}>
      <Group justify="center" py="xs">
        <Loader size="xs" />
      </Group>
    </Box>
  );
}

function DroppableColumnShell({
  columnId,
  disabled,
  isDropTarget,
  isBacklog,
  isCollapsed,
  children,
}: {
  columnId: string;
  disabled: boolean;
  isDropTarget: boolean;
  isBacklog: boolean;
  isCollapsed: boolean;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: toColumnShellId(columnId),
    disabled,
  });

  return (
    <div
      ref={disabled ? undefined : setNodeRef}
      data-gds-kanban-drop-shell={columnId}
      data-gds-kanban-drop-shell-collapsed={isCollapsed ? 'true' : undefined}
      data-gds-kanban-drop-target={isDropTarget ? 'true' : undefined}
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: isBacklog ? '1 1 100%' : '0 0 auto',
        width: isBacklog ? '100%' : undefined,
        alignSelf: 'stretch',
        minHeight: 0,
      }}
    >
      {children}
    </div>
  );
}

function ReliableKanbanBoard({
  columns,
  onMoveItem,
  renderItem,
  emptyColumnLabel,
  collapsedColumnIds,
  onCollapsedChange,
  enableDrag,
  columnPanZone,
  columnWidth,
}: {
  columns: LeadKanbanColumn[];
  onMoveItem: (itemId: string, fromColumnId: string, toColumnId: string, toIndex?: number) => void;
  renderItem: (item: GdsKanbanItem, column: GdsKanbanColumnData) => ReactNode;
  emptyColumnLabel: string;
  collapsedColumnIds: string[];
  onCollapsedChange: (columnId: string, collapsed: boolean) => void;
  enableDrag: boolean;
  columnPanZone: 'header' | 'none';
  columnWidth: number;
}) {
  const resolvedOrientation = useGdsKanbanOrientation();
  const [activeItem, setActiveItem] = useState<{ item: LeadKanbanItem; column: LeadKanbanColumn } | null>(null);
  const [activeOverColumnId, setActiveOverColumnId] = useState<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || columnPanZone !== 'header' || resolvedOrientation === 'stacked') {
      return undefined;
    }
    if (typeof window === 'undefined' || !window.matchMedia?.('(pointer: fine)').matches) {
      return undefined;
    }
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest?.('[data-gds-kanban-column-header]')) {
        return;
      }
      const delta = event.deltaY !== 0 ? event.deltaY : event.deltaX;
      if (delta === 0) return;
      const rtl = getComputedStyle(viewport).direction === 'rtl';
      viewport.scrollLeft += rtl ? -delta : delta;
      event.preventDefault();
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [columnPanZone, resolvedOrientation]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const { columnIds, itemToColumn } = useMemo(() => {
    const cols = new Set<string>();
    const items = new Map<string, string>();
    for (const col of columns) {
      cols.add(col.id);
      for (const item of col.items) {
        items.set(item.id, col.id);
      }
    }
    return { columnIds: cols, itemToColumn: items };
  }, [columns]);

  const collisionContextRef = useRef({ columnIds, itemToColumn });
  useEffect(() => {
    collisionContextRef.current = { columnIds, itemToColumn };
  }, [columnIds, itemToColumn]);

  const collisionDetection: CollisionDetection = useCallback(
    (args) => kanbanCollisionDetection(args, collisionContextRef.current),
    [],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const activeId = String(event.active.id);
    const fromColumn = columns.find((col) => col.items.some((item) => item.id === activeId));
    const item = fromColumn?.items.find((candidate) => candidate.id === activeId);
    if (fromColumn && item) {
      setActiveItem({ item, column: fromColumn });
      setActiveOverColumnId(fromColumn.id);
    }
  }, [columns]);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    if (!event.over) {
      setActiveOverColumnId((prev) => (prev !== null ? null : prev));
      return;
    }
    const nextCol = resolveColumnForDroppableId(String(event.over.id), collisionContextRef.current);
    setActiveOverColumnId((prev) => (prev === nextCol ? prev : nextCol));
  }, []);

  const handleDragCancel = useCallback(() => {
    setActiveItem(null);
    setActiveOverColumnId(null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const startColId = activeItem?.column.id ?? null;
    setActiveItem(null);
    setActiveOverColumnId(null);

    const { active, over } = event;
    if (!over) return;

    const itemId = String(active.id);
    const fromColumn = columns.find((col) => col.items.some((item) => item.id === itemId));
    const fromColumnId = fromColumn?.id ?? startColId;
    if (!fromColumnId) return;

    const dest = resolveDropDestination(String(over.id), columns);
    if (!dest) return;

    if (fromColumn) {
      const currentIdx = fromColumn.items.findIndex((candidate) => candidate.id === itemId);
      if (fromColumnId === dest.columnId && dest.toIndex === currentIdx) {
        return;
      }
    }

    onMoveItem(itemId, fromColumnId, dest.columnId, dest.toIndex);
  }, [columns, activeItem, onMoveItem]);

  const gdsColumns = columns as GdsKanbanColumnData[];
  const renderColumnList = () => columns.map((column) => {
    const isCollapsed = collapsedColumnIds.includes(column.id);
    const isDropTarget = Boolean(
      enableDrag &&
      activeItem &&
      activeOverColumnId === column.id &&
      activeItem.column.id !== column.id &&
      !isCollapsed,
    );
    return (
      <DroppableColumnShell
        key={column.id}
        columnId={column.id}
        disabled={!enableDrag || isCollapsed}
        isDropTarget={isDropTarget}
        isBacklog={column.id === 'BACKLOG'}
        isCollapsed={isCollapsed}
      >
        <GdsKanbanColumn
          column={column}
          columns={gdsColumns}
          onMoveItem={onMoveItem}
          renderItem={renderItem}
          emptyLabel={emptyColumnLabel}
          enableDrag={enableDrag}
          width={resolvedOrientation === 'stacked' ? undefined : columnWidth}
          collapsible
          collapsed={isCollapsed}
          onCollapsedChange={(next) => onCollapsedChange(column.id, next)}
        />
      </DroppableColumnShell>
    );
  });

  const board = (
    <Stack gap="md" role="region" aria-label="Kanban board" data-gds-kanban-orientation={resolvedOrientation}>
      {resolvedOrientation === 'stacked' ? (
        <Stack gap="lg">{renderColumnList()}</Stack>
      ) : (
        <ScrollArea type="auto" scrollbarSize={8} offsetScrollbars viewportRef={viewportRef}>
          <Group gap="md" wrap="nowrap" align="stretch">
            {renderColumnList()}
          </Group>
        </ScrollArea>
      )}
    </Stack>
  );

  if (!enableDrag) {
    return board;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      {board}
      <DragOverlay dropAnimation={null} zIndex={1400}>
        {activeItem ? (
          <Paper
            withBorder
            radius="md"
            p="sm"
            shadow="md"
            style={{
              width: 300,
              pointerEvents: 'none',
              borderColor: 'var(--mantine-color-blue-5)',
              backgroundColor: 'var(--gds-bg-card)',
            }}
          >
            <Stack gap={2}>
              <Text fw={600} size="sm" truncate>
                {activeItem.item.title}
              </Text>
              <Text size="xs" c="dimmed">
                Moving from {activeItem.column.ariaLabel || (typeof activeItem.column.title === 'string' ? activeItem.column.title : activeItem.column.id)}
              </Text>
            </Stack>
          </Paper>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function KanbanBoard({ brand, tenantId = 'default', onOpenLead, forecast, forecastCurrency = 'USD', filter, selectMode = false, columnDefs = COLUMNS, onVisibleLeadsChange, onAction, quickPreset = 'all', currentUserId, currentUserEmail }: BoardProps) {
  // Record<string, ...> (not Record<KanbanColumn, ...>) — this component no
  // longer always manages all 6 Pipeline columns; the Backlog board mounts
  // it with a single 'BACKLOG' entry instead (issue #126).
  const [columnStates, setColumnStates] = useState<Record<string, ColumnState>>(() => {
    const init: Record<string, ColumnState> = {}
    for (const col of columnDefs) {
      init[col.key] = { leads: [], count: 0, hasMore: false, cursor: null, loading: false }
    }
    return init
  })
  const columnStatesRef = useRef(columnStates)
  useEffect(() => {
    columnStatesRef.current = columnStates
  }, [columnStates])
  const columnEpochRef = useRef<Record<string, number>>({})
  const inFlightMoveCountRef = useRef(0)
  const [bootstrapped, setBootstrapped] = useState(false)

  // Ensure columnStates stays populated when columnDefs changes dynamically
  useEffect(() => {
    setColumnStates((prev) => {
      let changed = false
      const next = { ...prev }
      for (const col of columnDefs) {
        if (!next[col.key]) {
          next[col.key] = { leads: [], count: 0, hasMore: false, cursor: null, loading: false }
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [columnDefs])

  // Issue #213 — flattened, deduped-by-id lead list for the command
  // palette's "jump to lead" command. No new network call: this only ever
  // reflects leads already fetched into columnStates by this board's own
  // existing load/loadColumn calls.
  const lastVisibleLeadIdsRef = useRef<string>('')
  useEffect(() => {
    if (!onVisibleLeadsChange) return
    const byId = new Map<string, Lead>()
    for (const col of Object.values(columnStates)) {
      if (col && Array.isArray(col.leads)) {
        for (const lead of col.leads) byId.set(lead._id, lead)
      }
    }
    const leads = Array.from(byId.values())
    const idsKey = leads.map((l) => l._id).join(',')
    if (idsKey !== lastVisibleLeadIdsRef.current) {
      lastVisibleLeadIdsRef.current = idsKey
      onVisibleLeadsChange(leads)
    }
  }, [columnStates, onVisibleLeadsChange])

  // Desktop trackpad and mouse wheel "natural scroll" fix: on desktop layouts,
  // GDS's KanbanBoard wraps its columns in a horizontally-scrolling Mantine
  // ScrollArea. While columnPanZone="header" lets GDS pan columns horizontally
  // when hovering over headers, Chromium desktop browsers trap wheel gestures
  // over cards/board-body in the Mantine ScrollArea viewport without scrolling
  // the page vertically.
  //
  // Attached as a real (non-passive) DOM listener via addEventListener: React attaches
  // its root wheel listeners as passive, so event.preventDefault() inside a React
  // onWheel handler is silently a no-op — only a non-passive listener can cancel
  // the browser container capture.
  //
  // Dual-zone routing:
  // 1. If target is within [data-gds-kanban-column-header], return early so GDS's
  //    native columnPanZone="header" handles horizontal column panning.
  // 2. Otherwise (over cards, empty column space, card actions), if the gesture is
  //    vertical-dominant, prevent default container capture and dispatch
  //    window.scrollBy so the page scrolls vertically.
  //
  // Desktop-only (matchMedia('(pointer: fine)')): on touch devices / mobile PWA,
  // GDS handles touch panning natively and native touch gestures must never be intercepted.
  const boardWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boardWrapperRef.current
    if (!el || typeof window === 'undefined' || !window.matchMedia?.('(pointer: fine)').matches) return

    function handleWheel(event: WheelEvent) {
      const target = event.target as HTMLElement | null
      if (target?.closest?.('[data-gds-kanban-column-header]')) {
        return
      }

      if (!isVerticalScrollIntent(event.deltaX, event.deltaY)) return
      event.preventDefault()
      const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1
      window.scrollBy({ top: event.deltaY * multiplier, left: 0, behavior: 'instant' })
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  // Real in-place collapse (issue #53) — GDS 3.14.0 added native
  // collapsible/collapsedColumnIds/onCollapsedChange support to KanbanBoard,
  // rendering a header disclosure toggle on every column. Replaces the
  // hide-whole-column-via-a-separate-chip-row workaround (issue #49) this
  // app shipped before that capability existed — tapping a column's own
  // header now collapses/expands it in place, exactly the affordance
  // originally asked for.
  const [collapsedColumnIds, setCollapsedColumnIds] = useState<string[]>([])

  const handleCollapsedChange = useCallback((columnId: string, collapsed: boolean) => {
    setCollapsedColumnIds((prev) =>
      collapsed ? [...prev, columnId] : prev.filter((id) => id !== columnId)
    )
  }, [])

  // Fetched once per board mount, not per card — stale/critical badges are
  // computed client-side in renderItem from data already in memory, so this
  // is the only network call staleness detection needs. Falls back to
  // DEFAULT_STALE_THRESHOLDS on fetch failure, matching the pipeline-weights
  // GET fallback pattern in app/api/settings/route.ts.
  const [staleThresholds, setStaleThresholds] = useState<Record<StaleDealColumn, number>>(DEFAULT_STALE_THRESHOLDS)
  // Issue #213 — same fetch, same fallback-to-default-on-failure contract
  // as staleThresholds above; extends the one existing /api/settings round
  // trip rather than adding a second one (§16's own explicit requirement).
  const [wipLimits, setWipLimits] = useState<Record<string, number>>(DEFAULT_WIP_LIMITS)

  // Issue 245 — drag-and-drop stage movement is enabled by default out of
  // the box. An explicit `{ dragEnabled: false }` from `/api/settings`
  // still acts as an operator kill switch if needed.
  const [dragEnabled, setDragEnabled] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Settings load failed: ${res.status}`))))
      .then((data) => {
        if (cancelled) return
        if (data.thresholds) setStaleThresholds(data.thresholds)
        if (data.wipLimits) setWipLimits(data.wipLimits)
        if (typeof data.dragEnabled === 'boolean') setDragEnabled(data.dragEnabled)
      })
      .catch((err) => {
        console.error('Stale thresholds load error:', err)
      })
    return () => { cancelled = true }
  }, [])

  const loadColumn = useCallback(async (colKey: KanbanColumn, cursor?: string | null) => {
    const epoch = (columnEpochRef.current[colKey] = (columnEpochRef.current[colKey] || 0) + 1)
    setColumnStates((prev) => ({
      ...prev,
      [colKey]: { ...(prev[colKey] || { leads: [], count: 0, hasMore: false, cursor: null }), loading: true },
    }))

    try {
      const url = new URL('/api/leads/columns', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      url.searchParams.set('column', colKey)
      if (cursor) url.searchParams.set('cursor', cursor)
      if (filter?.region) url.searchParams.set('region', filter.region)
      if (filter?.industry?.trim()) url.searchParams.set('industry', filter.industry.trim())
      if (filter?.tags && filter.tags.length > 0) url.searchParams.set('tags', filter.tags.join(','))
      if (filter?.assignedTo) url.searchParams.set('assignedTo', filter.assignedTo)

      const res = await fetch(url.toString())
      if (!res.ok) throw new Error(`Column load failed: ${res.status}`)

      const data = await res.json()

      if (columnEpochRef.current[colKey] !== epoch) {
        setColumnStates((prev) => ({
          ...prev,
          [colKey]: { ...(prev[colKey] || { leads: [], count: 0, hasMore: false, cursor: null }), loading: false },
        }))
        return
      }

      setColumnStates((prev) => {
        const current = prev[colKey] || { leads: [], count: 0, hasMore: false, cursor: null, loading: false }
        const existingIds = new Set<string>()
        const dedupedLeads: Lead[] = []
        const incoming = cursor
          ? [...(current.leads || []), ...(data.leads || [])]
          : [...(data.leads || [])]

        for (const lead of incoming) {
          if (lead && lead._id && !existingIds.has(lead._id)) {
            existingIds.add(lead._id)
            dedupedLeads.push(lead)
          }
        }

        return {
          ...prev,
          [colKey]: {
            leads: dedupedLeads,
            count: data.count || 0,
            hasMore: Boolean(data.hasMore),
            cursor: data.nextCursor || null,
            loading: false,
          },
        }
      })
    } catch (err) {
      console.error(`Column ${colKey} load error:`, err)
      setColumnStates((prev) => ({
        ...prev,
        [colKey]: { ...(prev[colKey] || { leads: [], count: 0, hasMore: false, cursor: null }), loading: false },
      }))
    }
  }, [brand, tenantId, filter])

  // Bootstrap all columns with their first chunk — also re-runs whenever
  // filter changes, since loadColumn (in its deps) is a new function
  // reference whenever the filter object changes (issue #71).
  useEffect(() => {
    setBootstrapped(false)
    Promise.all(columnDefs.map((col) => loadColumn(col.key))).then(() => setBootstrapped(true))
  }, [brand, tenantId, loadColumn, columnDefs])

  const handleMove = useCallback(async (leadId: string, fromColumn: KanbanColumn, toColumn: KanbanColumn) => {
    const prevFromLeads = columnStatesRef.current[fromColumn]?.leads ?? []
    const originalIndex = prevFromLeads.findIndex((l) => l._id === leadId)
    const sourceLead = originalIndex >= 0 ? prevFromLeads[originalIndex] : null

    columnEpochRef.current[fromColumn] = (columnEpochRef.current[fromColumn] || 0) + 1
    columnEpochRef.current[toColumn] = (columnEpochRef.current[toColumn] || 0) + 1
    inFlightMoveCountRef.current += 1

    // Optimistic UI: move the card visibly into toColumn right away so it
    // never vanishes during network latency; reconcile with server afterward.
    setColumnStates((prev) => {
      const fromState = prev[fromColumn] || { leads: [], count: 0, hasMore: false, cursor: null, loading: false }
      const toState = prev[toColumn] || { leads: [], count: 0, hasMore: false, cursor: null, loading: false }
      const currentLead = (fromState.leads || []).find((l) => l._id === leadId) ?? sourceLead
      const updatedLead = currentLead ? { ...currentLead, kanbanColumn: toColumn } : null
      const alreadyInTarget = (toState.leads || []).some((l) => l._id === leadId)
      const nextToLeads = updatedLead
        ? [updatedLead, ...(toState.leads || []).filter((l) => l._id !== leadId)]
        : (toState.leads || [])
      const nextFromLeads = (fromState.leads || []).filter((l) => l._id !== leadId)
      return {
        ...prev,
        [fromColumn]: {
          ...fromState,
          leads: nextFromLeads,
          count: nextFromLeads.length < (fromState.leads || []).length ? Math.max(0, (fromState.count || 0) - 1) : (fromState.count || 0),
        },
        [toColumn]: {
          ...toState,
          leads: nextToLeads,
          count: updatedLead && !alreadyInTarget ? (toState.count || 0) + 1 : (toState.count || 0),
        },
      }
    })

    try {
      const url = new URL('/api/leads', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      url.searchParams.set('id', leadId)

      const res = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, action: 'COLUMN_MOVE', kanbanColumn: toColumn, sortOrder: Date.now() }),
      })

      if (!res.ok) {
        // Issue #72: surfaces the real server-provided reason (e.g. a stage-
        // gate rejection) instead of a bare HTTP status, which read
        // identically for every kind of failure.
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Move failed: ${res.status}`)
      }

      if (inFlightMoveCountRef.current <= 1) {
        await Promise.all([loadColumn(toColumn), loadColumn(fromColumn)])
      }
    } catch (err) {
      console.error('Column move error:', err)
      if (sourceLead) {
        setColumnStates((prev) => {
          const fromState = prev[fromColumn] || { leads: [], count: 0, hasMore: false, cursor: null, loading: false }
          const toState = prev[toColumn] || { leads: [], count: 0, hasMore: false, cursor: null, loading: false }
          const alreadyInFrom = (fromState.leads || []).some((l) => l._id === leadId)
          const fromLeads = alreadyInFrom
            ? (fromState.leads || [])
            : [
                ...(fromState.leads || []).slice(0, Math.max(0, originalIndex)),
                sourceLead,
                ...(fromState.leads || []).slice(Math.max(0, originalIndex)),
              ]
          const removedFromTo = (toState.leads || []).some((l) => l._id === leadId)
          return {
            ...prev,
            [fromColumn]: {
              ...fromState,
              leads: fromLeads,
              count: alreadyInFrom ? (fromState.count || 0) : (fromState.count || 0) + 1,
            },
            [toColumn]: {
              ...toState,
              leads: (toState.leads || []).filter((l) => l._id !== leadId),
              count: removedFromTo ? Math.max(0, (toState.count || 0) - 1) : (toState.count || 0),
            },
          }
        })
      }
      showNotification({
        message: err instanceof Error ? err.message : 'Failed to move lead to that column',
        color: 'red',
        autoClose: 5000,
      })
      if (inFlightMoveCountRef.current <= 1) {
        await Promise.all([loadColumn(fromColumn), loadColumn(toColumn)])
      }
    } finally {
      inFlightMoveCountRef.current = Math.max(0, inFlightMoveCountRef.current - 1)
    }
  }, [brand, tenantId, loadColumn])

  // Same-column drag reorder (issue #208) — PATCHes the new COLUMN_REORDER
  // action with the fresh prevLeadId/nextLeadId neighbors GDS's drop index
  // resolves to (resolveReorderNeighbors, lib/kanban-reorder.ts). Optimistic
  // local reorder first (same contract as handleMove above); on failure,
  // reload the column from the server to discard it and surface the real
  // reason via showNotification — never a silent revert.
  const handleReorder = useCallback(async (leadId: string, column: KanbanColumn, toIndex: number) => {
    const currentIds = columnStatesRef.current[column]?.leads.map((l) => l._id) ?? []
    const { prevLeadId, nextLeadId } = resolveReorderNeighbors(currentIds, leadId, toIndex)

    setColumnStates((prev) => {
      const leads = prev[column]?.leads ?? []
      const dragged = leads.find((l) => l._id === leadId)
      if (!dragged) return prev
      const withoutDragged = leads.filter((l) => l._id !== leadId)
      const clampedIndex = Math.max(0, Math.min(toIndex, withoutDragged.length))
      const reordered = [...withoutDragged.slice(0, clampedIndex), dragged, ...withoutDragged.slice(clampedIndex)]
      return { ...prev, [column]: { ...prev[column], leads: reordered } }
    })

    try {
      const url = new URL('/api/leads', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      url.searchParams.set('id', leadId)

      const res = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, action: 'COLUMN_REORDER', prevLeadId, nextLeadId }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Reorder failed: ${res.status}`)
      }
    } catch (err) {
      console.error('Column reorder error:', err)
      showNotification({
        message: err instanceof Error ? err.message : 'Failed to reorder lead',
        color: 'red',
        autoClose: 5000,
      })
      await loadColumn(column)
    }
  }, [brand, tenantId, loadColumn])

  // GDS's drag (SortableContext) allows same-column reordering as well as
  // cross-column moves — previously a same-column drag was a hard no-op
  // (this app's API had no concept of an arbitrary drop position at all),
  // which showed zero feedback: the card just silently snapped back. Issue
  // #208 adds a real reorder path for the five manually-controlled columns
  // (ENGAGED/PROPOSAL/WON/LOST/BACKLOG); DISCOVERED/QUALIFIED stay
  // score-sorted (lib/kanban-column.ts) and explicitly reject a same-column
  // drag with a visible reason instead of silently reverting.
  // decideMoveItemAction (lib/kanban-reorder.ts) is the pure three-way
  // branch; `toIndex` is only ever populated by an actual drag gesture
  // (GDS's OnMoveItem type), never by the "Move to column" menu.
  const handleMoveItem = useCallback((itemId: string, fromColumnId: string, toColumnId: string, toIndex?: number) => {
    const decision = decideMoveItemAction(fromColumnId, toColumnId, isAutoManagedColumn(toColumnId))
    if (decision === 'cross-column') {
      handleMove(itemId, fromColumnId as KanbanColumn, toColumnId as KanbanColumn)
      return
    }
    if (decision === 'auto-managed-reject') {
      showNotification({
        message: 'This column is sorted automatically by lead score — manual reordering isn\'t available here.',
        color: 'yellow',
      })
      return
    }
    handleReorder(itemId, toColumnId as KanbanColumn, toIndex ?? 0)
  }, [handleMove, handleReorder])

  // Issue #70: bulk DECLINE/PIN. `selectMode` itself is a prop now (the
  // toggle button lives one level up, sharing a row with the Filters
  // trigger) — this resets the in-board selection whenever the parent
  // flips it off, so leaving select mode always clears state cleanly.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectedColumn, setSelectedColumn] = useState<KanbanColumn | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)

  // Bulk actions v2 (issue #203) — the NN/g baseline bulk-actions pattern's
  // first leg ("select-all"), previously entirely absent from this board:
  // a column picker + "select all loaded" button that seeds a selection
  // without needing to tick every card by hand first.
  const [selectAllColumn, setSelectAllColumn] = useState<KanbanColumn | null>(null)

  // Bulk single-field edit (issue #203) — "Edit field…" inline form state.
  const [fieldEditOpen, setFieldEditOpen] = useState(false)
  const [fieldEditField, setFieldEditField] = useState<'tags' | 'qualityStatus'>('tags')
  const [fieldEditTagOp, setFieldEditTagOp] = useState<'add' | 'remove'>('add')
  const [fieldEditTagValue, setFieldEditTagValue] = useState('')
  const [fieldEditQualityStatus, setFieldEditQualityStatus] = useState<string | null>('DRAFT')

  // Bulk reassignment (issue #203, unblocked by issue #198's Lead.assignedTo)
  // — "Reassign…" inline form state. Options are fetched lazily, only once
  // select mode is actually active, from the same brand-scoped endpoint
  // app/detail.tsx's single-lead assignee picker already uses.
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignableUsers, setAssignableUsers] = useState<Array<{ ssoUserId: string; email: string; name?: string }>>([])
  const [assignTarget, setAssignTarget] = useState<string | null>(null)

  // Real, server-verified undo (issue #203) — Mongo-backed on the server
  // (bulkActionUndoTokens, TTL-indexed), not in-process client state beyond
  // what's needed to render the countdown and know which column(s) to
  // reload afterward.
  type UndoInfo = {
    token: string
    expiresAt: string
    notReversible: Array<{ leadId: string; reason: string }>
    sourceColumn: KanbanColumn
    action: 'ACCEPT' | 'DECLINE' | 'PIN' | 'FIELD_EDIT' | 'ASSIGN'
  }
  const [undoInfo, setUndoInfo] = useState<UndoInfo | null>(null)
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0)
  const [undoRunning, setUndoRunning] = useState(false)

  useEffect(() => {
    if (!selectMode) {
      setSelectedIds(new Set())
      setSelectedColumn(null)
      setSelectAllColumn(null)
      setFieldEditOpen(false)
      setAssignOpen(false)
    }
  }, [selectMode])

  // Server-side expiresAt is the real authority (issue #203 §15's "window
  // expiry race") — this countdown is purely a display convenience; a click
  // after it hits 0 still gets a real 410 from the server, handled in
  // runUndo below, not assumed client-side.
  useEffect(() => {
    if (!undoInfo) {
      setUndoSecondsLeft(0)
      return
    }
    const tick = () => {
      setUndoSecondsLeft(Math.max(0, Math.ceil((new Date(undoInfo.expiresAt).getTime() - Date.now()) / 1000)))
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [undoInfo])

  useEffect(() => {
    if (!selectMode) return
    let cancelled = false
    fetch(`/api/leads/assignable-users?brand=${encodeURIComponent(brand)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled) setAssignableUsers(data?.users || []) })
      .catch(() => { if (!cancelled) setAssignableUsers([]) })
    return () => { cancelled = true }
  }, [selectMode, brand])

  const handleSelectAllInColumn = useCallback(() => {
    if (!selectAllColumn) return
    const state = columnStates[selectAllColumn]
    if (!state || state.leads.length === 0) return
    setSelectedIds(new Set(state.leads.map((l) => l._id)))
    setSelectedColumn(selectAllColumn)
  }, [selectAllColumn, columnStates])

  const toggleSelected = useCallback((leadId: string, column: KanbanColumn) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(leadId)) {
        next.delete(leadId)
        if (next.size === 0) setSelectedColumn(null)
      } else {
        // Same-column-only selection (issue #70's confirmed scope) — a
        // mixed-column bulk action would have ambiguous semantics (a
        // COLUMN_MOVE target that varies per lead), so this is blocked
        // client-side with a clear message rather than silently applying
        // to whichever leads happen to match.
        if (selectedColumn && column !== selectedColumn) {
          showNotification({
            message: `Selection is limited to one column at a time (currently ${selectedColumn}).`,
            color: 'yellow',
          })
          return prev
        }
        next.add(leadId)
        setSelectedColumn(column)
      }
      return next
    })
  }, [selectedColumn])

  const runBulkAction = useCallback(async (
    action: 'ACCEPT' | 'DECLINE' | 'PIN' | 'FIELD_EDIT' | 'ASSIGN',
    payload: Record<string, any> = {}
  ) => {
    if (selectedIds.size === 0 || !selectedColumn) return
    setBulkRunning(true)
    try {
      const res = await fetch('/api/leads/bulk', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          tenantId,
          leadIds: Array.from(selectedIds),
          action,
          payload: action === 'DECLINE' ? { declineReason: 'OTHER' } : payload,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Bulk action failed: ${res.status}`)
      }
      const data = await res.json()
      const results: Array<{ leadId: string; success: boolean; error?: string }> = data.results || []
      const succeeded = results.filter((r) => r.success).length
      const failed = results.length - succeeded
      const firstError = results.find((r) => !r.success)?.error
      const verb = action === 'DECLINE' ? 'declined' : action === 'PIN' ? 'pinned' : action === 'ACCEPT' ? 'accepted'
        : action === 'ASSIGN' ? 'reassigned' : 'updated'

      showNotification({
        message: failed === 0
          ? `${succeeded} lead${succeeded === 1 ? '' : 's'} ${verb}.`
          : `${succeeded} of ${results.length} ${verb} — ${failed} blocked${firstError ? `: ${firstError}` : ''}.`,
        color: failed === 0 ? 'teal' : 'yellow',
        autoClose: failed === 0 ? 4000 : 8000,
      })

      // Real, server-verified undo (issue #203) — captured alongside the
      // column/action this run applied to, so a later Undo click knows
      // which column(s) to reload without depending on selectedColumn
      // (cleared below, right after this).
      if (data.undo) {
        setUndoInfo({ ...data.undo, sourceColumn: selectedColumn, action })
      }

      await loadColumn(selectedColumn)
      if (action === 'PIN') await loadColumn('ENGAGED')
      setSelectedIds(new Set())
      setSelectedColumn(null)
      setFieldEditOpen(false)
      setAssignOpen(false)
    } catch (err) {
      showNotification({
        message: err instanceof Error ? err.message : 'Bulk action failed',
        color: 'red',
        autoClose: 5000,
      })
    } finally {
      setBulkRunning(false)
    }
  }, [brand, tenantId, selectedIds, selectedColumn, loadColumn])

  const runUndo = useCallback(async () => {
    if (!undoInfo) return
    setUndoRunning(true)
    try {
      const res = await fetch('/api/leads/bulk/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, tenantId, token: undoInfo.token }),
      })
      if (res.status === 410) {
        showNotification({ message: 'Undo window has expired.', color: 'yellow' })
        setUndoInfo(null)
        return
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Undo failed: ${res.status}`)
      }
      const data = await res.json()
      const results: Array<{ leadId: string; success: boolean }> = data.results || []
      const skipped: Array<{ leadId: string; reason: string }> = data.skipped || []
      const restored = results.filter((r) => r.success).length

      showNotification({
        message: skipped.length === 0
          ? `${restored} lead${restored === 1 ? '' : 's'} restored.`
          : `${restored} restored, ${skipped.length} skipped — changed since the original action.`,
        color: skipped.length === 0 ? 'teal' : 'yellow',
        autoClose: 6000,
      })

      await loadColumn(undoInfo.sourceColumn)
      if (undoInfo.action === 'DECLINE') await loadColumn('LOST')
      if (undoInfo.action === 'PIN') await loadColumn('ENGAGED')
      setUndoInfo(null)
    } catch (err) {
      showNotification({
        message: err instanceof Error ? err.message : 'Undo failed',
        color: 'red',
        autoClose: 5000,
      })
    } finally {
      setUndoRunning(false)
    }
  }, [undoInfo, brand, tenantId, loadColumn])

  const formatForecast = useCallback((value: number) => {
    const symbol = forecastCurrency === 'EUR' ? '€' : '$'
    return `${symbol}${Math.round(value).toLocaleString()}`
  }, [forecastCurrency])

  // GDS 3.14.0 added KanbanColumnData.totalCount — the column header's own
  // count badge now renders that real server-side total (falling back to
  // items.length only when omitted), so the count no longer needs to be
  // hand-embedded into the title text. Before this, GDS's badge and this
  // title string both showed a count in the same header, one above the
  // other — a real duplicate, not just a cosmetic one, since GDS's badge is
  // always rendered and was never optional. The per-column forecast still
  // has nowhere else to go (no dedicated subtitle slot), so it stays in the
  // title string alongside the plain column label.
  const columns: LeadKanbanColumn[] = useMemo(() => columnDefs.map((col) => {
    const colState = columnStates[col.key] || { leads: [], count: 0, hasMore: false, cursor: null, loading: false }
    const colForecast = forecast?.[col.key]
    const forecastLabel = colForecast && colForecast.rawRevenue > 0
      ? ` · ${formatForecast(colForecast.weightedRevenue)}`
      : ''
    const plainTitle = `${col.label}${forecastLabel}`

    // Issue #213 — a non-blocking, purely visual WIP-limit cue. Never
    // touches totalCount (#48's own count badge, unchanged) or anything
    // that would affect the column's ability to accept more cards.
    const wipThreshold = resolveWipThreshold(col.key, wipLimits)
    const overWipLimit = isOverWipLimit(colState.count || 0, wipThreshold)
    const title = overWipLimit ? (
      <Group gap={6} wrap="wrap" style={{ minWidth: 0, flex: 1 }}>
        <Text component="span" size="sm" fw={600} truncate>{plainTitle}</Text>
        <StatusBadge
          status="warning"
          size="xs"
          aria-label={`${colState.count || 0} leads, over the configured limit of ${wipThreshold}`}
        >
          {colState.count || 0}/{wipThreshold}
        </StatusBadge>
      </Group>
    ) : plainTitle

    const seenIds = new Set<string>()
    const items: LeadKanbanItem[] = []
    for (const lead of (colState.leads || [])) {
      if (!lead || !lead._id || seenIds.has(lead._id)) continue
      if (quickPreset && quickPreset !== 'all' && !matchesQuickFilterPreset(lead, quickPreset, { currentUserId, currentUserEmail })) {
        continue
      }
      seenIds.add(lead._id)
      items.push({
        id: lead._id,
        title: lead.entity_name || 'Untitled lead',
        ariaLabel: lead.entity_name || 'Untitled lead',
        lead,
      })
    }

    const effectiveTotalCount = quickPreset && quickPreset !== 'all' ? items.length : (colState.count || 0)

    return {
      id: col.key,
      title,
      ariaLabel: overWipLimit ? `${plainTitle}, ${colState.count || 0} of ${wipThreshold} WIP limit` : undefined,
      totalCount: effectiveTotalCount,
      items,
    }
  }), [columnStates, forecast, formatForecast, columnDefs, wipLimits, quickPreset, currentUserId, currentUserEmail])

  // Issue #185 — onboarding tour needs exactly one real card to spotlight,
  // not every card on the board. `LeadCard` mounts once per card
  // (renderItem below), so a hardcoded data-tour value there would tag
  // every instance — this identifies which single card (first item of the
  // first non-empty column) should actually carry it.
  const firstNonEmptyColumnId = useMemo(
    () => columns.find((c) => c.items.length > 0)?.id,
    [columns]
  )

  // GDS's KanbanItem/KanbanColumnData are fixed, non-generic interfaces — the
  // real renderItem prop is checked contravariantly against exactly that
  // shape, so the callback's own parameter types must match it, not our
  // richer LeadKanbanItem/LeadKanbanColumn (which we know these objects
  // actually are at runtime, since we built them in `columns` above).
  const renderItem = useCallback((item: GdsKanbanItem, column: GdsKanbanColumnData) => {
    const leadItem = item as LeadKanbanItem
    if (!leadItem?.lead) return null
    const lead = leadItem.lead
    const colState = columnStates[column.id as KanbanColumn] || { leads: [], count: 0, hasMore: false, cursor: null, loading: false }
    const isLast = column.items[column.items.length - 1]?.id === item.id
    const now = new Date()

    let staleness: StaleDealResult | null = null
    try {
      staleness = computeStaleness(
        { kanbanColumn: lead.kanbanColumn as StaleDealColumn, updatedAt: lead.updatedAt },
        staleThresholds,
        now
      )
    } catch {
      staleness = null
    }

    let nudge: Nudge | null = null
    try {
      nudge = getNextStepNudge(
        { kanbanColumn: lead.kanbanColumn, createdAt: lead.createdAt, contacts: lead.contacts },
        staleness,
        now
      )
    } catch {
      nudge = null
    }

    const tourTarget = column.id === firstNonEmptyColumnId && column.items[0]?.id === item.id
    return (
      <ErrorBoundary
        fallback={
          <Box p="xs" style={{ border: '1px solid var(--gds-border-card)', borderRadius: 6 }}>
            <Text size="xs" c="dimmed">Card unavailable ({lead.entity_name || lead._id})</Text>
          </Box>
        }
      >
        {selectMode && (
          <Checkbox
            size="sm"
            mb={4}
            aria-label={`Select ${lead.entity_name || 'lead'} for bulk action`}
            checked={selectedIds.has(lead._id)}
            onChange={() => toggleSelected(lead._id, column.id as KanbanColumn)}
            onClick={(e) => e.stopPropagation()}
            disabled={Boolean(selectedColumn) && selectedColumn !== (column.id as KanbanColumn) && !selectedIds.has(lead._id)}
          />
        )}
        <LeadCard
          lead={lead}
          onOpen={() => onOpenLead(lead)}
          staleness={staleness}
          nudge={nudge}
          winProbability={forecast?.[column.id]?.probability ?? null}
          tourTarget={tourTarget}
          onAction={onAction}
        />
        {isLast && Boolean(colState?.hasMore) && !colState?.loading && (
          <LoadMoreSentinel onLoadMore={() => loadColumn(column.id as KanbanColumn, colState.cursor)} />
        )}
      </ErrorBoundary>
    )
  }, [columnStates, onOpenLead, loadColumn, staleThresholds, selectMode, selectedIds, selectedColumn, toggleSelected, forecast, firstNonEmptyColumnId, onAction])

  return (
    <>
      {/* Bulk actions v2 (issue #203) — the NN/g "select-all" leg, always
          visible while select mode is on regardless of current selection
          size, so a rep can start a batch from zero without hand-ticking
          every card first. */}
      {selectMode && (
        <Group gap="sm" mb="sm" p="xs" style={{ border: '1px solid var(--gds-border-card)', backgroundColor: 'var(--gds-bg-card)', borderRadius: 6 }} role="region" aria-label="Bulk selection">
          <Text size="xs" c="dimmed">Select all in:</Text>
          <Select
            size="xs"
            data={columnDefs.map((c) => ({ value: c.key, label: c.label }))}
            value={selectAllColumn}
            onChange={(v) => setSelectAllColumn(v as KanbanColumn | null)}
            placeholder="Choose a column"
            aria-label="Column to select all leads in"
            style={{ width: 160 }}
          />
          <Button size="xs" variant="default" onClick={handleSelectAllInColumn} disabled={!selectAllColumn}>
            Select all loaded
          </Button>
          {selectedIds.size > 0 && (
            <Button size="xs" variant="subtle" color="gray" onClick={() => { setSelectedIds(new Set()); setSelectedColumn(null); setFieldEditOpen(false); setAssignOpen(false) }}>
              Clear selection
            </Button>
          )}
        </Group>
      )}

      {selectMode && selectedIds.size > 0 && (
        <Group
          gap="sm"
          mb="sm"
          p="xs"
          style={{ border: '1px solid var(--gds-border-card)', backgroundColor: 'var(--gds-bg-card)', borderRadius: 6 }}
          role="region"
          aria-label="Bulk actions"
        >
          <Text size="sm" fw={600}>
            {selectedIds.size} selected in {selectedColumn}
          </Text>
          <Button size="xs" color="teal" variant="light" onClick={() => runBulkAction('PIN')} loading={bulkRunning}>
            Pin selected
          </Button>
          <Button size="xs" variant="light" onClick={() => { setFieldEditOpen((v) => !v); setAssignOpen(false) }} loading={bulkRunning}>
            Edit field…
          </Button>
          <Button size="xs" variant="light" onClick={() => { setAssignOpen((v) => !v); setFieldEditOpen(false) }} loading={bulkRunning}>
            Reassign…
          </Button>
        </Group>
      )}

      {selectMode && selectedIds.size > 0 && fieldEditOpen && (
        <Group gap="xs" mb="sm" p="xs" style={{ border: '1px solid var(--gds-border-card)', backgroundColor: 'var(--gds-bg-card)', borderRadius: 6 }} role="region" aria-label="Bulk field edit">
          <Select
            size="xs"
            label="Field"
            data={[{ value: 'tags', label: 'Tags' }, { value: 'qualityStatus', label: 'Quality status' }]}
            value={fieldEditField}
            onChange={(v) => setFieldEditField((v as 'tags' | 'qualityStatus') || 'tags')}
            aria-label="Field to bulk edit"
            style={{ width: 140 }}
          />
          {fieldEditField === 'tags' ? (
            <>
              <Select
                size="xs"
                label="Action"
                data={[{ value: 'add', label: 'Add tag' }, { value: 'remove', label: 'Remove tag' }]}
                value={fieldEditTagOp}
                onChange={(v) => setFieldEditTagOp((v as 'add' | 'remove') || 'add')}
                aria-label="Add or remove the tag"
                style={{ width: 130 }}
              />
              <TextInput
                size="xs"
                label="Tag"
                placeholder="e.g. hot-lead"
                value={fieldEditTagValue}
                onChange={(e) => setFieldEditTagValue(e?.target?.value ?? e?.currentTarget?.value ?? '')}
                aria-label="Tag value"
              />
            </>
          ) : (
            <Select
              size="xs"
              label="New quality status"
              data={[{ value: 'DRAFT', label: 'Draft' }, { value: 'CHECKED', label: 'Checked' }, { value: 'VERIFIED', label: 'Verified' }]}
              value={fieldEditQualityStatus}
              onChange={setFieldEditQualityStatus}
              aria-label="New quality status"
              style={{ width: 160 }}
            />
          )}
          <Button
            size="xs"
            color="blue"
            loading={bulkRunning}
            disabled={fieldEditField === 'tags' ? !fieldEditTagValue.trim() : !fieldEditQualityStatus}
            onClick={() => runBulkAction('FIELD_EDIT', fieldEditField === 'tags'
              ? { field: 'tags', op: fieldEditTagOp, value: fieldEditTagValue.trim() }
              : { field: 'qualityStatus', value: fieldEditQualityStatus })}
          >
            Apply to {selectedIds.size} lead{selectedIds.size === 1 ? '' : 's'}
          </Button>
        </Group>
      )}

      {selectMode && selectedIds.size > 0 && assignOpen && (
        <Group gap="xs" mb="sm" p="xs" style={{ border: '1px solid var(--gds-border-card)', backgroundColor: 'var(--gds-bg-card)', borderRadius: 6 }} role="region" aria-label="Bulk reassign">
          <Select
            size="xs"
            label="Assign to"
            placeholder="Choose a user"
            data={assignableUsers.map((u) => ({ value: u.ssoUserId, label: u.name ? `${u.name} (${u.email})` : u.email }))}
            value={assignTarget}
            onChange={setAssignTarget}
            aria-label="User to bulk-assign the selection to"
            style={{ minWidth: 220 }}
            searchable
          />
          <Button
            size="xs"
            color="blue"
            loading={bulkRunning}
            disabled={!assignTarget}
            onClick={() => runBulkAction('ASSIGN', { assignedTo: assignTarget })}
          >
            Assign {selectedIds.size} lead{selectedIds.size === 1 ? '' : 's'}
          </Button>
        </Group>
      )}

      {/* Real, server-verified undo (issue #203) — a countdown to a real
          server-enforced expiry, not a cosmetic timer; role="status"
          aria-live="polite" so a screen-reader user hears the window and
          its expiry, not just sees it. */}
      {undoInfo && (
        <Group gap="sm" mb="sm" p="xs" style={{ border: '1px solid var(--gds-border-card)', backgroundColor: 'var(--gds-bg-card)', borderRadius: 6 }} role="status" aria-live="polite">
          <Text size="sm">
            {undoSecondsLeft > 0
              ? `You can undo this — expires in ${undoSecondsLeft}s.`
              : 'Undo window expired.'}
          </Text>
          <Button size="xs" variant="light" loading={undoRunning} disabled={undoSecondsLeft <= 0} onClick={runUndo}>
            Undo
          </Button>
          <Button size="xs" variant="subtle" color="gray" onClick={() => setUndoInfo(null)}>
            Dismiss
          </Button>
          {undoInfo.notReversible.length > 0 && (
            <Text size="xs" c="dimmed" w="100%">
              {undoInfo.notReversible.length} of these had an active outreach cadence — Undo will restore their column but will not resume that cadence.
            </Text>
          )}
        </Group>
      )}

      <div ref={boardWrapperRef} data-tour={TOUR_SELECTOR.kanbanBoard}>
        <ErrorBoundary
          fallback={
            <Box p="md" role="alert">
              <Text size="sm" c="red">
                The kanban board couldn&apos;t be rendered. Try refreshing the page.
              </Text>
            </Box>
          }
        >
          <ReliableKanbanBoard
            columns={columns}
            onMoveItem={handleMoveItem}
            renderItem={renderItem}
            emptyColumnLabel={bootstrapped ? 'No leads' : 'Loading…'}
            collapsedColumnIds={collapsedColumnIds}
            onCollapsedChange={handleCollapsedChange}
            enableDrag={dragEnabled}
            // Zone-based header horizontal wheel panning + non-passive vertical
            // scroll passthrough over cards/body.
            columnPanZone="header"
            columnWidth={320}
          />
        </ErrorBoundary>
      </div>
    </>
  )
}
