'use client';

import { useState, useEffect, useMemo } from "react";
import { Box, Text, Button, Group, ActionIcon } from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { IconAdjustmentsHorizontal, IconX } from "@tabler/icons-react";
import type { Lead, KanbanColumn } from "../../types";
import { KanbanBoard } from "../../kanban";
import { TableView } from "../../table";
import { LeadDetailModal } from "../../detail";
import { normalizeLead as normalizeLeadShared } from "../../lib/normalize-lead";
import { resolveBrand, BRAND_CONFIG } from "../../lib/brand";
import { COLUMNS } from "../../constants";

type Props = {
  params: { brand: string };
  searchParams?: Record<string, string | string[]>;
};

export default function BrandPipelinePage({ params, searchParams }: Props) {
  const brand = resolveBrand(params.brand);
  const config = BRAND_CONFIG[brand];
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [countryFilter, setCountryFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [sortByIce, setSortByIce] = useState<"ice" | "name">("ice");
  const [iceSortOrder, setIceSortOrder] = useState<"asc" | "desc">("desc");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [collapsedColumns, setCollapsedColumns] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchLeads();
  }, [brand]);

  const countryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const lead of leads) {
      const country = lead.country?.trim();
      if (country) set.add(country);
    }
    return ["ALL", ...Array.from(set).sort((a, b) => a.localeCompare(b))];
  }, [leads]);

  const columnCounts = useMemo(() => {
    const counts: Record<KanbanColumn, number> = {
      DISCOVERED: 0,
      QUALIFIED: 0,
      ENGAGED: 0,
      PROPOSAL: 0,
      WON: 0,
      LOST: 0,
    };
    for (const lead of leads) {
      const col = (lead.kanbanColumn as KanbanColumn) || "DISCOVERED";
      counts[col] = (counts[col] || 0) + 1;
    }
    return counts;
  }, [leads]);

  function showError(message: string) {
    setErrorMessage(message);
  }

  function setActionBusy(leadId: string, action: string, busy: boolean) {
    const key = `${leadId}:${action}`;
    setActionLoading((prev) => {
      const next = { ...prev };
      if (busy) {
        next[key] = true;
      } else {
        delete next[key];
      }
      return next;
    });
  }

  function isActionBusy(leadId: string, action: string) {
    return Boolean(actionLoading[`${leadId}:${action}`]);
  }

  async function fetchLeads() {
    try {
      setLoading(true);
      const allLeads: any[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const response = await fetch(`/api/leads?brand=${brand}&limit=500&page=${page}`);
        if (!response.ok) throw new Error("Failed to fetch leads");
        const data = await response.json();
        const pageLeads = (data.leads || []).map((l: any) => normalizeLeadShared(l, brand));
        allLeads.push(...pageLeads);
        totalPages = data.totalPages || 1;
        page++;
      } while (page <= totalPages);

      setLeads(allLeads);
    } catch (error) {
      console.error("Error fetching leads:", error);
      showError(error instanceof Error ? error.message : "Failed to load leads");
    } finally {
      setLoading(false);
    }
  }

  async function handleMove(leadId: string, column: KanbanColumn, sortOrder: number) {
    const lead = leads.find((l) => l._id === leadId);
    const fromColumn = lead?.kanbanColumn;

    if (isActionBusy(leadId, 'COLUMN_MOVE')) return;
    setActionBusy(leadId, 'COLUMN_MOVE', true);
    try {
      const response = await fetch(`/api/leads?id=${leadId}&brand=${brand}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "COLUMN_MOVE",
          kanbanColumn: column,
          sortOrder,
          fromColumn,
        }),
      });

      const result = await response.json();
      if (!response.ok || !result.success) {
        showNotification({ message: result.error || 'Failed to move lead', color: 'red', autoClose: 5000 });
        throw new Error(result.error || 'Failed to move lead');
      }

      showNotification({ message: `Moved to ${column}`, color: 'green', autoClose: 4000 });
      setLeads((prev) =>
        prev.map((l) =>
          l._id === leadId ? { ...l, kanbanColumn: column, sortOrder } : l
        )
      );
    } catch (error) {
      console.error("Error moving lead:", error);
      showError(error instanceof Error ? error.message : "Failed to move lead");
      await fetchLeads();
    } finally {
      setActionBusy(leadId, 'COLUMN_MOVE', false);
    }
  }

  async function handleAction(leadId: string, action: string, payload: any) {
    if (isActionBusy(leadId, action)) return;
    setActionBusy(leadId, action, true);
    try {
      const response = await fetch(`/api/leads?id=${leadId}&brand=${brand}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        showNotification({ message: result.error || `Action ${action} failed`, color: 'red', autoClose: 5000 });
        throw new Error(result.error || `Action ${action} failed`);
      }

      showNotification({ message: `Action completed: ${action}`, color: 'green', autoClose: 4000 });
      setLeads((prev) =>
        prev.map((l) => (l._id === leadId ? { ...l, ...(result.lead || {}) } : l))
      );
      setSelectedLead(null);
    } catch (err) {
      console.error("Action failed", err);
      showError(err instanceof Error ? err.message : `Action ${action} failed`);
    } finally {
      setActionBusy(leadId, action, false);
    }
  }

  async function handleDelete(leadId: string) {
    if (!confirm("Permanently delete this lead?")) return;
    if (isActionBusy(leadId, 'DELETE')) return;
    setActionBusy(leadId, 'DELETE', true);
    try {
      const response = await fetch(`/api/leads/${leadId}?brand=${brand}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        showNotification({ message: 'Failed to delete', color: 'red', autoClose: 5000 });
        throw new Error('Failed to delete');
      }
      showNotification({ message: 'Lead deleted', color: 'green', autoClose: 4000 });
      setSelectedLead(null);
      await fetchLeads();
    } catch (err) {
      console.error('Delete failed', err);
      showError('Delete failed: ' + (err instanceof Error ? err.message : 'unknown'));
    } finally {
      setActionBusy(leadId, 'DELETE', false);
    }
  }

  const filteredLeads = leads.filter((lead) => {
    const matchesCountry = countryFilter === "ALL" || lead.country === countryFilter;
    const matchesSearch = searchQuery
      ? lead.entity_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.industry?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.decision_maker_name?.toLowerCase().includes(searchQuery.toLowerCase())
      : true;
    return matchesCountry && matchesSearch;
  });

  const sortedLeads = useMemo(() => {
    const list = [...filteredLeads];
    list.sort((a, b) => {
      if (sortByIce === 'name') {
        const an = (a.entity_name || '').toLowerCase();
        const bn = (b.entity_name || '').toLowerCase();
        return iceSortOrder === 'asc' ? an.localeCompare(bn) : bn.localeCompare(an);
      }
      const getIce = (lead: Lead) => {
        if (lead.scoreProfile?.finalBlended?.ice != null) return lead.scoreProfile.finalBlended.ice;
        if (lead.ice) return lead.ice.impact * lead.ice.confidence * lead.ice.ease;
        return 0;
      };
      const ia = getIce(a);
      const ib = getIce(b);
      return iceSortOrder === 'asc' ? ia - ib : ib - ia;
    });
    return list;
  }, [filteredLeads, sortByIce, iceSortOrder]);

  if (loading) {
    return (
      <Box p="xl">
        <Text>Loading {config.label} pipeline...</Text>
      </Box>
    );
  }

  const toggleColumn = (key: string) => {
    setCollapsedColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <Box
      style={{
        minHeight: '100dvh',
        overflow: 'auto',
        backgroundColor: 'var(--mantine-color-gray-0)',
      }}
    >
      <Box
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          padding: '0.75rem',
          borderBottom: '1px solid var(--mantine-color-gray-2)',
          backgroundColor: 'var(--mantine-color-gray-0)',
          flexShrink: 0,
        }}
      >
        {errorMessage && (
          <Box
            mb="xs"
            p="xs"
            style={{
              borderRadius: '0.25rem',
              backgroundColor: 'var(--mantine-color-red-0)',
              border: '1px solid var(--mantine-color-red-4)',
            }}
          >
            <Group justify="space-between" align="center">
              <Text size="sm" c="red">{errorMessage}</Text>
              <ActionIcon size="sm" variant="light" color="red" onClick={() => setErrorMessage(null)}>
                <IconX size={14} />
              </ActionIcon>
            </Group>
          </Box>
        )}
        <Group justify="space-between" align="center" wrap="wrap" gap="xs">
          <Group gap="xs">
            <Button
              size="xs"
              variant={viewMode === 'kanban' ? 'filled' : 'light'}
              color="dark"
              onClick={() => setViewMode('kanban')}
            >
              Kanban
            </Button>
            <Button
              size="xs"
              variant={viewMode === 'table' ? 'filled' : 'light'}
              color="dark"
              onClick={() => setViewMode('table')}
            >
              Table
            </Button>
            <Button
              size="xs"
              variant={sortByIce === 'ice' ? 'filled' : 'light'}
              color="gray"
              onClick={() => setSortByIce('ice')}
            >
              ICE {iceSortOrder === 'asc' ? '↑' : '↓'}
            </Button>
            <Button
              size="xs"
              variant={sortByIce === 'name' ? 'filled' : 'light'}
              color="gray"
              onClick={() => setSortByIce('name')}
            >
              Name
            </Button>
            <Button
              size="xs"
              variant="light"
              color="gray"
              onClick={() => setIceSortOrder((prev) => prev === 'asc' ? 'desc' : 'asc')}
            >
              {iceSortOrder === 'asc' ? 'Asc' : 'Desc'}
            </Button>
          </Group>
          <Group gap="xs" wrap="wrap">
            {countryOptions.map((c) => (
              <Button
                key={c}
                size="xs"
                variant={countryFilter === c ? 'filled' : 'light'}
                onClick={() => setCountryFilter(c)}
              >
                {c === 'ALL' ? 'All' : c}
              </Button>
            ))}
            <input
              type="text"
              placeholder="Search..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.currentTarget.value)}
              style={{
                flex: '1 1 120px',
                minWidth: 110,
                padding: '0.3rem 0.5rem',
                borderRadius: '0.25rem',
                border: '1px solid var(--mantine-color-gray-3)',
                fontSize: '0.8rem',
                backgroundColor: '#fff',
                color: '#000',
              }}
            />
          </Group>
        </Group>
      </Box>

      {viewMode === 'kanban' ? (
        <KanbanBoard
          leads={sortedLeads}
          onMove={handleMove}
          onOpenLead={setSelectedLead}
          collapsedColumns={collapsedColumns}
          onToggleColumn={toggleColumn}
          columnCounts={columnCounts}
          sortKey={sortByIce}
          sortOrder={iceSortOrder}
        />
      ) : (
        <TableView
          leads={sortedLeads}
          onRowClick={setSelectedLead}
          sortKey={sortByIce}
          sortOrder={iceSortOrder}
        />
      )}

      {selectedLead && (
        <LeadDetailModal
          brand={brand}
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onAction={handleAction}
          onDelete={handleDelete}
          onUpdated={() => setSelectedLead(null)}
        />
      )}
    </Box>
  );
}
