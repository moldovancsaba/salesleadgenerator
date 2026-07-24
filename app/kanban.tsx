'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Box, Group, Loader } from '@mantine/core';
import { KanbanBoard as GdsKanbanBoard } from '@sovereignsquad/gds-core/client';
import type { KanbanItem as GdsKanbanItem, KanbanColumnData as GdsKanbanColumnData } from '@sovereignsquad/gds-core/client';
import type { Lead, KanbanColumn } from './types';
import { LeadCard } from './card';
import { COLUMNS } from './constants';

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
  forecastCurrency?: 'USD' | 'EUR';
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

export function KanbanBoard({ brand, tenantId = 'default', onOpenLead, forecast, forecastCurrency = 'USD' }: BoardProps) {
  const [columnStates, setColumnStates] = useState<Record<KanbanColumn, ColumnState>>(() => {
    const init: Record<KanbanColumn, ColumnState> = {
      DISCOVERED: { leads: [], count: 0, hasMore: false, cursor: null, loading: false },
      QUALIFIED: { leads: [], count: 0, hasMore: false, cursor: null, loading: false },
      ENGAGED: { leads: [], count: 0, hasMore: false, cursor: null, loading: false },
      PROPOSAL: { leads: [], count: 0, hasMore: false, cursor: null, loading: false },
      WON: { leads: [], count: 0, hasMore: false, cursor: null, loading: false },
      LOST: { leads: [], count: 0, hasMore: false, cursor: null, loading: false },
    }
    return init
  })
  const [bootstrapped, setBootstrapped] = useState(false)

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
  }, [brand, tenantId])

  // Bootstrap all columns with their first chunk
  useEffect(() => {
    setBootstrapped(false)
    Promise.all(COLUMNS.map((col) => loadColumn(col.key))).then(() => setBootstrapped(true))
  }, [brand, tenantId, loadColumn])

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

      if (!res.ok) throw new Error(`Move failed: ${res.status}`)
      await Promise.all([loadColumn(toColumn), loadColumn(fromColumn)])
    } catch (err) {
      console.error('Column move error:', err)
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

  const formatForecast = useCallback((value: number) => {
    const symbol = forecastCurrency === 'EUR' ? '€' : '$'
    return `${symbol}${Math.round(value).toLocaleString()}`
  }, [forecastCurrency])

  // GDS's KanbanColumnData.title is a plain string (not a ReactNode), so the
  // per-column forecast — a two-line, differently-styled subtitle in the
  // previous hand-rolled header — is encoded into one line here instead.
  // Disclosed trade-off of adopting the governed pattern's fixed API.
  const columns: LeadKanbanColumn[] = useMemo(() => COLUMNS.map((col) => {
    const colState = columnStates[col.key]
    const colForecast = forecast?.[col.key]
    const countLabel = typeof colState.count === 'number' ? colState.count.toLocaleString() : colState.leads.length
    const forecastLabel = colForecast && colForecast.rawRevenue > 0
      ? ` · ${formatForecast(colForecast.weightedRevenue)}`
      : ''

    return {
      id: col.key,
      title: `${col.label} (${countLabel})${forecastLabel}`,
      items: colState.leads.map((lead) => ({
        id: lead._id,
        title: lead.entity_name,
        ariaLabel: lead.entity_name,
        lead,
      })),
    }
  }), [columnStates, forecast, formatForecast])

  // GDS's KanbanItem/KanbanColumnData are fixed, non-generic interfaces — the
  // real renderItem prop is checked contravariantly against exactly that
  // shape, so the callback's own parameter types must match it, not our
  // richer LeadKanbanItem/LeadKanbanColumn (which we know these objects
  // actually are at runtime, since we built them in `columns` above).
  const renderItem = useCallback((item: GdsKanbanItem, column: GdsKanbanColumnData) => {
    const leadItem = item as LeadKanbanItem
    const colState = columnStates[column.id as KanbanColumn]
    const isLast = column.items[column.items.length - 1]?.id === item.id
    return (
      <>
        <LeadCard lead={leadItem.lead} onOpen={() => onOpenLead(leadItem.lead)} />
        {isLast && colState.hasMore && !colState.loading && (
          <LoadMoreSentinel onLoadMore={() => loadColumn(column.id as KanbanColumn, colState.cursor)} />
        )}
      </>
    )
  }, [columnStates, onOpenLead, loadColumn])

  // enableDrag deliberately omitted (default false): it renders a
  // drag-handle icon per card and activates GDS's real @dnd-kit
  // DndContext/sensors — the one genuinely new code path in this whole GDS
  // 3.11.x bump that had never actually executed in production before a
  // client-side exception was reported live. The keyboard/tap-accessible
  // "Move to column" menu (unconditional, not gated by enableDrag) still
  // provides full move functionality without it.
  return (
    <GdsKanbanBoard
      columns={columns}
      onMoveItem={handleMoveItem}
      renderItem={renderItem}
      emptyColumnLabel={bootstrapped ? 'No leads' : 'Loading…'}
    />
  )
}
