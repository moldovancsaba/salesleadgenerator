'use client';

import { useState, useEffect, useCallback } from 'react';
import { Container, Title, Text, Paper, SimpleGrid, Group, Badge, Select, TextInput, Loader, Alert, Button } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';

type Forecast = {
  pipeline?: Record<string, { leads: number; participants: number; rawRevenue: number; probability: number; weightedRevenue: number }>;
  totalWeightedRevenue?: number;
  byTier?: Record<string, { leads: number; participants: number; revenue: number }>;
  byModel?: Record<string, { leads: number; revenue: number }>;
  totals?: { revenue: number; participants: number };
  byCompany?: Array<{ company: string; leads: number; currency: string; upfrontEur: number; monthlyEur: number; annualFeeEur: number; revenueSharePercent: number; discountPercent: number; estimatedAnnualValueEur: number }>;
  totalEstimatedAnnualValueEur?: number;
};

export default function ForecastPage() {
  const [brand, setBrand] = useState<string>('cogmap');
  const [data, setData] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadForecast = useCallback(async (brandKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const tenantId = brandKey === 'cogmap' ? 'cogmap' : 'seyu';
      const [boardRes, settingsRes] = await Promise.all([
        fetch(`/api/boards/${encodeURIComponent(brandKey)}?tenantId=${encodeURIComponent(tenantId)}`),
        fetch('/api/settings'),
      ]);

      if (!boardRes.ok) throw new Error(`Board API: ${boardRes.status}`);
      if (!settingsRes.ok) throw new Error(`Settings API: ${settingsRes.status}`);

      const boardJson = await boardRes.json();
      const settingsJson = await settingsRes.json();

      if (boardJson.error) throw new Error(boardJson.error);

      setData(boardJson.forecast || null);
      setWeights(settingsJson.weights || {});
    } catch (err: any) {
      setError(err?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadForecast(brand);
  }, [brand, loadForecast]);

  const saveWeights = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weights }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      await res.json().catch(() => ({}));
    } catch (err: any) {
      console.error('Weights save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const downloadCsv = () => {
    const tenantId = brand === 'cogmap' ? 'cogmap' : 'seyu';
    const url = brand === 'cogmap'
      ? `/api/forecast/export?format=csv&tenantId=cogmap`
      : `/api/forecast/export?format=csv&tenantId=${tenantId}`;
    window.open(url, '_blank');
  };

  if (loading) {
    return (
      <Container py="xl">
        <Group justify="center"><Loader /></Group>
      </Container>
    );
  }

  if (error || !data) {
    return (
      <Container py="xl">
        <Title order={3}>Forecast unavailable</Title>
        {error ? <Text c="red">Last error: {error}</Text> : <Text c="dimmed">No forecast data available.</Text>}
      </Container>
    );
  }

  const isSeyu = brand === 'seyu';
  const pipelineColumns = Object.keys(data.pipeline || {});

  return (
    <Container py="md">
      <Group justify="space-between" mb="md">
        <Title order={2}>{isSeyu ? 'Seyu Forecast' : 'CogMap Forecast'}</Title>
        <Group gap="xs">
          <Select
            size="xs"
            data={[
              { value: 'cogmap', label: 'CogMap' },
              { value: 'seyu', label: 'Seyu' },
            ]}
            value={brand}
            onChange={(v) => v && setBrand(v)}
          />
          <Button
            size="xs"
            variant="light"
            color="gray"
            onClick={downloadCsv}
          >
            Export CSV
          </Button>
        </Group>
      </Group>

      {isSeyu ? (
        <Paper withBorder p="md" radius="md" mb="lg">
          <Title order={4}>Pricing by Company</Title>
          <Text size="xs" c="dimmed" mb="sm">Annualized value = max(annual fee, monthly × 12 + upfront).</Text>
          {!data.byCompany || data.byCompany.length === 0 ? (
            <Text c="dimmed">No company-specific pricing stored yet.</Text>
          ) : (
            <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} mt="sm">
              {(data.byCompany || []).map((row) => (
                <Paper key={row.company} withBorder p="sm" radius="sm">
                  <Group justify="space-between">
                    <Text fw={600}>{row.company}</Text>
                    <Badge variant="light">{row.currency}</Badge>
                  </Group>
                  <Text size="xs" c="dimmed">{row.leads} leads</Text>
                  <SimpleGrid cols={{ base: 2 }} spacing="xs" mt="xs">
                    <Text size="xs">Upfront</Text>
                    <Text size="xs" fw={600}>{row.upfrontEur.toLocaleString()}</Text>
                    <Text size="xs">Monthly</Text>
                    <Text size="xs" fw={600}>{row.monthlyEur.toLocaleString()}</Text>
                    <Text size="xs">Annual fee</Text>
                    <Text size="xs" fw={600}>{row.annualFeeEur.toLocaleString()}</Text>
                    <Text size="xs">Revenue share</Text>
                    <Text size="xs" fw={600}>{row.revenueSharePercent}%</Text>
                    <Text size="xs">Discount</Text>
                    <Text size="xs" fw={600}>{row.discountPercent}%</Text>
                    <Text size="xs">Est. annual</Text>
                    <Text size="xs" fw={700}>{row.estimatedAnnualValueEur.toLocaleString()}</Text>
                  </SimpleGrid>
                </Paper>
              ))}
            </SimpleGrid>
          )}
          <Group justify="space-between" mt="md">
            <Text fw={700}>Total estimated annual value</Text>
            <Text fw={700}>{((data.totalEstimatedAnnualValueEur || 0) as number).toLocaleString()}</Text>
          </Group>
        </Paper>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2, lg: 3 }} mb="lg">
          <Paper withBorder p="md" radius="md">
            <Title order={4}>Pipeline</Title>
            {pipelineColumns.map((col) => {
              const raw = data.pipeline![col];
              if (!raw) return null;
              return (
                <Group key={col} justify="space-between" py={4} style={{ borderBottom: '1px solid #eee' }}>
                  <div>
                    <Text fw={500}>{col}</Text>
                    <Text size="xs" c="dimmed">{raw.leads} leads · {raw.participants} participants</Text>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Text fw={700}>${raw.weightedRevenue.toLocaleString()}</Text>
                    <Text size="xs" c="dimmed">{Math.round(raw.probability * 100)}% · raw ${raw.rawRevenue.toLocaleString()}</Text>
                  </div>
                </Group>
              );
            })}
            <Group justify="space-between" mt="sm">
              <Text fw={700}>Total weighted</Text>
              <Text fw={700}>${(data.totalWeightedRevenue || 0).toLocaleString()}</Text>
            </Group>
          </Paper>

          <Paper withBorder p="md" radius="md">
            <Title order={4}>By Tier</Title>
            {Object.entries(data.byTier || {}).map(([tier, row]) => (
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
            {Object.entries(data.byModel || {}).map(([model, row]) => (
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
              <Text fw={700}>${(data.totals?.revenue || 0).toLocaleString()}</Text>
            </Group>
            <Group justify="space-between">
              <Text c="dimmed">Participants</Text>
              <Text c="dimmed">{(data.totals?.participants || 0).toLocaleString()}</Text>
            </Group>
          </Paper>
        </SimpleGrid>
      )}

      <Paper withBorder p="md" radius="md">
        <Title order={4} mb="xs">Pipeline Weights</Title>
        <Text size="xs" c="dimmed" mb="sm">Close probability per stage.</Text>
        <SimpleGrid cols={{ base: 2, md: 3, lg: 6 }}>
          {pipelineColumns.map((col) => (
            <TextInput
              key={col}
              label={col}
              value={String(Math.round((weights[col] ?? 0) * 100))}
              onChange={(e) => {
                const num = Number(e.target.value);
                if (!Number.isNaN(num)) {
                  setWeights((prev) => ({ ...prev, [col]: Math.max(0, Math.min(100, num)) / 100 }));
                }
              }}
              type="number"
              min={0}
              max={100}
            />
          ))}
        </SimpleGrid>
        <Button mt="sm" size="xs" onClick={saveWeights} loading={saving}>
          Save weights
        </Button>
      </Paper>
    </Container>
  );
}
