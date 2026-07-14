"use client";

import { useState, useEffect } from "react";
import {
  Container,
  Title,
  Text,
  Group,
  Stack,
  Select,
  TextInput,
  Badge,
  Box,
  Paper,
  SimpleGrid,
  Card,
  Progress,
} from "@mantine/core";
import { IconSearch, IconBuilding, IconChartBar } from "@tabler/icons-react";
import type { Lead, KanbanColumn } from "./types";
import { COLUMNS } from "./constants";
import { KanbanBoard } from "./kanban";
import { MetricsPanel } from "./metrics";
import { SearchLearningPanel } from "./search-learning";

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"pipeline" | "metrics" | "learning">("pipeline");
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

  const columnCounts = (column: KanbanColumn) =>
    filteredLeads.filter((l) => l.kanbanColumn === column).length;

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
        minHeight: "100vh",
        backgroundColor: "var(--app-bg)",
        color: "var(--text-primary)",
      }}
    >
      {/* Header */}
      <Paper
        shadow="xs"
        p={{ base: "sm", sm: "md" }}
        style={{
          backgroundColor: "var(--sidebar-bg)",
          borderBottom: "1px solid var(--border-primary)",
        }}
      >
        <Stack gap="md">
          <Group justify="space-between" align="center" wrap="wrap">
            <Group gap="sm" align="center">
              <IconBuilding size={28} color="var(--text-primary)" style={{ flexShrink: 0 }} />
              <Stack gap={0}>
                <Title order={2} style={{ color: "var(--text-primary)", fontSize: 'clamp(1.25rem, 5vw, 1.625rem)' }}>
                  CogMap Pipeline
                </Title>
                <Text size="xs" c="dimmed">
                  Intelligent Lead Management System
                </Text>
              </Stack>
            </Group>

            <Group gap="md">
              <Badge size="lg" variant="light" color="blue">
                {leads.length} Total Leads
              </Badge>
            </Group>
          </Group>

          {/* Tab Navigation */}
          <Group gap="xs" wrap="wrap">
            <Card
              p="xs"
              radius="sm"
              withBorder
              onClick={() => setActiveTab("pipeline")}
              style={{
                cursor: "pointer",
                backgroundColor:
                  activeTab === "pipeline" ? "var(--surface-elevated)" : "transparent",
                borderColor:
                  activeTab === "pipeline"
                    ? "var(--border-strong)"
                    : "var(--border-primary)",
              }}
            >
              <Group gap="xs">
                <IconBuilding size={16} />
                <Text size="sm" fw={500}>
                  Pipeline Board
                </Text>
              </Group>
            </Card>

            <Card
              p="xs"
              radius="sm"
              withBorder
              onClick={() => setActiveTab("metrics")}
              style={{
                cursor: "pointer",
                backgroundColor:
                  activeTab === "metrics" ? "var(--surface-elevated)" : "transparent",
                borderColor:
                  activeTab === "metrics"
                    ? "var(--border-strong)"
                    : "var(--border-primary)",
              }}
            >
              <Group gap="xs">
                <IconChartBar size={16} />
                <Text size="sm" fw={500}>
                  Metrics
                </Text>
              </Group>
            </Card>

            <Card
              p="xs"
              radius="sm"
              withBorder
              onClick={() => setActiveTab("learning")}
              style={{
                cursor: "pointer",
                backgroundColor:
                  activeTab === "learning" ? "var(--surface-elevated)" : "transparent",
                borderColor:
                  activeTab === "learning"
                    ? "var(--border-strong)"
                    : "var(--border-primary)",
              }}
            >
              <Group gap="xs">
                <IconSearch size={16} />
                <Text size="sm" fw={500}>
                  Search Learning
                </Text>
              </Group>
            </Card>
          </Group>
        </Stack>
      </Paper>

      {/* Filters */}
      {activeTab === "pipeline" && (
        <Paper
          shadow="xs"
          p={{ base: "sm", sm: "md" }}
          style={{
            backgroundColor: "var(--surface-base)",
            borderBottom: "1px solid var(--border-primary)",
          }}
        >
          <Group gap="md" wrap="wrap">
            <TextInput
              placeholder="Search leads..."
              leftSection={<IconSearch size={16} />}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ flex: 1, minWidth: 200, maxWidth: 400 }}
            />

            <Select
              placeholder="Filter by region"
              value={regionFilter}
              onChange={(value) => setRegionFilter((value as any) || "ALL")}
              data={[
                { value: "ALL", label: "All Regions" },
                { value: "US", label: "US" },
                { value: "CEE", label: "CEE" },
                { value: "MENA", label: "MENA" },
              ]}
              style={{ width: 200, flexShrink: 0 }}
            />
          </Group>
        </Paper>
      )}

      {/* Column Counts */}
      {activeTab === "pipeline" && (
        <Paper
          shadow="xs"
          p={{ base: "sm", sm: "md" }}
          style={{
            backgroundColor: "var(--surface-base)",
            borderBottom: "1px solid var(--border-primary)",
          }}
        >
          <Group gap="md" wrap="wrap">
            {COLUMNS.map((col) => (
              <Group key={col.key} gap="xs" align="center">
                <Text size="sm" fw={500}>
                  {col.label}:
                </Text>
                <Badge size="sm" variant="light" color={col.color}>
                  {columnCounts(col.key)}
                </Badge>
              </Group>
            ))}
          </Group>
        </Paper>
      )}

      {/* Content */}
      <Box p={{ base: "xs", sm: "md" }} style={{ overflowX: 'hidden' }}>
        {activeTab === "pipeline" && (
          <KanbanBoard
            leads={filteredLeads}
            onMove={handleMove}
          />
        )}

        {activeTab === "metrics" && <MetricsPanel leads={filteredLeads} />}

        {activeTab === "learning" && <SearchLearningPanel />}
      </Box>
    </Box>
  );
}
