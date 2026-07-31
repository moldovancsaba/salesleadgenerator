'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Group, Text, Paper, Loader, Container, Box, TextInput, UnstyledButton, ActionIcon, Tooltip } from '@mantine/core';
import { IconChecklist, IconX, IconPlus } from '@tabler/icons-react';
import type { Lead } from '@/app/types';
import { KanbanBoard } from '@/app/kanban';
import { LeadDetailModal } from '@/app/detail';
import { TableView } from '@/app/table';
import { SearchLearningPanel } from '@/app/search-learning';
import { MetricsPanel } from '@/app/metrics';
import { FilterBar } from '@/app/components/FilterBar';
import { AddLeadModal } from '@/app/components/AddLeadModal';
import { BACKLOG_COLUMN_DEF } from '@/app/constants';
import type { LeadFilter } from '@/lib/saved-filters';

// Issue #126 — 'backlog' mounts the exact same KanbanBoard component as
// 'kanban', just with a single-column columnDefs (BACKLOG_COLUMN_DEF) —
// same Select mode, same bulk actions, same filters, no separate view
// implementation.
type ViewMode = 'kanban' | 'table' | 'metrics' | 'search' | 'backlog';

type Props = {
  brand: string;
};

export function SalesPageClient({ brand }: Props) {
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  // View is driven by the ?view= URL param (set by the hamburger nav's View
  // section, app/components/AppNav.tsx) rather than an in-page dropdown —
  // the on-page "Kanban ▾" Select was removed because it duplicated the
  // hamburger's job and was visually competing with it (issue #95).
  const searchParams = useSearchParams();
  const router = useRouter();
  const viewParam = searchParams.get('view');
  // Issue #139 — the Contacts view links to a specific lead via
  // `?leadId=`, so a lead can be opened directly from outside the board
  // (previously the only way to open the detail modal was clicking a
  // card/row already rendered on this page). Fetched once per leadId value;
  // cleared from the URL on close so refreshing after dismissing the modal
  // doesn't reopen it.
  const leadIdParam = searchParams.get('leadId');
  useEffect(() => {
    if (!leadIdParam) return;
    let cancelled = false;
    fetch(`/api/leads/${encodeURIComponent(leadIdParam)}?brand=${encodeURIComponent(brand)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Lead not found (${res.status})`);
        return res.json();
      })
      .then((lead) => {
        if (!cancelled) setSelectedLead(lead);
      })
      .catch((err) => console.error('Failed to open lead from leadId param:', err));
    return () => { cancelled = true; };
  }, [leadIdParam, brand]);
  const view: ViewMode = viewParam === 'table' || viewParam === 'metrics' || viewParam === 'search' || viewParam === 'backlog'
    ? viewParam
    : 'kanban';
  const [boardMeta, setBoardMeta] = useState<{
    brand: string; label: string; totalLeads: number;
    columnCounts: Record<string, number>; regionCounts: Record<string, number>;
    forecast: any; updatedAt: string;
  } | null>(null)
  const [metaLoading, setMetaLoading] = useState(true)
  const [tableLeads, setTableLeads] = useState<Lead[]>([])
  const [tableLoading, setTableLoading] = useState(true)
  // Issue #71: shared across kanban and table view (both mount the same
  // FilterBar), so switching views mid-session keeps the same active filter.
  const [leadFilter, setLeadFilter] = useState<LeadFilter>({})
  // Issue #70/#53 follow-up: owned here (not inside KanbanBoard) so the
  // toggle sits in the same slim toolbar row as the Filters trigger, rather
  // than each control mounting its own separate row.
  const [selectMode, setSelectMode] = useState(false)
  // Issue #127 — bumped after a manual Add Lead create so the header count,
  // the active Kanban/Backlog board, and Table view all pick up the new
  // lead. KanbanBoard has no external "refresh" hook of its own (it manages
  // its own column state internally) — remounting it via `key` is the
  // simplest correct way to force a full reload without adding one.
  const [refreshKey, setRefreshKey] = useState(0)
  const [addLeadOpen, setAddLeadOpen] = useState(false)
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
  }, [brand, refreshKey])

  // Load table data server-side when needed. Cursor-paginated (not a single
  // capped fetch) so a brand exceeding one page's worth of leads doesn't get
  // silently truncated — loops until the server reports no more pages.
  useEffect(() => {
    if (view !== 'table') return
    let cancelled = false
    setTableLoading(true)

    async function loadAllPages() {
      const collected: Lead[] = []
      let cursor: string | undefined
      for (;;) {
        const url = new URL('/api/leads', window.location.origin)
        url.searchParams.set('brand', brand)
        url.searchParams.set('tenantId', 'default')
        url.searchParams.set('limit', '500')
        if (cursor) url.searchParams.set('cursor', cursor)
        if (leadFilter.region) url.searchParams.set('region', leadFilter.region)
        if (leadFilter.industry?.trim()) url.searchParams.set('industry', leadFilter.industry.trim())
        if (leadFilter.tags && leadFilter.tags.length > 0) url.searchParams.set('tags', leadFilter.tags.join(','))

        const res = await fetch(url.toString())
        if (!res.ok) throw new Error(`${res.status}`)
        const data = await res.json()
        collected.push(...((data.leads || []) as Lead[]))
        if (cancelled || !data.hasMore || !data.nextCursor) break
        cursor = data.nextCursor
      }
      if (!cancelled) setTableLeads(collected)
    }

    loadAllPages()
      .catch(console.error)
      .finally(() => { if (!cancelled) setTableLoading(false) })
    return () => { cancelled = true }
  }, [view, brand, leadFilter.region, leadFilter.industry, leadFilter.tags, refreshKey])

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
        // Rethrow rather than swallow (issue #91's investigation): the
        // callers of onAction (app/detail.tsx's handleAccept/handleDecline/
        // etc.) already have a try/catch that shows a failure notification
        // — but only if this actually throws. Swallowing it here meant a
        // genuinely failed action still showed a false "success" toast.
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const { lead } = await res.json()
      setTableLeads((prev) => prev.map((l) => (l._id === leadId ? { ...l, ...lead } : l)))
      setSelectedLead(null)
    } catch (err) {
      console.error('Action error:', err)
      throw err
    }
  }, [brand])

  const handleDelete = useCallback(async (leadId: string) => {
    try {
      // Targets /api/leads/[id] (the real DELETE handler) — this previously
      // called DELETE /api/leads?id=..., a route with no DELETE handler at
      // all, always failing regardless of auth (found investigating #91).
      const url = new URL(`/api/leads/${encodeURIComponent(leadId)}`, window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', 'default')
      const res = await fetch(url.toString(), { method: 'DELETE' })
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
      setTableLeads((prev) => prev.filter((l) => l._id !== leadId))
      setSelectedLead(null)
    } catch (err) {
      console.error('Delete error:', err)
      throw err
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
        setSearchResults((data.leads || []) as Lead[])
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
        {(view === 'kanban' || view === 'table' || view === 'backlog') && (
          <Group gap="xs" mb="sm">
            <FilterBar brand={brand} value={leadFilter} onChange={setLeadFilter} />
            {(view === 'kanban' || view === 'backlog') && (
              <Tooltip label={selectMode ? 'Cancel select' : 'Select leads for a bulk action'}>
                <ActionIcon
                  variant={selectMode ? 'filled' : 'subtle'}
                  size="lg"
                  aria-label={selectMode ? 'Cancel select' : 'Select leads for a bulk action'}
                  onClick={() => setSelectMode((prev) => !prev)}
                >
                  {selectMode ? <IconX size={18} /> : <IconChecklist size={18} />}
                </ActionIcon>
              </Tooltip>
            )}
            {view === 'kanban' && (
              <Tooltip label="Add a lead manually">
                <ActionIcon
                  variant="subtle"
                  size="lg"
                  aria-label="Add a lead manually"
                  onClick={() => setAddLeadOpen(true)}
                >
                  <IconPlus size={18} />
                </ActionIcon>
              </Tooltip>
            )}
          </Group>
        )}

        {view === 'kanban' && (
          <KanbanBoard
            key={`kanban-${refreshKey}`}
            brand={brand}
            onOpenLead={setSelectedLead}
            forecast={boardMeta?.forecast?.pipeline || null}
            forecastCurrency={boardMeta?.forecast?.currency === 'EUR' ? 'EUR' : 'USD'}
            filter={leadFilter}
            selectMode={selectMode}
          />
        )}

        {view === 'backlog' && (
          // Issue #126 — Backlog is excluded entirely from Forecast (no
          // `forecast` prop passed), same component otherwise.
          <KanbanBoard
            key={`backlog-${refreshKey}`}
            brand={brand}
            onOpenLead={setSelectedLead}
            filter={leadFilter}
            selectMode={selectMode}
            columnDefs={BACKLOG_COLUMN_DEF}
          />
        )}

        {view === 'table' && (
          tableLoading
            ? <Container py="xl"><Group justify="center"><Loader /></Group></Container>
            : <TableView leads={filteredLeads} onOpenLead={setSelectedLead} />
        )}

        {view === 'metrics' && <MetricsPanel brand={brand} tenantId="default" />}
        {view === 'search' && <SearchLearningPanel />}
      </div>

      {selectedLead && (
        <LeadDetailModal
          lead={selectedLead}
          brand={brand}
          opened
          onClose={() => {
            setSelectedLead(null);
            if (leadIdParam) {
              const url = new URL(window.location.href);
              url.searchParams.delete('leadId');
              router.replace(`${url.pathname}${url.search}`);
            }
          }}
          onAction={handleAction}
          onDelete={handleDelete}
          onUpdated={() => setSelectedLead(null)}
        />
      )}

      <AddLeadModal
        brand={brand}
        opened={addLeadOpen}
        onClose={() => setAddLeadOpen(false)}
        onCreated={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
