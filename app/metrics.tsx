'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Stack,
  Title,
  SimpleGrid,
  Text,
  Divider,
  Group,
  Progress,
  Loader,
  Alert,
  Badge,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { InfoCard, StatsStrip, AdminAnalyticsTable, AdminResourceEmptyState } from '@sovereignsquad/gds-admin/client';

type VelocityTransitionStat = {
  from: string;
  to: string;
  avgDays: number | null;
  medianDays: number | null;
  sampleSize: number;
  priorPeriodAvgDays: number | null;
  trendPct: number | null;
};

type VelocityMetrics = {
  transitions: VelocityTransitionStat[];
  avgTimeInStage: Record<string, number | null>;
  periodDays: number;
  insufficientData: boolean;
  truncated: boolean;
};

type MetricsData = {
  total: number;
  columnCounts: Record<string, number>;
  regionCounts: Record<string, number>;
  avgIce: number;
  medianIce: number;
  buckets: Array<{ label: string; min: number; max: number; count: number }>;
  sortedDeclineReasons: Array<[string, number]>;
  qualityCounts: Record<string, number>;
  successRate: number;
  velocity: VelocityMetrics | null;
};

// A transition pair with fewer than 3 samples renders "—" rather than an
// averaged number that would read as more statistically meaningful than it
// actually is.
const MIN_DISPLAYABLE_SAMPLE = 3;

type Props = {
  brand?: string;
  tenantId?: string;
};

export function MetricsPanel({ brand = 'cogmap', tenantId = 'default' }: Props) {
  const [data, setData] = useState<MetricsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch(`/api/metrics?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`)
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) {
          if (json.error) {
            setError(json.error)
          } else if (json.metrics) {
            setData(json.metrics)
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load metrics')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [brand, tenantId])

  if (loading) {
    return (
      <Stack gap="md">
        <Loader size="lg" />
        <Text>Loading metrics…</Text>
      </Stack>
    )
  }

  if (error || !data) {
    return (
      <Alert icon={<IconAlertCircle size="1rem" />} title="Metrics unavailable" color="red">
        {error || 'No metrics data available.'}
      </Alert>
    )
  }

  const regionMap: Record<string, string> = { US: 'blue', CEE: 'orange', MENA: 'green' }

  return (
    <Stack gap="xl">
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <InfoCard title="Total Leads" value={String(data.total)} />
        <InfoCard title="Avg ICE Score" value={`${data.avgIce.toFixed(0)}`} description={`Median: ${data.medianIce}`} />
        <InfoCard title="Success Rate" value={`${data.successRate.toFixed(1)}%`} description="Accepted leads" />
      </SimpleGrid>

      <Stack gap="md">
        <Title order={4}>ICE Score Distribution</Title>
        <Stack gap="md">
          {data.buckets.map((bucket) => {
            const percentage = data.total > 0 ? (bucket.count / data.total) * 100 : 0

            return (
              <Stack key={bucket.label} gap={4}>
                <Group justify="space-between">
                  <Text size="sm" fw={500}>{bucket.label}</Text>
                  <Text size="sm" c="dimmed">{bucket.count} leads</Text>
                </Group>
                <Progress
                  value={percentage}
                  color={bucket.label.includes('800') ? 'teal' : bucket.label.includes('600') ? 'orange' : 'indigo'}
                  size="xl"
                  radius="xl"
                />
              </Stack>
            )
          })}
        </Stack>
      </Stack>

      <Stack gap="md">
        <Title order={4}>Pipeline Distribution</Title>
        <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="md">
          {Object.entries(data.columnCounts).map(([column, count]) => {
            const tone = column === 'WON' ? 'teal' : column === 'LOST' ? 'red' : 'indigo'
            const percentage = data.total > 0 ? (count / data.total) * 100 : 0

            return (
              <InfoCard
                key={column}
                title={column}
                value={String(count)}
                description={`${percentage.toFixed(1)}%`}
              />
            )
          })}
        </SimpleGrid>
      </Stack>

      <Stack gap="md">
        <Title order={4}>Quality Status</Title>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
          {Object.entries(data.qualityCounts).map(([status, count]) => {
            const color = status === 'VERIFIED' ? 'teal' : status === 'CHECKED' ? 'orange' : 'gray'
            return (
              <InfoCard
                key={status}
                title={status}
                value={String(count)}
              />
            )
          })}
        </SimpleGrid>
      </Stack>

      {data.sortedDeclineReasons.length > 0 && (
        <Stack gap="md">
          <Title order={4}>Decline Reasons</Title>
          <Stack gap={0}>
            <Divider color="gray.2" />
            {data.sortedDeclineReasons.map(([reason, count]) => (
              <Group key={reason} justify="space-between" py="xs">
                <Text size="sm">{reason.replace(/_/g, ' ')}</Text>
                <Text c="red" size="sm" fw={600}>{count}</Text>
              </Group>
            ))}
          </Stack>
        </Stack>
      )}

      <Stack gap="md">
        <Title order={4}>Regional Breakdown</Title>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
          {Object.entries(data.regionCounts).map(([region, count]) => {
            const color = regionMap[region] || 'gray'
            const percentage = data.total > 0 ? (count / data.total) * 100 : 0

            return (
              <InfoCard
                key={region}
                title={region}
                value={String(count)}
                description={`${percentage.toFixed(1)}% of total`}
              />
            )
          })}
        </SimpleGrid>
      </Stack>

      <Stack gap="md">
        <Title order={4}>Pipeline Velocity</Title>
        {!data.velocity ? (
          <Alert icon={<IconAlertCircle size="1rem" />} title="Velocity metrics unavailable" color="gray" variant="light">
            Could not compute stage-to-stage timing right now — the rest of this page is unaffected.
          </Alert>
        ) : data.velocity.transitions.length === 0 ? (
          <AdminResourceEmptyState
            title="No stage transitions yet"
            description="Velocity metrics need at least one recorded kanban-column change."
          />
        ) : (
          <>
            {data.velocity.insufficientData && (
              <Alert icon={<IconAlertCircle size="1rem" />} color="yellow" variant="light">
                Limited data collected so far — figures below may not be statistically meaningful yet.
              </Alert>
            )}
            {data.velocity.truncated && (
              <Alert icon={<IconAlertCircle size="1rem" />} color="yellow" variant="light">
                Too many outcome-log rows to scan in one request — results reflect a partial (truncated) sample.
              </Alert>
            )}
            {Object.keys(data.velocity.avgTimeInStage).length > 0 && (
              <StatsStrip
                stats={Object.entries(data.velocity.avgTimeInStage)
                  .filter(([, avgDays]) => avgDays !== null)
                  .map(([stage, avgDays]) => ({
                    label: `Avg time in ${stage}`,
                    value: `${(avgDays as number).toFixed(1)}d`,
                  }))}
              />
            )}
            <AdminAnalyticsTable
              rows={data.velocity.transitions}
              getRowKey={(row) => `${row.from}->${row.to}`}
              columns={[
                {
                  key: 'transition',
                  header: 'Transition',
                  rowHeader: true,
                  accessor: (row) => `${row.from} → ${row.to}`,
                },
                {
                  key: 'avgDays',
                  header: 'Avg days',
                  numeric: true,
                  accessor: (row) => (row.sampleSize < MIN_DISPLAYABLE_SAMPLE || row.avgDays === null ? '—' : row.avgDays.toFixed(1)),
                },
                {
                  key: 'medianDays',
                  header: 'Median days',
                  numeric: true,
                  accessor: (row) => (row.sampleSize < MIN_DISPLAYABLE_SAMPLE || row.medianDays === null ? '—' : row.medianDays.toFixed(1)),
                },
                {
                  key: 'sampleSize',
                  header: 'Samples',
                  numeric: true,
                  accessor: (row) => String(row.sampleSize),
                },
                {
                  key: 'trend',
                  header: `Trend vs. prior ${data.velocity!.periodDays}d`,
                  accessor: (row) => {
                    if (row.trendPct === null || row.sampleSize < MIN_DISPLAYABLE_SAMPLE) return '—';
                    // Faster (lower avgDays) is an improvement, so a negative
                    // trendPct renders in teal — but the sign and number are
                    // always shown as text alongside the color, never color alone.
                    const improving = row.trendPct < 0;
                    const sign = row.trendPct > 0 ? '+' : '';
                    return (
                      <Text size="sm" c={improving ? 'teal' : 'red'} fw={600}>
                        {sign}{row.trendPct.toFixed(0)}%
                      </Text>
                    );
                  },
                },
              ]}
            />
          </>
        )}
      </Stack>
    </Stack>
  )
}
