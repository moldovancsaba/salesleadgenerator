"use client";

import { useState, useEffect } from "react";
import { Stack, Group, Text, Card, Title, Loader, Alert, Paper, Badge, SimpleGrid } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { semanticToneToMantineColor } from "./utils/semantic-colors";

interface TopQuery {
  query: string;
  accepted: number;
  declined: number;
  createdLeads: number;
}

interface TopTerm {
  key: string;
  score: number;
}

interface TopDomain {
  key: string;
  score: number;
}

interface SearchLearningData {
  totalRuns: number;
  lastQueries: string[];
  updatedAt: string | null;
  topQueries: TopQuery[];
  topTerms: TopTerm[];
  topDomains: TopDomain[];
  avgSuccessRate: number;
}

export function SearchLearningPanel() {
  const [data, setData] = useState<SearchLearningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSearchLearning();
  }, []);

  const fetchSearchLearning = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/search-learning");
      if (!response.ok) throw new Error("Failed to fetch search learning data");
      
      const result = await response.json();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const getSuccessRate = (query: TopQuery) => {
    const total = query.accepted + query.declined;
    if (total === 0) return 0;
    return Math.round((query.accepted / total) * 100);
  };

  const getPerformanceColor = (rate: number) => {
    const tone = rate >= 70 ? "synthesis" : rate >= 40 ? "checklist" : "strategy";
    return semanticToneToMantineColor(tone);
  };

  if (loading) {
    return (
      <Paper p="xl" style={{ backgroundColor: "var(--mantine-color-gray-0)" }}>
        <Stack gap="md">
          <Loader size="lg" />
          <Text size="md">Loading search learning data...</Text>
        </Stack>
      </Paper>
    );
  }

  if (error) {
    return (
      <Paper p="xl">
        <Alert
          icon={<IconAlertCircle size="1rem" />}
          title="Error Loading Search Learning Data"
          color="red"
        >
          {error}
        </Alert>
      </Paper>
    );
  }

  if (!data || (data.topQueries.length === 0 && data.topTerms.length === 0 && data.topDomains.length === 0)) {
    return (
      <Stack gap="md" p="xl">
        <Title order={2}>Search Learning</Title>
        <Text>Track which search queries are producing the best results.</Text>
        <Paper
          p="xl"
          style={{
            backgroundColor: "var(--mantine-color-gray-0)",
            border: "1px solid var(--mantine-color-gray-2)",
          }}
        >
          <Text size="lg" c="dimmed" ta="center">
            No search learning data available yet
          </Text>
          <Text size="sm" c="dimmed" ta="center">
            Search queries will be tracked as you accept or decline leads in the pipeline
          </Text>
        </Paper>
      </Stack>
    );
  }

  return (
    <Stack gap="xl" p="xl">
      <Stack gap="xs">
        <Title order={2}>Search Learning</Title>
        <Text>
          Track which search queries are producing the best results. High success rates indicate valuable queries for finding leads.
        </Text>
      </Stack>

      {/* Summary Stats */}
      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <Paper
          p="md"
          style={{
            backgroundColor: "var(--mantine-color-gray-0)",
            border: "1px solid var(--mantine-color-gray-2)",
          }}
        >
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Total Search Runs
            </Text>
            <Title order={1}>{data.totalRuns}</Title>
          </Stack>
        </Paper>
        <Paper
          p="md"
          style={{
            backgroundColor: "var(--mantine-color-gray-0)",
            border: "1px solid var(--mantine-color-gray-2)",
          }}
        >
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Average Success Rate
            </Text>
            <Title order={1}>{Math.round(data.avgSuccessRate * 100)}%</Title>
          </Stack>
        </Paper>
        <Paper
          p="md"
          style={{
            backgroundColor: "var(--mantine-color-gray-0)",
            border: "1px solid var(--mantine-color-gray-2)",
          }}
        >
          <Stack gap="xs">
            <Text size="sm" c="dimmed">
              Last Updated
            </Text>
            <Text fw={600}>
              {data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : "Never"}
            </Text>
          </Stack>
        </Paper>
      </SimpleGrid>

      {/* Top Queries */}
      {data.topQueries.length > 0 && (
        <Stack gap="md">
          <Title order={3}>Top Queries</Title>
          <Stack gap="md">
            {data.topQueries.map((query, index) => {
              const successRate = getSuccessRate(query);
              const performanceColor = getPerformanceColor(successRate);

              return (
                <Paper
                  key={index}
                  p="md"
                  withBorder
                  style={{
                    transition: "box-shadow 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.boxShadow = "none";
                  }}
                >
                  <Group justify="space-between" align="flex-start" mb="md">
                    <Stack gap={4} style={{ flex: 1 }}>
                      <Text fw={600} size="lg">
                        {query.query}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {query.createdLeads} lead(s) created
                      </Text>
                    </Stack>
                    <Badge color={performanceColor} variant="light" size="md">
                      {successRate}% success
                    </Badge>
                  </Group>

                  <SimpleGrid cols={2}>
                    <Paper
                      p="md"
                      style={{
                        backgroundColor: "var(--mantine-color-green-0)",
                      }}
                    >
                      <Stack gap={4}>
                        <Title order={2} c="green">
                          {query.accepted}
                        </Title>
                        <Text size="sm" c="green">
                          Accepted
                        </Text>
                      </Stack>
                    </Paper>
                    <Paper
                      p="md"
                      style={{
                        backgroundColor: "var(--mantine-color-red-0)",
                      }}
                    >
                      <Stack gap={4}>
                        <Title order={2} c="red">
                          {query.declined}
                        </Title>
                        <Text size="sm" c="red">
                          Declined
                        </Text>
                      </Stack>
                    </Paper>
                  </SimpleGrid>
                </Paper>
              );
            })}
          </Stack>
        </Stack>
      )}

      {/* Top Terms */}
      {data.topTerms.length > 0 && (
        <Stack gap="md">
          <Title order={3}>Top Terms</Title>
          <Paper p="md" withBorder>
            <Group gap="xs" wrap="wrap">
              {data.topTerms.slice(0, 20).map((term, index) => {
                const tone = term.score >= 0.7 ? "synthesis" : term.score >= 0.4 ? "checklist" : "neutral";
                const color = semanticToneToMantineColor(tone);

                return (
                  <Badge key={index} color={color} variant="light" size="md">
                    {term.key}
                    <Text component="span" size="xs" ml={4} opacity={0.75}>
                      ({Math.round(term.score * 100)})
                    </Text>
                  </Badge>
                );
              })}
            </Group>
          </Paper>
        </Stack>
      )}

      {/* Top Domains */}
      {data.topDomains.length > 0 && (
        <Stack gap="md">
          <Title order={3}>Top Domains</Title>
          <SimpleGrid cols={{ base: 1, md: 2 }}>
            {data.topDomains.slice(0, 10).map((domain, index) => (
              <Paper key={index} p="md" withBorder>
                <Group justify="space-between">
                  <Text ff="monospace" size="sm">
                    {domain.key}
                  </Text>
                  <Text size="sm" fw={600}>
                    Score: {Math.round(domain.score * 100)}
                  </Text>
                </Group>
              </Paper>
            ))}
          </SimpleGrid>
        </Stack>
      )}

      {/* Recent Queries */}
      {data.lastQueries.length > 0 && (
        <Stack gap="md">
          <Title order={3}>Recent Queries</Title>
          <Paper p="md" withBorder>
            <Stack gap="xs">
              {data.lastQueries.slice(0, 10).map((query, index) => (
                <Text
                  key={index}
                  size="sm"
                  py={4}
                  style={{
                    borderBottom: index < data.lastQueries.length - 1 ? "1px solid var(--mantine-color-gray-2)" : "none",
                  }}
                >
                  {query}
                </Text>
              ))}
            </Stack>
          </Paper>
        </Stack>
      )}

      <Paper
        p="md"
        style={{
          backgroundColor: "var(--mantine-color-blue-0)",
          border: "1px solid var(--mantine-color-blue-2)",
        }}
      >
        <Stack gap="xs">
          <Text fw={600} c="blue">
            💡 Tips
          </Text>
          <Text size="sm">
            <ul style={{ margin: 0, paddingLeft: "1.5rem" }}>
              <li>Focus on queries with high success rates (70%+)</li>
              <li>Review queries with low success rates to refine your search strategy</li>
              <li>Use successful query patterns to discover similar opportunities</li>
              <li>Search learning data updates automatically as you accept or decline leads</li>
            </ul>
          </Text>
        </Stack>
      </Paper>
    </Stack>
  );
}
