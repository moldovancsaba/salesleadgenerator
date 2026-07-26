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
import { AdvancedDataTable, EmptyState, GdsSegmentedControl, PeriodSelector } from '@sovereignsquad/gds-core/client';

type DeclineReasonRow = {
  declineReason: string;
  dimensionValue: string;
  count: number;
};

type DeclineReasonRollupData = {
  groupBy: 'none' | 'industry' | 'sport_or_sector' | 'region';
  totalDeclines: number;
  rows?: DeclineReasonRow[];
  totalsByReason: Array<[string, number]>;
  missingDimensionCount: number;
};

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

type IndustryCorrelation = {
  industry: string;
  sampleSize: number;
  weightedWonRate: number | null;
};

type SearchQueryCorrelation = {
  query: string;
  sampleSize: number;
  acceptRate: number | null;
};

type OutcomeCorrelation = {
  byIndustry: IndustryCorrelation[];
  bySearchQuery: SearchQueryCorrelation[];
  truncated: boolean;
  searchQueryDataIsGlobal: boolean;
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
  outcomeCorrelation: OutcomeCorrelation | null;
};

// A transition pair with fewer than 3 samples renders "—" rather than an
// averaged number that would read as more statistically meaningful than it
// actually is.
const MIN_DISPLAYABLE_SAMPLE = 3;

type Props = {
  brand?: string;
  tenantId?: string;
};

const GROUP_BY_OPTIONS = [
  { value: 'none', label: 'All' },
  { value: 'industry', label: 'Industry' },
  { value: 'sport_or_sector', label: 'Sport/Sector' },
  { value: 'region', label: 'Region' },
] as const;

const GROUP_BY_LABEL: Record<string, string> = {
  industry: 'industry',
  sport_or_sector: 'sport/sector',
  region: 'region',
};

const PERIOD_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'quarter', label: 'This quarter' },
];

function periodToRange(period: string): { from?: string } {
  const now = new Date();
  if (period === '30d') return { from: new Date(now.getTime() - 30 * 86_400_000).toISOString() };
  if (period === '90d') return { from: new Date(now.getTime() - 90 * 86_400_000).toISOString() };
  if (period === 'quarter') {
    const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
    return { from: new Date(Date.UTC(now.getFullYear(), quarterStartMonth, 1)).toISOString() };
  }
  return {};
}

// Cross-tabbed decline-reason rollup (issue #63): its own groupBy/period
// controls and fetch, independent of MetricsPanel's single all-brand-metrics
// call — mirrors "this month vs. last quarter" reporting needs that a single
// flat, all-time aggregate can't answer.
function DeclineReasonRollup({ brand, tenantId }: { brand: string; tenantId: string }) {
  const [groupBy, setGroupBy] = useState<string>('none');
  const [period, setPeriod] = useState('all');
  const [data, setData] = useState<DeclineReasonRollupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const { from } = periodToRange(period);
    const params = new URLSearchParams({ brand, tenantId, groupBy });
    if (from) params.set('from', from);

    fetch(`/api/metrics/decline-reasons?${params.toString()}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json.error) setError(json.error);
        else setData(json);
      })
      .catch(() => {
        if (!cancelled) setError('Failed to load decline reason rollup');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [brand, tenantId, groupBy, period]);

  return (
    <Stack gap="md">
      <Group justify="space-between" wrap="wrap" align="flex-end">
        <Title order={4}>Decline Reasons</Title>
        <Group gap="sm" wrap="wrap">
          <GdsSegmentedControl
            value={groupBy}
            onChange={setGroupBy}
            options={[...GROUP_BY_OPTIONS]}
            ariaLabel="Group decline reasons by"
          />
          <PeriodSelector
            label="Period"
            value={period}
            options={PERIOD_OPTIONS}
            onChange={setPeriod}
          />
        </Group>
      </Group>

      {loading ? (
        <Group justify="center" py="md"><Loader size="sm" /></Group>
      ) : error ? (
        <Alert icon={<IconAlertCircle size="1rem" />} title="Decline reasons unavailable" color="red">{error}</Alert>
      ) : !data || data.totalDeclines === 0 ? (
        <EmptyState title="No declines yet" description="Decline-reason data will appear here once leads are declined." />
      ) : groupBy === 'none' ? (
        <Stack gap={0}>
          <Divider color="gray.2" />
          {data.totalsByReason.map(([reason, count]) => (
            <Group key={reason} justify="space-between" py="xs">
              <Text size="sm">{reason.replace(/_/g, ' ')}</Text>
              <Text c="red" size="sm" fw={600}>{count}</Text>
            </Group>
          ))}
        </Stack>
      ) : (
        <>
          <AdvancedDataTable
            rows={data.rows || []}
            rowId={(row, i) => `${row.declineReason}-${row.dimensionValue}-${i}`}
            columns={[
              { key: 'declineReason', label: 'Reason', sortable: true, render: (row) => row.declineReason.replace(/_/g, ' ') },
              { key: 'dimensionValue', label: 'Dimension', sortable: true },
              { key: 'count', label: 'Count', sortable: true },
            ]}
          />
          {data.missingDimensionCount > 0 && (
            <Text size="xs" c="dimmed">
              {data.missingDimensionCount} decline{data.missingDimensionCount === 1 ? '' : 's'} excluded — missing {GROUP_BY_LABEL[groupBy] || groupBy} data.
            </Text>
          )}
        </>
      )}
    </Stack>
  );
}

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

      <DeclineReasonRollup brand={brand} tenantId={tenantId} />

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

      <Stack gap="md">
        <Title order={4}>What Worked — Outcome Correlation</Title>
        {!data.outcomeCorrelation ? (
          <Alert icon={<IconAlertCircle size="1rem" />} title="Outcome correlation unavailable" color="gray" variant="light">
            Could not compute outcome correlation right now — the rest of this page is unaffected.
          </Alert>
        ) : (
          <>
            {data.outcomeCorrelation.truncated && (
              <Alert icon={<IconAlertCircle size="1rem" />} color="yellow" variant="light">
                Too many outcome-log rows to scan in one request — results reflect a partial (truncated) sample.
              </Alert>
            )}

            <Text size="sm" fw={600}>By industry (WON/LOST outcomes, weighted by signal confidence)</Text>
            {data.outcomeCorrelation.byIndustry.length === 0 ? (
              <AdminResourceEmptyState
                title="No WON/LOST outcomes yet"
                description="This report needs at least one lead to reach WON or LOST."
              />
            ) : (
              <AdminAnalyticsTable
                rows={data.outcomeCorrelation.byIndustry}
                getRowKey={(row) => row.industry}
                columns={[
                  { key: 'industry', header: 'Industry', rowHeader: true, accessor: (row) => row.industry },
                  { key: 'sampleSize', header: 'Samples', numeric: true, accessor: (row) => String(row.sampleSize) },
                  {
                    key: 'weightedWonRate',
                    header: 'Won rate',
                    numeric: true,
                    accessor: (row) => (row.weightedWonRate === null ? 'Insufficient data' : `${(row.weightedWonRate * 100).toFixed(1)}%`),
                  },
                ]}
              />
            )}

            <Text size="sm" fw={600} mt="sm">
              By search query (accept rate — global across all brands, not brand-scoped)
            </Text>
            {data.outcomeCorrelation.bySearchQuery.length === 0 ? (
              <AdminResourceEmptyState
                title="No search-learning data recorded yet"
                description="Search-query accept/decline outcomes will appear here once recorded."
              />
            ) : (
              <AdminAnalyticsTable
                rows={data.outcomeCorrelation.bySearchQuery}
                getRowKey={(row) => row.query}
                columns={[
                  { key: 'query', header: 'Search query', rowHeader: true, accessor: (row) => row.query },
                  { key: 'sampleSize', header: 'Samples', numeric: true, accessor: (row) => String(row.sampleSize) },
                  {
                    key: 'acceptRate',
                    header: 'Accept rate',
                    numeric: true,
                    accessor: (row) => (row.acceptRate === null ? 'Insufficient data' : `${(row.acceptRate * 100).toFixed(1)}%`),
                  },
                ]}
              />
            )}
          </>
        )}
      </Stack>
    </Stack>
  )
}
