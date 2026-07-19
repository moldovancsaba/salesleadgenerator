'use client';

import { useState, useEffect } from "react";
import { Box, Text, Button, Group, ActionIcon } from "@mantine/core";
import { showNotification } from "@mantine/notifications";
import { IconAdjustmentsHorizontal, IconX } from "@tabler/icons-react";
import type { Lead, KanbanColumn } from "../../types";
import { KanbanBoard } from "../../kanban";
import { TableView } from "../../table";
import { LeadDetailModal } from "../../detail";
import { normalizeLead as normalizeLeadShared } from "../../lib/normalize-lead";
import { resolveBrand, BRAND_CONFIG } from "../../lib/brand";

type Props = {
  params: { brand: string };
  searchParams?: Record<string, string | string[]>;
};

export default function BrandPipelinePage({ params, searchParams }: Props) {
  const brand = resolveBrand(params.brand);
  const config = BRAND_CONFIG[brand];
  const urlTenant = typeof searchParams?.tenantId === 'string' ? searchParams.tenantId : '';
  const [tenantId, setTenantId] = useState<string>(() => urlTenant || 'default');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [countyFilter, setCountyFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchLeads();
  }, [brand, tenantId]);

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
        const response = await fetch(`/api/leads?brand=${brand}&tenantId=${encodeURIComponent(tenantId)}&limit=500&page=${page}`);
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
      const response = await fetch(`/api/leads?id=${leadId}&brand=${brand}&tenantId=${encodeURIComponent(tenantId)}`, {
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
      const response = await fetch(`/api/leads?id=${leadId}&brand=${brand}&tenantId=${encodeURIComponent(tenantId)}`, {
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
      const response = await fetch(`/api/leads/${leadId}?brand=${brand}&tenantId=${encodeURIComponent(tenantId)}`, {
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
    const matchesCounty = countyFilter === "ALL" || lead.region === countyFilter;
    const matchesSearch = searchQuery
      ? lead.entity_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.industry?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.decision_maker_name?.toLowerCase().includes(searchQuery.toLowerCase())
      : true;
    return matchesCounty && matchesSearch;
  });

  if (loading) {
    return (
      <Box p="xl">
        <Text>Loading {config.label} pipeline...</Text>
      </Box>
    );
  }

  return (
    <Box
      style={{
        height: '100dvh',
        overflow: 'hidden',
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
        <Group justify="space-between" align="center">
          <Group gap="xs">
            <Text fw={700} size="sm">{config.label}</Text>
            <input
              type="text"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value || 'default')}
              placeholder="tenantId"
              title="Tenant ID"
              style={{
                padding: '0.2rem 0.4rem',
                borderRadius: '0.25rem',
                border: '1px solid var(--mantine-color-gray-3)',
                fontSize: '0.75rem',
                width: 120,
              }}
            />
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
          </Group>
          <Group gap="xs">
            <ActionIcon
              size="sm"
              variant={showFilters ? 'filled' : 'light'}
              color="gray"
              onClick={() => setShowFilters(!showFilters)}
            >
              <IconAdjustmentsHorizontal size={16} />
            </ActionIcon>
          </Group>
        </Group>

        {showFilters && (
          <Box mt="xs">
            <Group gap="xs" wrap="wrap">
              {['ALL', 'USA', 'CEE', 'MENA', 'APAC', 'EUROPE'].map((r) => (
                <Button
                  key={r}
                  size="xs"
                  variant={countyFilter === r ? 'filled' : 'light'}
                  onClick={() => setCountyFilter(r)}
                >
                  {r === 'ALL' ? 'All Counties' : r}
                </Button>
              ))}
              <input
                type="text"
                placeholder="Search by name, sector..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.currentTarget.value)}
                style={{
                  flex: 1,
                  minWidth: 100,
                  padding: '0.3rem 0.5rem',
                  borderRadius: '0.25rem',
                  border: '1px solid var(--mantine-color-gray-3)',
                  fontSize: '0.8rem',
                }}
              />
            </Group>
          </Box>
        )}
      </Box>

      {viewMode === 'kanban' ? (
        <KanbanBoard
          leads={filteredLeads}
          onMove={handleMove}
          onOpenLead={setSelectedLead}
        />
      ) : (
        <TableView
          leads={filteredLeads}
          onRowClick={setSelectedLead}
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
