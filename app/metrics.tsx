/**
 * Metrics Dashboard
 * Shows overall pipeline health, ICE score distribution, regional breakdowns
 * Uses GDS semantic tokens for all colors
 */

"use client";

import { useMemo } from "react";
import type { Lead } from "./types";
import {
  Paper,
  Text,
  Stack,
  Grid,
  Progress,
  Badge,
  RingProgress,
  Group,
  Title,
  Card,
  SimpleGrid,
} from "@mantine/core";
import {
  IconTrendingUp,
  IconUsers,
  IconWorld,
  IconCircleCheck,
  IconAlertCircle,
  IconClock,
} from "@tabler/icons-react";
import { semanticToneToMantineColor, qualityStatusToMantineColor, regionToMantineColor } from "./utils/semantic-colors";

type Props = {
  leads: Lead[];
};

export function MetricsPanel({ leads }: Props) {
  const metrics = useMemo(() => {
    const columns = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST'];
    const regions = ['US', 'CEE', 'MENA'];
    const declineReasons: Record<string, number> = {};

    // Column distribution
    const columnCounts = Object.fromEntries(columns.map(c => [c, 0]));
    leads.forEach(lead => {
      if (columnCounts[lead.kanbanColumn] !== undefined) {
        columnCounts[lead.kanbanColumn]++;
      }
    });

    // Regional distribution
    const regionCounts = Object.fromEntries(regions.map(r => [r, 0]));
    leads.forEach(lead => {
      const region = lead.region;
      if (region && regionCounts[region] !== undefined) {
        regionCounts[region]++;
      }
    });

    // ICE score distribution
    const iceScores = leads
      .map(lead => {
        if (!lead.ice) return null;
        const { impact = 0, confidence = 0, ease = 0 } = lead.ice;
        return impact * confidence * ease;
      })
      .filter((score): score is number => score !== null)
      .sort((a, b) => a - b);

    const avgIce = iceScores.length > 0
      ? iceScores.reduce((sum, s) => sum + s, 0) / iceScores.length
      : 0;

    const medianIce = iceScores.length > 0
      ? iceScores[Math.floor(iceScores.length / 2)]
      : 0;

    // ICE score buckets
    const buckets: Array<{ label: string; min: number; max: number; count: number; tone: import('./theme/semantic').SemanticTone }> = [
      { label: '0-200', min: 0, max: 200, count: 0, tone: 'ingress' },
      { label: '200-400', min: 200, max: 400, count: 0, tone: 'synthesis' },
      { label: '400-600', min: 400, max: 600, count: 0, tone: 'checklist' },
      { label: '600-800', min: 600, max: 800, count: 0, tone: 'tactical' },
      { label: '800+', min: 800, max: Infinity, count: 0, tone: 'review' },
    ];

    iceScores.forEach(score => {
      const bucket = buckets.find(b => score >= b.min && score < b.max);
      if (bucket) bucket.count++;
    });

    // Decline reasons
    leads.forEach(lead => {
      if (lead.declineReason) {
        declineReasons[lead.declineReason] = (declineReasons[lead.declineReason] || 0) + 1;
      }
    });

    const sortedDeclineReasons = Object.entries(declineReasons)
      .sort(([, a], [, b]) => b - a);

    // Quality distribution
    const qualityCounts = { VERIFIED: 0, CHECKED: 0, DRAFT: 0 };
    leads.forEach(lead => {
      const quality = lead.qualityStatus || 'DRAFT';
      if (quality === 'VERIFIED') qualityCounts.VERIFIED++;
      else if (quality === 'CHECKED') qualityCounts.CHECKED++;
      else qualityCounts.DRAFT++;
    });

    const totalWithFeedback = leads.filter(l => 
      l.acceptanceCount > 0 || l.declineCount > 0
    ).length;

    const successRate = totalWithFeedback > 0 
      ? (qualityCounts.VERIFIED + qualityCounts.CHECKED) / totalWithFeedback * 100 
      : 0;

    return {
      total: leads.length,
      columnCounts,
      regionCounts,
      avgIce,
      medianIce,
      buckets,
      sortedDeclineReasons,
      qualityCounts,
      successRate,
    };
  }, [leads]);

  const regionTones = {
    US: regionToMantineColor('US'),
    CEE: regionToMantineColor('CEE'),
    MENA: regionToMantineColor('MENA'),
  };

  return (
    <Stack gap="xl">
      {/* Overview Cards */}
      <Grid>
        <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
          <Card withBorder p="xl" radius="md">
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Total Leads
                </Text>
                <IconUsers size={20} color="var(--mantine-color-gray-6)" />
              </Group>
              <Text size="xl" fw={700}>{metrics.total}</Text>
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
          <Card withBorder p="xl" radius="md">
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Avg ICE Score
                </Text>
                <IconTrendingUp size={20} color="var(--mantine-color-blue-6)" />
              </Group>
              <Stack gap={0}>
                <Text size="xl" fw={700}>{metrics.avgIce.toFixed(0)}</Text>
                <Text size="xs" c="dimmed">Median: {metrics.medianIce}</Text>
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
          <Card withBorder p="xl" radius="md">
            <Stack gap="xs">
              <Group justify="space-between">
                <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                  Success Rate
                </Text>
                <IconCircleCheck size={20} color="var(--mantine-color-green-6)" />
              </Group>
              <Stack gap={0}>
                <Text size="xl" fw={700}>{metrics.successRate.toFixed(1)}%</Text>
                <Text size="xs" c="dimmed">Accepted leads</Text>
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6, lg: 3 }}>
          <Card withBorder p="xl" radius="md">
            <Stack gap="xs">
              <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={4}>
                Regional Split
              </Text>
              <SimpleGrid cols={1} spacing="xs">
                {Object.entries(metrics.regionCounts).map(([region, count]) => (
                  <Group key={region} justify="space-between">
                    <Group gap="xs">
                      <Badge color={regionTones[region as keyof typeof regionTones]} variant="light" size="sm">
                        {region}
                      </Badge>
                    </Group>
                    <Text size="sm" fw={600}>{count}</Text>
                  </Group>
                ))}
              </SimpleGrid>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>

      {/* ICE Score Distribution */}
      <Paper withBorder p="xl" radius="md">
        <Stack gap="md">
          <Title order={4}>ICE Score Distribution</Title>
          <Stack gap="md">
            {metrics.buckets.map((bucket) => {
              const percentage = metrics.total > 0 ? (bucket.count / metrics.total) * 100 : 0;
              const color = semanticToneToMantineColor(bucket.tone);

              return (
                <Stack key={bucket.label} gap={4}>
                  <Group justify="space-between">
                    <Text size="sm" fw={500}>{bucket.label}</Text>
                    <Text size="sm" c="dimmed">{bucket.count} leads</Text>
                  </Group>
                  <Progress value={percentage} color={color} size="xl" radius="xl" />
                </Stack>
              );
            })}
          </Stack>
        </Stack>
      </Paper>

      {/* Pipeline Distribution */}
      <Paper withBorder p="xl" radius="md">
        <Stack gap="md">
          <Title order={4}>Pipeline Distribution</Title>
          <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="md">
            {Object.entries(metrics.columnCounts).map(([column, count]) => {
              const tone = column === 'WON' ? 'tactical' : column === 'LOST' ? 'strategy' : 'ingress';
              const color = semanticToneToMantineColor(tone);
              const percentage = metrics.total > 0 ? (count / metrics.total) * 100 : 0;

              return (
                <Card key={column} withBorder p="md" radius="md">
                  <Stack gap="xs">
                    <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                      {column}
                    </Text>
                    <Text size="xl" fw={700}>{count}</Text>
                    <Text size="xs" c="dimmed">
                      {percentage.toFixed(1)}%
                    </Text>
                    <Progress value={percentage} color={color} size="sm" />
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        </Stack>
      </Paper>

      {/* Quality Status */}
      <Paper withBorder p="xl" radius="md">
        <Stack gap="md">
          <Title order={4}>Quality Status</Title>
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
            {Object.entries(metrics.qualityCounts).map(([status, count]) => {
              const color = qualityStatusToMantineColor(status);
              return (
                <Card key={status} withBorder p="md" radius="md">
                  <Stack gap="xs" align="center">
                    <Badge color={color} variant="light" size="lg">
                      {status}
                    </Badge>
                    <Text size="xl" fw={700}>{count}</Text>
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        </Stack>
      </Paper>

      {/* Decline Reasons */}
      {metrics.sortedDeclineReasons.length > 0 && (
        <Paper withBorder p="xl" radius="md">
          <Stack gap="md">
            <Title order={4}>Decline Reasons</Title>
            <Stack gap="xs">
              {metrics.sortedDeclineReasons.map(([reason, count]) => (
                <Group key={reason} justify="space-between" py="xs" style={{ borderBottom: '1px solid var(--mantine-color-gray-2)' }}>
                  <Text size="sm">{reason.replace(/_/g, ' ')}</Text>
                  <Badge color="red" variant="light">
                    {count}
                  </Badge>
                </Group>
              ))}
            </Stack>
          </Stack>
        </Paper>
      )}

      {/* Regional Breakdown */}
      <Paper withBorder p="xl" radius="md">
        <Stack gap="md">
          <Title order={4}>Regional Breakdown</Title>
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
            {Object.entries(metrics.regionCounts).map(([region, count]) => {
              const color = regionTones[region as keyof typeof regionTones];
              const percentage = metrics.total > 0 ? (count / metrics.total) * 100 : 0;

              return (
                <Card key={region} withBorder p="md" radius="md">
                  <Stack gap="xs">
                    <Group justify="space-between">
                      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                        {region}
                      </Text>
                      <Badge color={color} variant="light">
                        {count}
                      </Badge>
                    </Group>
                    <Text size="xl" fw={700}>{count}</Text>
                    <Text size="xs" c="dimmed">
                      {percentage.toFixed(1)}% of total
                    </Text>
                    <Progress value={percentage} color={color} size="sm" />
                  </Stack>
                </Card>
              );
            })}
          </SimpleGrid>
        </Stack>
      </Paper>
    </Stack>
  );
}
