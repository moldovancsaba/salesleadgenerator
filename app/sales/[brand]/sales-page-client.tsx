'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Group, Text, Button, Paper, Select, Loader, Container, Box } from '@mantine/core';
import { SearchableSelect } from '@sovereignsquad/gds-core/client';
import type { Lead } from '@/app/types';
import { KanbanBoard } from '@/app/kanban';
import { LeadDetailModal } from '@/app/detail';
import { TableView } from '@/app/table';
import { SearchLearningPanel } from '@/app/search-learning';
import { MetricsPanel } from '@/app/metrics';

type ViewMode = 'kanban' | 'table' | 'metrics' | 'search';

const MODE_KEY = 'saleslayoutMode';

const VIEW_OPTIONS = [
  { value: 'kanban', label: 'Kanban' },
  { value: 'table', label: 'Table' },
  { value: 'metrics', label: 'Metrics' },
  { value: 'search', label: 'Search Learning' },
];

type Props = {
  brand: string;
};

export function SalesPageClient({ brand }: Props) {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [view, setView] = useState<ViewMode>('kanban');
  const [sortKey, setSortKey] = useState<'ice' | 'name'>('ice');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isMobile, setIsMobile] = useState(true);
  const [boardMeta, setBoardMeta] = useState<{
    brand: string; label: string; totalLeads: number;
    columnCounts: Record<string, number>; regionCounts: Record<string, number>;
    forecast: any; updatedAt: string;
  } | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [tableLeads, setTableLeads] = useState<Lead[]>([])
  const [tableLoading, setTableLoading] = useState(true)
  const [searchSelection, setSearchSelection] = useState<string | null>(null)
  const searchResultsRef = useRef<Record<string, Lead>>({})

  // Load board metadata (header, counts, forecast) from DB
  useEffect(() => {
    let cancelled = false
    setMetaLoading(true)
    fetch(`/api/boards/${encodeURIComponent(brand)}?tenantId=default`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled && !data.error) setBoardMeta(data)
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setMetaLoading(false) })
    return () => { cancelled = true }
  }, [brand])

  // Load table data server-side when needed
  useEffect(() => {
    if (view !== 'table') return
    let cancelled = false
    setTableLoading(true)
    fetch(`/api/leads?brand=${encodeURIComponent(brand)}&tenantId=default&limit=5000`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`${r.status}`)))
      .then(data => {
        if (!cancelled) setTableLeads((data.leads || []) as Lead[])
      })
      .catch(console.error)
      .finally(() => { if (!cancelled) setTableLoading(false) })
    return () => { cancelled = true }
  }, [view, brand])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mql = window.matchMedia('(max-width: 1279px)')
    setIsMobile(mql.matches)
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    localStorage.setItem(MODE_KEY, isMobile ? 'mobile' : 'desktop')
  }, [isMobile])

  const handleAction = useCallback(async (leadId: string, action: string, payload?: any) => {
    try {
      const url = new URL('/api/leads', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', 'default')

      const res = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: leadId, action, ...payload }),
      })

      if (!res.ok) {
        console.error('Action failed:', await res.json().catch(() => ({ error: `${res.status}` })))
        return
      }

      const { lead } = await res.json()
      setTableLeads((prev) => prev.map((l) => (l._id === leadId ? { ...l, ...lead } : l)))
      setSelectedLead(null)
    } catch (err) {
      console.error('Action error:', err)
    }
  }, [brand])

  const handleDelete = useCallback(async (leadId: string) => {
    try {
      const url = new URL('/api/leads', window.location.origin)
      const res = await fetch(`${url.toString()}?id=${encodeURIComponent(leadId)}&brand=${encodeURIComponent(brand)}&tenantId=default`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
      setTableLeads((prev) => prev.filter((l) => l._id !== leadId))
      setSelectedLead(null)
    } catch (err) {
      console.error('Delete error:', err)
    }
  }, [brand])

  // Table view shows the full brand list server-fetched above; no client-side
  // region/status filtering (removed — the kanban board's columns already
  // group by status, and cross-brand region filters weren't in use).
  const filteredLeads = useMemo(() => (view === 'table' ? tableLeads : []), [tableLeads, view])

  const loadSearchOptions = useCallback(async (query: string) => {
    if (!query.trim()) return []
    const url = new URL('/api/search', window.location.origin)
    url.searchParams.set('q', query)
    url.searchParams.set('brand', brand)
    url.searchParams.set('limit', '8')
    const res = await fetch(url.toString())
    if (!res.ok) throw new Error(`Search failed: ${res.status}`)
    const data = await res.json()
    const leads: Lead[] = data.results || []
    searchResultsRef.current = Object.fromEntries(leads.map((lead) => [lead._id, lead]))
    return leads.map((lead) => ({
      value: lead._id,
      label: lead.industry || lead.sport_or_sector
        ? `${lead.entity_name} — ${lead.industry || lead.sport_or_sector}`
        : lead.entity_name,
    }))
  }, [brand])

  const handleSearchSelect = useCallback((leadId: string | null) => {
    if (leadId && searchResultsRef.current[leadId]) {
      setSelectedLead(searchResultsRef.current[leadId])
    }
    setSearchSelection(null)
  }, [])

  return (
    <div data-theme="default" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Paper radius="md" withBorder p="md" style={{ flexShrink: 0 }}>
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <div>
            <Text fw={700} size="xl">{boardMeta?.label || brand}</Text>
            {metaLoading ? (
              <Loader size="xs" />
            ) : boardMeta ? (
              <Text size="sm" c="dimmed">
                {typeof boardMeta.totalLeads === 'number' ? boardMeta.totalLeads.toLocaleString() : '—'} leads
                {boardMeta.updatedAt ? ` · updated ${new Date(boardMeta.updatedAt).toLocaleTimeString()}` : ''}
              </Text>
            ) : null}
            {boardMeta?.forecast?.totalWeightedRevenue !== undefined && (
              <Text size="sm" c="dimmed">
                Forecast: {boardMeta.forecast.currency === 'EUR' ? '€' : '$'}{boardMeta.forecast.totalWeightedRevenue.toLocaleString()} weighted
              </Text>
            )}
          </div>
          <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
            <Select
              size="xs"
              value={view}
              onChange={(value) => setView(value as ViewMode)}
              data={VIEW_OPTIONS}
            />
            <Button size="xs" variant="light" color="gray" onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}>
              {sortOrder === 'asc' ? 'Asc ↑' : 'Desc ↓'}
            </Button>
          </Group>
        </Group>
      </Paper>

      <Group justify="center" p="sm" style={{ flexShrink: 0 }}>
        <Box style={{ width: '100%', maxWidth: 480 }}>
          <SearchableSelect
            value={searchSelection}
            onChange={handleSearchSelect}
            loadOptions={loadSearchOptions}
            placeholder="Search leads by name, industry…"
            clearable
            ariaLabel="Search leads"
          />
        </Box>
      </Group>

      <div style={{ flex: 1 }}>
        {view === 'kanban' && (
          <KanbanBoard
            brand={brand}
            onOpenLead={setSelectedLead}
            mode={isMobile ? 'mobile' : 'desktop'}
            forecast={boardMeta?.forecast?.pipeline || null}
            forecastCurrency={boardMeta?.forecast?.currency === 'EUR' ? 'EUR' : 'USD'}
          />
        )}

        {view === 'table' && (
          tableLoading
            ? <Container py="xl"><Group justify="center"><Loader /></Group></Container>
            : <TableView leads={filteredLeads} />
        )}

        {view === 'metrics' && <MetricsPanel brand={brand} tenantId="default" />}
        {view === 'search' && <SearchLearningPanel />}
      </div>

      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          brand={brand}
          opened
          onClose={() => setSelectedLead(null)}
          onAction={handleAction}
          onDelete={handleDelete}
          onUpdated={() => setSelectedLead(null)}
        />
      )}
    </div>
  );
}
