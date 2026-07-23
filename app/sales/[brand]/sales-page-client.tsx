'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Group, Text, Paper, Select, Loader, Container, Box, TextInput, UnstyledButton } from '@mantine/core';
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
  const [isMobile, setIsMobile] = useState(true);
  const [boardMeta, setBoardMeta] = useState<{
    brand: string; label: string; totalLeads: number;
    columnCounts: Record<string, number>; regionCounts: Record<string, number>;
    forecast: any; updatedAt: string;
  } | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [tableLeads, setTableLeads] = useState<Lead[]>([])
  const [tableLoading, setTableLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Lead[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const searchBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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
      url.searchParams.set('id', leadId)

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

  // Live predictive search: debounced fetch against /api/search as the user
  // types, results shown in a plain dropdown below an always-editable input.
  useEffect(() => {
    clearTimeout(searchDebounceRef.current)
    const query = searchQuery.trim()
    if (!query) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }
    setSearchLoading(true)
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const url = new URL('/api/search', window.location.origin)
        url.searchParams.set('q', query)
        url.searchParams.set('brand', brand)
        url.searchParams.set('limit', '8')
        const res = await fetch(url.toString())
        if (!res.ok) throw new Error(`Search failed: ${res.status}`)
        const data = await res.json()
        setSearchResults((data.results || []) as Lead[])
      } catch (err) {
        console.error('Search error:', err)
        setSearchResults([])
      } finally {
        setSearchLoading(false)
      }
    }, 250)
    return () => clearTimeout(searchDebounceRef.current)
  }, [searchQuery, brand])

  const handleSearchResultClick = useCallback((lead: Lead) => {
    clearTimeout(searchBlurTimeoutRef.current)
    setSelectedLead(lead)
    setSearchQuery('')
    setSearchResults([])
    setSearchOpen(false)
  }, [])

  const handleSearchBlur = useCallback(() => {
    // Delay closing so a click on a dropdown result registers before the
    // dropdown unmounts (blur fires before click otherwise).
    searchBlurTimeoutRef.current = setTimeout(() => setSearchOpen(false), 150)
  }, [])

  return (
    <div data-theme="default" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Paper radius="md" withBorder p="md" style={{ flexShrink: 0 }}>
        <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
          <Text fw={700} size="lg" truncate style={{ minWidth: 0 }}>{boardMeta?.label || brand}</Text>
          <Select
            size="xs"
            value={view}
            onChange={(value) => setView(value as ViewMode)}
            data={VIEW_OPTIONS}
            style={{ width: 132, flexShrink: 0 }}
          />
        </Group>
        {metaLoading ? (
          <Loader size="xs" mt={4} />
        ) : boardMeta ? (
          <Group justify="space-between" align="center" mt={4} wrap="nowrap" gap="xs">
            <Text size="sm" c="dimmed" truncate style={{ minWidth: 0 }}>
              {typeof boardMeta.totalLeads === 'number' ? boardMeta.totalLeads.toLocaleString() : '—'} leads
            </Text>
            {boardMeta?.forecast?.totalWeightedRevenue !== undefined && (
              <Text size="sm" c="dimmed" fw={600} style={{ flexShrink: 0 }}>
                {boardMeta.forecast.currency === 'EUR' ? '€' : '$'}{Math.round(boardMeta.forecast.totalWeightedRevenue).toLocaleString()}
              </Text>
            )}
          </Group>
        ) : null}
      </Paper>

      <Group justify="center" p="sm" style={{ flexShrink: 0 }}>
        <Box style={{ width: '100%', maxWidth: 480, position: 'relative' }}>
          <TextInput
            value={searchQuery}
            onChange={(event) => {
              setSearchQuery(event.currentTarget.value)
              setSearchOpen(true)
            }}
            onFocus={() => { if (searchQuery.trim()) setSearchOpen(true) }}
            onBlur={handleSearchBlur}
            placeholder="Search leads by name, industry…"
            aria-label="Search leads"
          />
          {searchOpen && searchQuery.trim() && (
            <Paper
              withBorder
              shadow="md"
              style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 320, overflowY: 'auto', zIndex: 1000 }}
            >
              {searchLoading ? (
                <Group justify="center" p="sm"><Loader size="xs" /></Group>
              ) : searchResults.length === 0 ? (
                <Text size="sm" c="dimmed" p="sm">No matching leads</Text>
              ) : (
                searchResults.map((lead) => (
                  <UnstyledButton
                    key={lead._id}
                    onClick={() => handleSearchResultClick(lead)}
                    style={{ display: 'block', width: '100%', padding: '0.5rem 0.75rem', textAlign: 'left' }}
                  >
                    <Text size="sm" fw={500}>{lead.entity_name}</Text>
                    {(lead.industry || lead.sport_or_sector) && (
                      <Text size="xs" c="dimmed">{lead.industry || lead.sport_or_sector}</Text>
                    )}
                  </UnstyledButton>
                ))
              )}
            </Paper>
          )}
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
