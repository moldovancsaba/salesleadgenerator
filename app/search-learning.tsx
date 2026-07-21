"use client";

import { useState, useEffect } from "react";
import { Stack, Group, Text, Title, Loader, Alert, Paper, Badge, SimpleGrid } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import { AdminResourceCard, InfoCard } from "@doneisbetter/gds-admin/client";

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
    return rate >= 70 ? 'green' : rate >= 40 ? 'orange' : 'red';
  };

  if (loading) {
    return (
      <Paper p="xl">
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
        <Paper p="xl" withBorder>
          <Stack gap="xs">
            <Text size="lg" c="dimmed" ta="center">
              No search learning data available yet
            </Text>
            <Text size="sm" c="dimmed" ta="center">
              Search queries will be tracked as you accept or decline leads in the pipeline
            </Text>
          </Stack>
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

      <SimpleGrid cols={{ base: 1, sm: 3 }}>
        <InfoCard title="Total Search Runs" value={String(data.totalRuns)} />
        <InfoCard title="Average Success Rate" value={`${Math.round(data.avgSuccessRate * 100)}%`} />
        <InfoCard title="Last Updated" value={data.updatedAt ? new Date(data.updatedAt).toLocaleDateString() : "Never"} />
      </SimpleGrid>

      {data.topQueries.length > 0 && (
        <Stack gap="md">
          <Title order={3}>Top Queries</Title>
          <Stack gap="md">
            {data.topQueries.map((query, index) => {
              const successRate = getSuccessRate(query);

              return (
                <AdminResourceCard
                  key={index}
                  record={{
                    id: String(index),
                    title: query.query,
                    description: `Accepted: ${query.accepted}, Declined: ${query.declined}, Success: ${successRate}%`,
                    status: `${successRate}%`,
                  } as any}
                  actions={[]}
                />
              );
            })}
          </Stack>
        </Stack>
      )}

      {data.topTerms.length > 0 && (
        <Stack gap="md">
          <Title order={3}>Top Terms</Title>
          <Paper p="md" withBorder>
            <Group gap="xs" wrap="wrap">
              {data.topTerms.slice(0, 20).map((term, index) => {
                const color = term.score >= 0.7 ? 'green' : term.score >= 0.4 ? 'orange' : 'gray';

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

      {data.lastQueries.length > 0 && (
        <Stack gap="md">
          <Title order={3}>Recent Queries</Title>
          <Paper p="md" withBorder>
            <Stack gap="xs">
              {data.lastQueries.slice(0, 10).map((query, index) => (
                <Text key={index} size="sm" py={4} style={{ borderBottom: index < data.lastQueries.length - 1 ? "1px solid var(--mantine-color-gray-2)" : "none" }}>
                  {query}
                </Text>
              ))}
            </Stack>
          </Paper>
        </Stack>
      )}
    </Stack>
  );
}
