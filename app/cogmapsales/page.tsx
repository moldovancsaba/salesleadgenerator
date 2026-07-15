"use client";

import { useState, useEffect } from "react";
import { Box, Text, Button, Group, ActionIcon } from "@mantine/core";
import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import type { Lead, KanbanColumn } from "../types";
import { KanbanBoard } from "../kanban";
import { TableView } from "../table";
import { LeadDetailModal } from "../detail";

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [regionFilter, setRegionFilter] = useState<"ALL" | "US" | "CEE" | "MENA">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"kanban" | "table">("kanban");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchLeads();
  }, []);

  async function fetchLeads() {
    try {
      const response = await fetch("/api/cogmapsales/leads");
      if (!response.ok) throw new Error("Failed to fetch leads");
      const data = await response.json();
      setLeads(data.leads || []);
    } catch (error) {
      console.error("Error fetching leads:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleMove(leadId: string, column: KanbanColumn, sortOrder: number) {
    const lead = leads.find((l) => l._id === leadId);
    const fromColumn = lead?.kanbanColumn;

    try {
      const response = await fetch(`/api/cogmapsales/leads?id=${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kanbanColumn: column,
          sortOrder,
          fromColumn,
        }),
      });

      if (!response.ok) throw new Error("Failed to move lead");

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
      await fetch(`/api/cogmapsales/leads?id=${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      setSelectedLead(null);
      await fetchLeads();
    } catch (err) {
      console.error("Action failed", err);
    }
  }

  const filteredLeads = leads.filter((lead) => {
    const matchesRegion = regionFilter === "ALL" || lead.region === regionFilter;
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
        <Text>Loading pipeline...</Text>
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
        <Group justify="space-between" align="center">
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
              {['ALL', 'US', 'CEE', 'MENA'].map((r) => (
                <Button
                  key={r}
                  size="xs"
                  variant={regionFilter === r ? 'filled' : 'light'}
                  onClick={() => setRegionFilter(r as any)}
                >
                  {r === 'ALL' ? 'All' : r}
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
          lead={selectedLead}
          onClose={() => setSelectedLead(null)}
          onAction={handleAction}
          onUpdated={() => setSelectedLead(null)}
        />
      )}
    </Box>
  );
}
