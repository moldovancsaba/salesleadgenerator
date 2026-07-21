'use client';

import { useState, useEffect, useMemo } from 'react';
import { Group, Text, Button, SimpleGrid, Paper, Badge, Select, useMediaQuery } from '@mantine/core';
import { IconArrowsSort } from '@tabler/icons-react';
import type { Lead } from '@/app/types';
import { LeadCard } from '@/app/card';
import { KanbanBoard } from '@/app/kanban';
import { LeadDetailModal } from '@/app/detail';
import { TableView } from '@/app/table';
import { MetricsPanel } from '@/app/metrics';
import { SearchLearningPanel } from '@/app/search-learning';
import { COLUMNS, getIceScore } from '@/app/constants';

type ViewMode = 'kanban' | 'table' | 'metrics' | 'search';
type LayoutMode = 'mobile-portrait' | 'mobile-landscape' | 'tablet-portrait' | 'tablet-landscape' | 'desktop';

const MODE_KEY = 'salesleadgenerator.layoutMode';

const REGION_OPTIONS = [
  { value: 'all', label: 'All Regions' },
  { value: 'US', label: 'US' },
  { value: 'CEE', label: 'CEE' },
  { value: 'MENA', label: 'MENA' },
];

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All Statuses' },
  ...COLUMNS.map((col) => ({ value: col.key, label: col.label })),
];

const VIEW_OPTIONS = [
  { value: 'kanban', label: 'Kanban' },
  { value: 'table', label: 'Table' },
  { value: 'metrics', label: 'Metrics' },
  { value: 'search', label: 'Search Learning' },
];

export default function SalesPage({ params }: { params: { brand: string } }) {
  const brand = params?.brand || 'cogmap';
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [view, setView] = useState<ViewMode>('kanban');
  const [region, setRegion] = useState('all');
  const [status, setStatus] = useState('all');
  const [sortKey, setSortKey] = useState<'ice' | 'name'>('ice');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const isMobile = useMediaQuery('(max-width: 1279px)');

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedMode = localStorage.getItem(MODE_KEY);
    if (storedMode === 'mobile-landscape' || storedMode === 'tablet-portrait' || storedMode === 'tablet-landscape' || storedMode === 'desktop') {
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(MODE_KEY, isMobile ? 'mobile' : 'desktop');
  }, [isMobile]);

  useEffect(() => {
    const loadLeads = async () => {
      try {
        const response = await fetch(`/api/leads?limit=100`);
        if (!response.ok) throw new Error('Failed to fetch leads');
        const data = await response.json();
        const mapped = (data.leads || []).map((lead: any) => ({
          ...lead,
          ice: lead.ice || { impact: 0, confidence: 0, ease: 0 },
          region: lead.region || 'US',
          qualityStatus: lead.qualityStatus || 'DRAFT',
        }));
        setLeads(mapped);
      } catch (err) {
        console.error(err);
      }
    };
    loadLeads();
  }, []);

  const handleAction = async (leadId: string, action: string, payload?: any) => {
    setLeads((prev) =>
      prev.map((lead) => {
        if (lead._id !== leadId) return lead;
        if (action === 'ACCEPT') return { ...lead, status: 'QUALIFIED', kanbanColumn: 'QUALIFIED', qualifiedAt: new Date().toISOString() };
        if (action === 'DECLINE') { return { ...lead, status: 'LOST', kanbanColumn: 'LOST', declinedAt: new Date().toISOString(), declineReason: payload?.declineReason, annotation: payload?.annotation }; }
        if (action === 'PIN') { return { ...lead, status: 'ENGAGED', kanbanColumn: 'ENGAGED' }; }
        if (action === 'REQUEST_REFRESH') { return { ...lead, annotation: payload?.annotation }; }
        if (action === 'MODIFY') { return { ...lead, annotation: payload?.annotation }; }
        return lead;
      })
    );
    setSelectedLead(null);
  };

  const handleDelete = async (leadId: string) => {
    setLeads((prev) => prev.filter((lead) => lead._id !== leadId));
    setSelectedLead(null);
  };

  const filteredLeads = useMemo(() => {
    const list = [...leads];
    if (region !== 'all') {
      for (let i = list.length - 1; i >= 0; i--) { const lead = list[i]; if (lead.region !== region) list.splice(i, 1); }
    }
    if (status !== 'all') {
      for (let i = list.length - 1; i >= 0; i--) { const lead = list[i]; if (lead.kanbanColumn !== status) list.splice(i, 1); }
    }
    list.sort((a, b) => {
      if (sortKey === 'name') { return sortOrder === 'asc' ? (a.entity_name || '').localeCompare(b.entity_name || '') : (b.entity_name || '').localeCompare(a.entity_name || ''); }
      const ia = getIceScore(a);
      const ib = getIceScore(b);
      return sortOrder === 'asc' ? ia - ib : ib - ia;
    });
    return list;
  }, [leads, region, status, sortKey, sortOrder]);

  return (
    <div data-theme="default" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Paper radius="md" withBorder p="md" style={{ flexShrink: 0 }}>
        <Group justify="space-between" align="flex-start">
          <div>
            <Text fw={700} size="xl">Sales Lead Generator</Text>
            <Text size="sm" c="dimmed">Board: {brand}</Text>
          </div>
          <Group gap="xs">
            <Select size="xs" value={view} onChange={(value) => setView((value as ViewMode) || 'kanban')} data={VIEW_OPTIONS} />
            <Select size="xs" value={region} onChange={(value) => setRegion((value as string) || 'all')} data={REGION_OPTIONS} />
            <Select size="xs" value={status} onChange={(value) => setStatus((value as string) || 'all')} data={STATUS_OPTIONS} />
            <Button size="xs" variant="light" color="gray" onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}>{sortOrder === 'asc' ? 'Asc ↑' : 'Desc ↓'}</Button>
          </Group>
        </Group>
      </Paper>

      <div style={{ flex: 1 }}>
        {view === 'kanban' && (
          <KanbanBoard
            leads={filteredLeads}
            onOpenLead={setSelectedLead}
            onMove={async (leadId, column, sortOrder) => { setLeads((prev) => prev.map((lead) => (lead._id === leadId ? { ...lead, status: column, kanbanColumn: column, sortOrder } : lead))); }}
            sortKey={sortKey}
            sortOrder={sortOrder}
            onSortKeyChange={setSortKey}
            onSortOrderChange={setSortOrder}
            mode={isMobile ? 'mobile' : 'desktop'}
          />
        )}

        {view === 'table' && <TableView leads={filteredLeads} />}
        {view === 'metrics' && <MetricsPanel leads={filteredLeads} />}
        {view === 'search' && <SearchLearningPanel />}
      </div>

      {selectedLead && (
        <LeadDetailModal lead={selectedLead} brand={brand} onClose={() => setSelectedLead(null)} onAction={handleAction} onDelete={handleDelete} onUpdated={() => setSelectedLead(null)} />
      )}
    </div>
  );
}