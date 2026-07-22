'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Box, Text, Group, ActionIcon, Button } from '@mantine/core';
import { IconChevronDown, IconChevronRight, IconArrowsSort, IconLoader } from '@tabler/icons-react';
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

type BoardProps = {
  brand: string;
  tenantId?: string;
  onOpenLead: (lead: Lead) => void;
  mode?: string;
};

export function KanbanBoard({ brand, tenantId = 'default', onOpenLead, mode: modeProp }: BoardProps) {
  const [isMobile, setIsMobile] = useState(false);
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(max-width: 767px)')
    setIsMobile(mql.matches)
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
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

  const handleMove = useCallback(async (leadId: string, column: KanbanColumn) => {
    try {
      const url = new URL('/api/leads', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)

      const res = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, action: 'COLUMN_MOVE', kanbanColumn: column, sortOrder: Date.now() }),
      })

      if (!res.ok) throw new Error(`Move failed: ${res.status}`)
      await loadColumn(column)
    } catch (err) {
      console.error('Column move error:', err)
    }
  }, [brand, tenantId, loadColumn])

  const boardContent = useMemo(() => COLUMNS.map((col) => {
    const colState = columnStates[col.key]
    const colLeads = colState.leads

    return (
      <Box
        key={col.key}
        data-column={col.key}
        className={`kanban-column kanban-column--${mode}`}
        style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', backgroundColor: 'gray-0', borderRadius: 'md', border: '1px solid gray-3', minHeight: '10rem', width: columnWidth }}
      >
        <Group justify="space-between" align="center" p="xs" style={{ borderBottom: '1px solid gray-2' }}>
          <Group gap="xs">
            <Text size="sm" fw={600}>{col.label}</Text>
            <Text size="xs" c="dimmed">({typeof colState.count === 'number' ? colState.count.toLocaleString() : colLeads.length})</Text>
          </Group>
        </Group>

        <Box style={{ flex: 1, overflowY: 'auto', padding: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', minHeight: 0 }}>
          {colLeads.map((lead) => (
            <LeadCard key={lead._id} lead={lead} onOpen={() => onOpenLead(lead)} />
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
  }), [columnStates, brand, tenantId, onOpenLead, mode, loadColumn])

  return (
    <Box>
      <Box
        className={`kanban-board kanban-board--${mode}`}
        style={{ flex: '1 1 auto', height: 'auto', minHeight: 0, display: 'flex', gap: '0.75rem', overflowX: 'auto', padding: '0.5rem' }}
      >
        {boardContent}
      </Box>
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
