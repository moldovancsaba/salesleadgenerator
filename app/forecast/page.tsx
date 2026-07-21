'use client';

import { useEffect, useState } from 'react';
import { Container, Title, Text, Paper, SimpleGrid, Group, Badge, Select, Loader, TextInput, Button } from '@mantine/core';
import { IconDownload } from '@tabler/icons-react';

type Forecast = {
  pipeline: Record<string, { leads: number; participants: number; rawRevenue: number; probability: number; weightedRevenue: number }>;
  totalWeightedRevenue: number;
  byTier: Record<string, { leads: number; participants: number; revenue: number }>;
  byModel: Record<string, { leads: number; revenue: number }>;
  totals: { revenue: number; participants: number };
};

export default function ForecastPage() {
  const [data, setData] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [csvUrl, setCsvUrl] = useState<string>('/api/forecast/export?format=csv');

  useEffect(() => {
    Promise.all([
      fetch('/api/stats').then((r) => r.json()),
      fetch('/api/settings').then((r) => r.json()),
    ])
      .then(([stats, settings]) => {
        const brand = stats.brands?.cogmap;
        setData(brand?.forecast || null);
        setWeights(settings.weights || {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const saveWeights = async () => {
    setSaving(true);
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ weights }),
    });
    setSaving(false);
  };

  if (loading) {
    return (
      <Container py="xl">
        <Group justify="center"><Loader /></Group>
      </Container>
    );
  }

  if (!data) {
    return (
      <Container py="xl">
        <Title order={3}>Forecast unavailable</Title>
        <Text c="dimmed">No forecast data available.</Text>
      </Container>
    );
  }

  const pipelineColumns = Object.keys(data.pipeline);

  return (
    <Container py="md">
      <Title order={2} mb="sm">CogMap Forecast</Title>
      <Group mb="md" gap="xs">
        <Select size="xs" label="Export" data={[{ value: '/api/forecast/export?format=csv', label: 'CSV' }]} value={csvUrl} onChange={(v) => v && setCsvUrl(v)} />
        <Button size="xs" variant="light" color="gray" leftSection={<IconDownload size={14} />} component="a" href={csvUrl}>
          Download
        </Button>
      </Group>

      <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} mb="lg">
        <Paper withBorder p="md" radius="md">
          <Title order={4}>Pipeline</Title>
          {pipelineColumns.map((col) => {
            const row = data.pipeline[col];
            return (
              <Group key={col} justify="space-between" py={4} style={{ borderBottom: '1px solid #eee' }}>
                <div>
                  <Text fw={500}>{col}</Text>
                  <Text size="xs" c="dimmed">{row.leads} leads · {row.participants} participants</Text>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Text fw={700}>${row.weightedRevenue.toLocaleString()}</Text>
                  <Text size="xs" c="dimmed">{Math.round(row.probability * 100)}% · raw ${row.rawRevenue.toLocaleString()}</Text>
                </div>
              </Group>
            );
          })}
          <Group justify="space-between" mt="sm">
            <Text fw={700}>Total weighted</Text>
            <Text fw={700}>${data.totalWeightedRevenue.toLocaleString()}</Text>
          </Group>
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Title order={4}>By Tier</Title>
          {Object.entries(data.byTier).map(([tier, row]) => (
            <Group key={tier} justify="space-between" py={4} style={{ borderBottom: '1px solid #eee' }}>
              <div>
                <Text fw={500} tt="capitalize">{tier}</Text>
                <Text size="xs" c="dimmed">{row.leads} leads · {row.participants} participants</Text>
              </div>
              <Text fw={700}>${row.revenue.toLocaleString()}</Text>
            </Group>
          ))}
        </Paper>

        <Paper withBorder p="md" radius="md">
          <Title order={4}>By Model</Title>
          {Object.entries(data.byModel).map(([model, row]) => (
            <Group key={model} justify="space-between" py={4} style={{ borderBottom: '1px solid #eee' }}>
              <div>
                <Text fw={500} tt="capitalize">{model.replace('_', ' ')}</Text>
                <Text size="xs" c="dimmed">{row.leads} leads</Text>
              </div>
              <Text fw={700}>${row.revenue.toLocaleString()}</Text>
            </Group>
          ))}
          <Group justify="space-between" mt="sm">
            <Text fw={700}>Total ARR</Text>
            <Text fw={700}>${data.totals.revenue.toLocaleString()}</Text>
          </Group>
          <Group justify="space-between">
            <Text c="dimmed">Participants</Text>
            <Text c="dimmed">{data.totals.participants.toLocaleString()}</Text>
          </Group>
        </Paper>
      </SimpleGrid>

      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="xs">Pipeline Weights</Title>
        <Text size="xs" c="dimmed" mb="sm">Close probability per stage.</Text>
        <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }}>
          {pipelineColumns.map((col) => (
            <TextInput
              key={col}
              label={col}
              value={String(Math.round((weights[col] ?? 0) * 100))}
              onChange={(e) => setWeights({ ...weights, [col]: Number(e.target.value) / 100 })}
              type="number"
              min={0}
              max={100}
            />
          ))}
        </SimpleGrid>
        <Button mt="sm" size="xs" onClick={saveWeights} loading={saving}>Save weights</Button>
      </Paper>
    </Container>
  );
}
