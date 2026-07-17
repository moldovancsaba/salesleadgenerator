'use client';

import { useState, useEffect } from "react";
import { Box, Text, Button, Group, ActionIcon } from "@mantine/core";
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
  const [countryFilter, setCountryFilter] = useState<string>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchLeads();
  }, [brand, tenantId]);

  function showError(message: string) {
    setErrorMessage(message);
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
        throw new Error(result.error || "Failed to move lead");
      }

      setLeads((prev) =>
        prev.map((l) =>
          l._id === leadId ? { ...l, kanbanColumn: column, sortOrder } : l
        )
      );
    } catch (error) {
      console.error("Error moving lead:", error);
      await fetchLeads();
    }
  }

  async function handleAction(leadId: string, action: string, payload: any) {
    try {
      const response = await fetch(`/api/leads?id=${leadId}&brand=${brand}&tenantId=${encodeURIComponent(tenantId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || `Action ${action} failed`);
      }

      setLeads((prev) =>
        prev.map((l) => (l._id === leadId ? { ...l, ...(result.lead || {}) } : l))
      );
      setSelectedLead(null);
    } catch (err) {
      console.error("Action failed", err);
      showError(err instanceof Error ? err.message : "Action failed");
    }
  }

  async function handleDelete(leadId: string) {
    if (!confirm("Permanently delete this lead?")) return;
    try {
      const response = await fetch(`/api/leads/${leadId}?brand=${brand}&tenantId=${encodeURIComponent(tenantId)}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete");
      setSelectedLead(null);
      await fetchLeads();
    } catch (err) {
      console.error("Delete failed", err);
      showError("Delete failed: " + (err instanceof Error ? err.message : "unknown"));
    }
  }

  const filteredLeads = leads.filter((lead) => {
    const matchesRegion = countryFilter === "ALL" || lead.country === countryFilter;
    const matchesSearch = searchQuery
      ? lead.entity_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.industry?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        lead.decision_maker_name?.toLowerCase().includes(searchQuery.toLowerCase())
      : true;
    return matchesRegion && matchesSearch;
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
            <Text fw={700} size="sm">{filteredLeads.length} leads</Text>
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
              {['ALL', 'US', 'GB', 'FR', 'DE', 'IT', 'ES', 'SA', 'AE', 'PL', 'AU', 'NZ'].map((c) => (
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
                onChange={(e) => setSearchQuery(e.target.value)}
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
