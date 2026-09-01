'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Box, Group, Loader, Button, Checkbox, Text, Menu } from '@mantine/core';
import { IconArchive, IconArrowBackUp, IconChevronDown } from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';
import { KanbanBoard as GdsKanbanBoard } from '@sovereignsquad/gds-core/client';
import type { KanbanItem as GdsKanbanItem, KanbanColumnData as GdsKanbanColumnData } from '@sovereignsquad/gds-core/client';
import type { Lead, KanbanColumn } from './types';
import type { CurrencyCode } from './lib/brand';
import { LeadCard } from './card';
import { COLUMNS } from './constants';
import { computeStaleness, DEFAULT_STALE_THRESHOLDS, type KanbanColumn as StaleDealColumn } from '../lib/stale-deal';
import { getNextStepNudge } from '../lib/next-step-nudge';
import type { LeadFilter } from '../lib/saved-filters';
import { isVerticalScrollIntent } from '../lib/desktop-scroll-passthrough';
import { TOUR_SELECTOR } from './lib/tour/selectors';

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
};

type LeadKanbanItem = {
  id: string;
  title: string;
  ariaLabel: string;
  lead: Lead;
};

type LeadKanbanColumn = {
  id: string;
  title: string;
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        observer.disconnect();
        onLoadMore();
      }
    }, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [onLoadMore]);

  return (
    <Box ref={ref} pt="xs" mt="xs" style={{ borderTop: '1px solid var(--mantine-color-gray-3)' }}>
      <Group justify="center" py="xs">
        <Loader size="xs" />
      </Group>
    </Box>
  );
}

export function KanbanBoard({ brand, tenantId = 'default', onOpenLead, forecast, forecastCurrency = 'USD', filter, selectMode = false, columnDefs = COLUMNS }: BoardProps) {
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
  const [bootstrapped, setBootstrapped] = useState(false)

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

  // Desktop trackpad "natural scroll" fix — see lib/desktop-scroll-passthrough.ts
  // for the full explanation. Attached as a real (non-React-synthetic)
  // listener via addEventListener, not onWheel: React attaches its own root
  // wheel listeners as passive for scroll-performance reasons, so
  // event.preventDefault() inside a React onWheel handler is silently a
  // no-op — only a manually-added { passive: false } listener can actually
  // cancel the browser's native scroll here. Desktop-only by design
  // (matchMedia('(pointer: fine)')): on a touchscreen, GDS renders a
  // stacked layout with no horizontal ScrollArea to fight, and native touch
  // panning must never be intercepted by this.
  const boardWrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = boardWrapperRef.current
    if (!el || typeof window === 'undefined' || !window.matchMedia('(pointer: fine)').matches) return

    function handleWheel(event: WheelEvent) {
      if (!isVerticalScrollIntent(event.deltaX, event.deltaY)) return
      event.preventDefault()
      window.scrollBy(0, event.deltaY)
    }

    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  // Fetched once per board mount, not per card — stale/critical badges are
  // computed client-side in renderItem from data already in memory, so this
  // is the only network call staleness detection needs. Falls back to
  // DEFAULT_STALE_THRESHOLDS on fetch failure, matching the pipeline-weights
  // GET fallback pattern in app/api/settings/route.ts.
  const [staleThresholds, setStaleThresholds] = useState<Record<StaleDealColumn, number>>(DEFAULT_STALE_THRESHOLDS)

  useEffect(() => {
    let cancelled = false
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Settings load failed: ${res.status}`))))
      .then((data) => {
        if (!cancelled && data.thresholds) setStaleThresholds(data.thresholds)
      })
      .catch((err) => {
        console.error('Stale thresholds load error:', err)
      })
    return () => { cancelled = true }
  }, [])

  const loadColumn = useCallback(async (colKey: KanbanColumn, cursor?: string | null) => {
    setColumnStates((prev) => ({
      ...prev,
      [colKey]: { ...prev[colKey], loading: true },
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

      const res = await fetch(url.toString())
      if (!res.ok) throw new Error(`Column load failed: ${res.status}`)

      const data = await res.json()

      setColumnStates((prev) => {
        const current = prev[colKey]
        const newLeads = cursor
          ? [...current.leads, ...data.leads]
          : [...data.leads]

        return {
          ...prev,
          [colKey]: {
            leads: newLeads,
            count: data.count,
            hasMore: data.hasMore,
            cursor: data.nextCursor || null,
            loading: false,
          },
        }
      })
    } catch (err) {
      console.error(`Column ${colKey} load error:`, err)
      setColumnStates((prev) => ({
        ...prev,
        [colKey]: { ...prev[colKey], loading: false },
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
    // Optimistic UI: drop the card from its source column immediately so the
    // move feels instant; reload both columns afterward to reconcile with
    // the server (sortOrder, dedup, etc.)
    setColumnStates((prev) => ({
      ...prev,
      [fromColumn]: {
        ...prev[fromColumn],
        leads: prev[fromColumn].leads.filter((l) => l._id !== leadId),
        count: Math.max(0, prev[fromColumn].count - 1),
      },
    }))

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
      await Promise.all([loadColumn(toColumn), loadColumn(fromColumn)])
    } catch (err) {
      console.error('Column move error:', err)
      // issue #91: this previously reverted the optimistic removal with zero
      // visible feedback — a real move failure (network, validation, server
      // error) looked identical to "nothing happened," indistinguishable
      // from the move menu itself not working at all. Every other action in
      // this app (see app/detail.tsx's handleAccept/handleDecline/etc.)
      // already surfaces failures via showNotification; this brings column
      // moves in line rather than leaving them the one silent exception.
      showNotification({
        message: err instanceof Error ? err.message : 'Failed to move lead to that column',
        color: 'red',
        autoClose: 5000,
      })
      // Reconcile with the server on failure too, so the optimistic removal
      // doesn't leave the UI out of sync with what's actually persisted.
      await loadColumn(fromColumn)
    }
  }, [brand, tenantId, loadColumn])

  // GDS's drag (SortableContext) allows same-column reordering as well as
  // cross-column moves. Our API has no concept of an arbitrary drop
  // position — PATCH only sets kanbanColumn + sortOrder = Date.now() (always
  // "top of stack") — and DISCOVERED/QUALIFIED ignore sortOrder entirely
  // (ICE-score sorted). A same-column drag is a no-op, matching the old
  // pointer-events implementation, which only ever detected cross-column
  // drops in the first place.
  const handleMoveItem = useCallback((itemId: string, fromColumnId: string, toColumnId: string) => {
    if (fromColumnId === toColumnId) return
    handleMove(itemId, fromColumnId as KanbanColumn, toColumnId as KanbanColumn)
  }, [handleMove])

  // Issue #70: bulk DECLINE/PIN. `selectMode` itself is a prop now (the
  // toggle button lives one level up, sharing a row with the Filters
  // trigger) — this resets the in-board selection whenever the parent
  // flips it off, so leaving select mode always clears state cleanly.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [selectedColumn, setSelectedColumn] = useState<KanbanColumn | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)

  useEffect(() => {
    if (!selectMode) {
      setSelectedIds(new Set())
      setSelectedColumn(null)
    }
  }, [selectMode])

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

  const runBulkAction = useCallback(async (action: 'DECLINE' | 'PIN') => {
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
          payload: action === 'DECLINE' ? { declineReason: 'OTHER' } : {},
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

      showNotification({
        message: failed === 0
          ? `${succeeded} lead${succeeded === 1 ? '' : 's'} ${action === 'DECLINE' ? 'declined' : 'pinned'}.`
          : `${succeeded} of ${results.length} ${action === 'DECLINE' ? 'declined' : 'pinned'} — ${failed} blocked${firstError ? `: ${firstError}` : ''}.`,
        color: failed === 0 ? 'teal' : 'yellow',
        autoClose: failed === 0 ? 4000 : 8000,
      })

      await loadColumn(selectedColumn)
      if (action === 'PIN') await loadColumn('ENGAGED')
      setSelectedIds(new Set())
      setSelectedColumn(null)
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
    const colState = columnStates[col.key]
    const colForecast = forecast?.[col.key]
    const forecastLabel = colForecast && colForecast.rawRevenue > 0
      ? ` · ${formatForecast(colForecast.weightedRevenue)}`
      : ''

    return {
      id: col.key,
      title: `${col.label}${forecastLabel}`,
      totalCount: colState.count,
      items: colState.leads.map((lead) => ({
        id: lead._id,
        title: lead.entity_name,
        ariaLabel: lead.entity_name,
        lead,
      })),
    }
  }), [columnStates, forecast, formatForecast, columnDefs])

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
    const colState = columnStates[column.id as KanbanColumn]
    const isLast = column.items[column.items.length - 1]?.id === item.id
    const now = new Date()
    const staleness = computeStaleness(
      { kanbanColumn: leadItem.lead.kanbanColumn as StaleDealColumn, updatedAt: leadItem.lead.updatedAt },
      staleThresholds,
      now
    )
    const nudge = getNextStepNudge(
      { kanbanColumn: leadItem.lead.kanbanColumn, createdAt: leadItem.lead.createdAt, contacts: leadItem.lead.contacts },
      staleness,
      now
    )
    const tourTarget = column.id === firstNonEmptyColumnId && column.items[0]?.id === item.id
    return (
      <>
        {selectMode && (
          <Checkbox
            size="sm"
            mb={4}
            aria-label={`Select ${leadItem.lead.entity_name} for bulk action`}
            checked={selectedIds.has(leadItem.lead._id)}
            onChange={() => toggleSelected(leadItem.lead._id, column.id as KanbanColumn)}
            disabled={Boolean(selectedColumn) && selectedColumn !== (column.id as KanbanColumn) && !selectedIds.has(leadItem.lead._id)}
          />
        )}
        <LeadCard
          lead={leadItem.lead}
          onOpen={() => onOpenLead(leadItem.lead)}
          staleness={staleness}
          nudge={nudge}
          winProbability={forecast?.[column.id]?.probability ?? null}
          tourTarget={tourTarget}
        />
        {/* Issue #126 — deliberately not GDS's own per-card "Move to
            column" dropdown: that widget's targets are exactly whatever
            this board's own `columns` prop contains, so a one-column
            Backlog board has no other targets to offer there, and adding
            Backlog to the 6-column Pipeline board's own `columns` would
            make it a 7th *visible* column, which the whole point of this
            feature is to avoid. Both directions are separate, explicit
            actions instead — derived from which column this card is
            currently rendered in, not a separate mode flag on the board. */}
        {column.id === 'BACKLOG' ? (
          <Menu shadow="md" position="bottom-start">
            <Menu.Target>
              <Button size="xs" variant="light" mt={4} leftSection={<IconArrowBackUp size={12} />} rightSection={<IconChevronDown size={12} />}>
                Move to Pipeline
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {COLUMNS.map((col) => (
                <Menu.Item key={col.key} onClick={() => handleMove(leadItem.lead._id, 'BACKLOG', col.key)}>
                  {col.label}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        ) : (
          <Button
            size="xs"
            variant="subtle"
            color="gray"
            mt={4}
            leftSection={<IconArchive size={12} />}
            onClick={() => handleMove(leadItem.lead._id, column.id as KanbanColumn, 'BACKLOG')}
          >
            Move to Backlog
          </Button>
        )}
        {isLast && colState.hasMore && !colState.loading && (
          <LoadMoreSentinel onLoadMore={() => loadColumn(column.id as KanbanColumn, colState.cursor)} />
        )}
      </>
    )
  }, [columnStates, onOpenLead, loadColumn, staleThresholds, selectMode, selectedIds, selectedColumn, toggleSelected, forecast, handleMove, firstNonEmptyColumnId])

  // enableDrag deliberately omitted (default false): it renders a
  // drag-handle icon per card and activates GDS's real @dnd-kit
  // DndContext/sensors — the one genuinely new code path in this whole GDS
  // 3.11.x bump that had never actually executed in production before a
  // client-side exception was reported live. The keyboard/tap-accessible
  // "Move to column" menu (unconditional, not gated by enableDrag) still
  // provides full move functionality without it.
  return (
    <>
      {selectMode && selectedIds.size > 0 && (
        <Group
          gap="sm"
          mb="sm"
          p="xs"
          style={{ border: '1px solid var(--mantine-color-gray-4)', borderRadius: 6 }}
          role="region"
          aria-label="Bulk actions"
        >
          <Text size="sm" fw={600}>
            {selectedIds.size} selected in {selectedColumn}
          </Text>
          <Button size="xs" color="red" variant="light" onClick={() => runBulkAction('DECLINE')} loading={bulkRunning}>
            Decline selected
          </Button>
          <Button size="xs" color="teal" variant="light" onClick={() => runBulkAction('PIN')} loading={bulkRunning}>
            Pin selected
          </Button>
        </Group>
      )}

      <div ref={boardWrapperRef} data-tour={TOUR_SELECTOR.kanbanBoard}>
        <GdsKanbanBoard
          columns={columns}
          onMoveItem={handleMoveItem}
          renderItem={renderItem}
          emptyColumnLabel={bootstrapped ? 'No leads' : 'Loading…'}
          collapsible
          collapsedColumnIds={collapsedColumnIds}
          onCollapsedChange={handleCollapsedChange}
        />
      </div>
    </>
  )
}
