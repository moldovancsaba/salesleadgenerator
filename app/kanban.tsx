'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Box, Text, Group } from '@mantine/core';
import { IconLoader } from '@tabler/icons-react';
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
  mode?: string;
  forecast?: Record<string, ColumnForecast> | null;
  forecastCurrency?: 'USD' | 'EUR';
};

// Long-press threshold before a touch/pointer-down turns into a drag, so
// normal scrolling and tap-to-preview keep working. Movement past
// DRAG_ARM_MOVE_TOLERANCE before the timer fires cancels arming (treated
// as a scroll gesture instead).
const DRAG_ARM_DELAY_MS = 200;
const DRAG_ARM_MOVE_TOLERANCE = 8;

type DragState = {
  leadId: string;
  entityName: string;
  fromColumn: KanbanColumn;
  pointerId: number;
  x: number;
  y: number;
  overColumn: KanbanColumn | null;
};

export function KanbanBoard({ brand, tenantId = 'default', onOpenLead, mode: modeProp, forecast, forecastCurrency = 'USD' }: BoardProps) {
  const mode = modeProp || 'desktop';

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

  const [dragState, setDragState] = useState<DragState | null>(null)
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const armStartRef = useRef<{ x: number; y: number } | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  dragStateRef.current = dragState

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
    const initPromises = COLUMNS.map((col) => loadColumn(col.key))
    Promise.all(initPromises)
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

  const clearDrag = useCallback(() => {
    clearTimeout(armTimerRef.current)
    armStartRef.current = null
    setDragState(null)
  }, [])

  const handlePointerMoveWhileDragging = useCallback((event: PointerEvent) => {
    const current = dragStateRef.current
    if (!current || event.pointerId !== current.pointerId) return
    const target = document.elementFromPoint(event.clientX, event.clientY)
    const columnEl = target instanceof Element ? target.closest('[data-column]') : null
    const overColumn = (columnEl?.getAttribute('data-column') as KanbanColumn | null) || null
    setDragState({ ...current, x: event.clientX, y: event.clientY, overColumn })
  }, [])

  const handlePointerUpWhileDragging = useCallback((event: PointerEvent) => {
    const current = dragStateRef.current
    if (!current || event.pointerId !== current.pointerId) return
    if (current.overColumn && current.overColumn !== current.fromColumn) {
      handleMove(current.leadId, current.fromColumn, current.overColumn)
    }
    clearDrag()
  }, [handleMove, clearDrag])

  useEffect(() => {
    if (!dragState) return
    window.addEventListener('pointermove', handlePointerMoveWhileDragging)
    window.addEventListener('pointerup', handlePointerUpWhileDragging)
    window.addEventListener('pointercancel', clearDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMoveWhileDragging)
      window.removeEventListener('pointerup', handlePointerUpWhileDragging)
      window.removeEventListener('pointercancel', clearDrag)
    }
  }, [dragState, handlePointerMoveWhileDragging, handlePointerUpWhileDragging, clearDrag])

  const handleCardPointerDown = useCallback((event: React.PointerEvent, lead: Lead, fromColumn: KanbanColumn) => {
    if (event.button !== undefined && event.button !== 0) return
    const startX = event.clientX
    const startY = event.clientY
    const pointerId = event.pointerId
    armStartRef.current = { x: startX, y: startY }

    clearTimeout(armTimerRef.current)
    armTimerRef.current = setTimeout(() => {
      armStartRef.current = null
      setDragState({
        leadId: lead._id,
        entityName: lead.entity_name,
        fromColumn,
        pointerId,
        x: startX,
        y: startY,
        overColumn: fromColumn,
      })
    }, DRAG_ARM_DELAY_MS)

    const cancelIfMoved = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return
      const start = armStartRef.current
      if (!start) return
      const dx = Math.abs(moveEvent.clientX - start.x)
      const dy = Math.abs(moveEvent.clientY - start.y)
      if (dx > DRAG_ARM_MOVE_TOLERANCE || dy > DRAG_ARM_MOVE_TOLERANCE) {
        clearTimeout(armTimerRef.current)
        armStartRef.current = null
      }
    }
    // A quick tap-and-release (tapping a card or its Preview button, the
    // common case) must cancel the still-pending arm timer here — otherwise
    // it fires ~200ms after the finger has already lifted, with no future
    // pointerup left to arrive and clear it via handlePointerUpWhileDragging,
    // leaving the ghost label and the dimmed source card stuck on screen
    // until an unrelated drag on the same pointerId happens to clear it.
    const cancelArm = (releaseEvent: PointerEvent) => {
      if (releaseEvent.pointerId !== pointerId) return
      clearTimeout(armTimerRef.current)
      armStartRef.current = null
      cleanupArmWatchers()
    }
    const cleanupArmWatchers = () => {
      window.removeEventListener('pointermove', cancelIfMoved)
      window.removeEventListener('pointerup', cancelArm)
      window.removeEventListener('pointercancel', cancelArm)
    }
    window.addEventListener('pointermove', cancelIfMoved)
    window.addEventListener('pointerup', cancelArm)
    window.addEventListener('pointercancel', cancelArm)
  }, [])

  const columnWidth = mode === 'mobile' ? '85vw' : '18rem'

  const formatForecast = useCallback((value: number) => {
    const symbol = forecastCurrency === 'EUR' ? '€' : '$'
    return `${symbol}${Math.round(value).toLocaleString()}`
  }, [forecastCurrency])

  const boardContent = useMemo(() => COLUMNS.map((col) => {
    const colState = columnStates[col.key]
    const colLeads = colState.leads
    const colForecast = forecast?.[col.key]
    const isDropTarget = dragState?.overColumn === col.key && dragState.fromColumn !== col.key

    return (
      <Box
        key={col.key}
        data-column={col.key}
        className={`kanban-column kanban-column--${mode}`}
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: isDropTarget ? 'var(--mantine-color-blue-0)' : 'gray-0',
          borderRadius: 'md',
          border: isDropTarget ? '2px dashed var(--mantine-color-blue-5)' : '1px solid gray-3',
          minHeight: '10rem',
          width: columnWidth,
        }}
      >
        <Box p="xs" style={{ borderBottom: '1px solid gray-2' }}>
          <Group justify="space-between" align="center">
            <Group gap="xs">
              <Text size="sm" fw={600}>{col.label}</Text>
              <Text size="xs" c="dimmed">({typeof colState.count === 'number' ? colState.count.toLocaleString() : colLeads.length})</Text>
            </Group>
          </Group>
          {colForecast && colForecast.rawRevenue > 0 && (
            <Text size="xs" c="dimmed">
              {formatForecast(colForecast.weightedRevenue)} weighted ({Math.round(colForecast.probability * 100)}% of {formatForecast(colForecast.rawRevenue)})
            </Text>
          )}
        </Box>

        <Box style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: 0 }}>
          {colLeads.map((lead) => (
            <div
              key={lead._id}
              onPointerDown={(e) => handleCardPointerDown(e, lead, col.key)}
              style={{
                opacity: dragState?.leadId === lead._id ? 0.4 : 1,
                touchAction: dragState?.leadId === lead._id ? 'none' : undefined,
              }}
            >
              <LeadCard lead={lead} onOpen={() => onOpenLead(lead)} />
            </div>
          ))}
          {colLeads.length === 0 && !colState.loading && (
            <Text size="xs" c="dimmed" ta="center" py="md">No leads</Text>
          )}
          {colState.loading && (
            <Group justify="center" py="md">
              <IconLoader size={20} />
            </Group>
          )}
          {colState.hasMore && !colState.loading && (
            <ColumnSentinel brand={brand} tenantId={tenantId} columnKey={col.key} onLoadMore={() => loadColumn(col.key, colState.cursor)} />
          )}
        </Box>
      </Box>
    )
  }), [columnStates, brand, tenantId, onOpenLead, mode, columnWidth, loadColumn, dragState, forecast, formatForecast, handleCardPointerDown])

  return (
    <Box>
      <Box
        className={`kanban-board kanban-board--${mode}`}
        style={{ flex: '1 1 auto', height: 'auto', minHeight: 0, display: 'flex', gap: '0.75rem', overflowX: 'auto', padding: '0.5rem' }}
      >
        {boardContent}
      </Box>
      {dragState && (
        <Box
          style={{
            position: 'fixed',
            left: dragState.x + 12,
            top: dragState.y + 12,
            pointerEvents: 'none',
            zIndex: 1000,
            backgroundColor: 'var(--mantine-color-body)',
            border: '1px solid var(--mantine-color-blue-5)',
            borderRadius: 'var(--mantine-radius-md)',
            padding: '0.5rem 0.75rem',
            boxShadow: 'var(--mantine-shadow-md)',
            maxWidth: '14rem',
          }}
        >
          <Text size="sm" fw={600} lineClamp={1}>{dragState.entityName}</Text>
        </Box>
      )}
    </Box>
  )
}

// Small sentinel component that uses IntersectionObserver to trigger column load
function ColumnSentinel({ brand, tenantId, columnKey, onLoadMore }: { brand: string; tenantId: string; columnKey: string; onLoadMore: () => void }) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          observer.disconnect()
          onLoadMore()
        }
      },
      { rootMargin: '200px' }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [onLoadMore])

  return (
    <Box
      ref={sentinelRef}
      style={{ height: '60px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <Text size="xs" c="dimmed">Loading more…</Text>
    </Box>
  )
}
