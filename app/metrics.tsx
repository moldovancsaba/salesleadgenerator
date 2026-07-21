'use client';

import { useMemo } from 'react';
import type { Lead } from './types';
import {
  Stack,
  Title,
  SimpleGrid,
  Text,
  Divider,
} from '@mantine/core';
import { InfoCard } from '@doneisbetter/gds-admin/client';

type Props = {
  leads: Lead[];
};

export function MetricsPanel({ leads }: Props) {
  const metrics = useMemo(() => {
    const columns = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST'];
    const regions = ['US', 'CEE', 'MENA'];
    const declineReasons: Record<string, number> = {};

    const columnCounts = Object.fromEntries(columns.map(c => [c, 0]));
    leads.forEach(lead => {
      if (columnCounts[lead.kanbanColumn] !== undefined) {
        columnCounts[lead.kanbanColumn]++;
      }
    });

    const regionCounts = Object.fromEntries(regions.map(r => [r, 0]));
    leads.forEach(lead => {
      const region = lead.region;
      if (region && regionCounts[region] !== undefined) {
        regionCounts[region]++;
      }
    });

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

    const buckets: Array<{ label: string; min: number; max: number; count: number; tone: string }> = [
      { label: '0-200', min: 0, max: 200, count: 0, tone: 'blue' },
      { label: '200-400', min: 200, max: 400, count: 0, tone: 'indigo' },
      { label: '400-600', min: 400, max: 600, count: 0, tone: 'green' },
      { label: '600-800', min: 600, max: 800, count: 0, tone: 'orange' },
      { label: '800+', min: 800, max: Infinity, count: 0, tone: 'teal' },
    ];

    iceScores.forEach(score => {
      const bucket = buckets.find(b => score >= b.min && score < b.max);
      if (bucket) bucket.count++;
    });

    leads.forEach(lead => {
      if (lead.declineReason) {
        declineReasons[lead.declineReason] = (declineReasons[lead.declineReason] || 0) + 1;
      }
    });

    const sortedDeclineReasons = Object.entries(declineReasons)
      .sort(([, a], [, b]) => b - a);

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

  const regionMap: Record<string, string> = { US: 'blue', CEE: 'orange', MENA: 'green' };

  return (
    <Stack gap="xl">
      <SimpleGrid cols={{ base: 1, md: 3 }}>
        <InfoCard title="Total Leads" value={String(metrics.total)} />
        <InfoCard title="Avg ICE Score" value={`${metrics.avgIce.toFixed(0)}`} description={`Median: ${metrics.medianIce}`} />
        <InfoCard title="Success Rate" value={`${metrics.successRate.toFixed(1)}%`} description="Accepted leads" />
      </SimpleGrid>

      <Stack gap="md">
        <Title order={4}>ICE Score Distribution</Title>
        <Stack gap="md">
          {metrics.buckets.map((bucket) => {
            const percentage = metrics.total > 0 ? (bucket.count / metrics.total) * 100 : 0;

            return (
              <Stack key={bucket.label} gap={4}>
                <Group justify="space-between">
                  <Text size="sm" fw={500}>{bucket.label}</Text>
                  <Text size="sm" c="dimmed">{bucket.count} leads</Text>
                </Group>
                <Progress value={percentage} color={bucket.tone} size="xl" radius="xl" />
              </Stack>
            );
          })}
        </Stack>
      </Stack>

      <Stack gap="md">
        <Title order={4}>Pipeline Distribution</Title>
        <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} spacing="md">
          {Object.entries(metrics.columnCounts).map(([column, count]) => {
            const tone = column === 'WON' ? 'teal' : column === 'LOST' ? 'red' : 'indigo';
            const percentage = metrics.total > 0 ? (count / metrics.total) * 100 : 0;

            return (
              <InfoCard
                key={column}
                title={column}
                value={String(count)}
                description={`${percentage.toFixed(1)}%`}
              />
            );
          })}
        </SimpleGrid>
      </Stack>

      <Stack gap="md">
        <Title order={4}>Quality Status</Title>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
          {Object.entries(metrics.qualityCounts).map(([status, count]) => {
            const color = status === 'VERIFIED' ? 'teal' : status === 'CHECKED' ? 'orange' : 'gray';
            return (
              <InfoCard
                key={status}
                title={status}
                value={String(count)}
              />
            );
          })}
        </SimpleGrid>
      </Stack>

      {metrics.sortedDeclineReasons.length > 0 && (
        <Stack gap="md">
          <Title order={4}>Decline Reasons</Title>
          <Stack gap={0}><Divider color="gray.2" />{metrics.sortedDeclineReasons.map(([reason, count]) => (
              <Group key={reason} justify="space-between" py="xs">
                <Text size="sm">{reason.replace(/_/g, ' ')}</Text>
                <Text c="red" size="sm" fw={600}>{count}</Text>
              </Group>
            ))}</Stack>
        </Stack>
      )}

      <Stack gap="md">
        <Title order={4}>Regional Breakdown</Title>
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
          {Object.entries(metrics.regionCounts).map(([region, count]) => {
            const color = regionMap[region] || 'gray';
            const percentage = metrics.total > 0 ? (count / metrics.total) * 100 : 0;

            return (
              <InfoCard
                key={region}
                title={region}
                value={String(count)}
                description={`${percentage.toFixed(1)}% of total`}
              />
            );
          })}
        </SimpleGrid>
      </Stack>
    </Stack>
  );
}
