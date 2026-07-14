"use client";

import { useState, useEffect } from "react";
import { Box, TextInput, Select, Badge } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import type { Lead, KanbanColumn } from "./types";
import { KanbanBoard } from "./kanban";

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [regionFilter, setRegionFilter] = useState<"ALL" | "US" | "CEE" | "MENA">("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    fetchLeads();
  }, []);

  async function fetchLeads() {
    try {
      const response = await fetch("/api/leads");
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
      const response = await fetch(`/api/leads?id=${leadId}`, {
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
      <KanbanBoard
        leads={filteredLeads}
        onMove={handleMove}
      />
    </Box>
  );
}
