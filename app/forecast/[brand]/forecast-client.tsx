'use client';

import { useState, useEffect, useCallback } from 'react';
import { Container, Title, Text, Paper, SimpleGrid, Group, Badge, TextInput, Loader, Button, Stack } from '@mantine/core';
import { StatusBadge, InlineAlert, MetricCard, MissingDataPrompt } from '@sovereignsquad/gds-core/client';
import { AdminSelect, AdminDataTable, AdminResourceEmptyState, AdminFormStatus } from '@sovereignsquad/gds-admin/client';
import { CALIBRATABLE_STAGES } from '@/lib/win-rate-calibration';
import type { CurrencyCode } from '@/app/lib/brand';

type ConcentrationRisk = {
  topLeadId: string;
  topLeadName: string;
  topLeadValue: number;
  percentOfTotal: number;
  threshold: number;
  topN: number;
  atRisk: boolean;
};

type Coverage = {
  target: number;
  targetPeriod: 'monthly' | 'quarterly' | 'annual';
  targetCurrency: CurrencyCode;
  weightedPipeline: number;
  ratio: number;
  benchmark: 'below' | 'in_range' | 'above' | 'unset';
  currencyMismatch: boolean;
};

type Forecast = {
  pipeline?: Record<string, { leads: number; participants: number; rawRevenue: number; probability: number; weightedRevenue: number; probabilitySource?: 'static' | 'calibrated'; concentrationRisk?: ConcentrationRisk | null }>;
  totalWeightedRevenue?: number;
  concentrationRisk?: ConcentrationRisk | null;
  coverage?: Coverage | null;
  calibration?: { mode: 'static' | 'calibrated'; lastComputedAt: string | null } | null;
  byTier?: Record<string, { leads: number; participants: number; revenue: number }>;
  byModel?: Record<string, { leads: number; revenue: number }>;
  totals?: { revenue: number; participants: number };
  byCompany?: Array<{ company: string; leads: number; currency: string; upfrontEur: number; monthlyEur: number; annualFeeEur: number; revenueSharePercent: number; discountPercent: number; estimatedAnnualValueEur: number }>;
  totalEstimatedAnnualValueEur?: number;
};

type StageStat = { sampleSize: number; wonCount: number; lostCount: number; rate: number; confidence: 'ok' | 'insufficient' };
type WinRatesResponse = { tenantId: string; brand: string; computedAt: string | null; windowDays: number | null; minSampleSize: number; stages: Record<string, StageStat> };
type CalibrationSettings = { mode: 'static' | 'calibrated'; minSampleSize: number; windowDays: number | null };
type CalibrationRow = { stage: string; staticRate: number; calibrated: StageStat; source: 'static' | 'calibrated' };

type TicketSizeCalibrationGroup = {
  tier: string;
  method: 'tier_band' | 'per_unit';
  sampleSize: number;
  meanAbsoluteError: number;
  medianAbsoluteError: number;
  meanPercentError: number;
  medianPercentError: number;
  confidence: 'ok' | 'insufficient';
};
type TicketSizeCalibrationResponse = {
  tenantId: string;
  brand: string;
  computedAt: string;
  minSampleSize: number;
  groups: TicketSizeCalibrationGroup[];
  wonWithoutEstimate: number;
  wonWithoutActual: number;
};

const DEFAULT_CALIBRATION_SETTINGS: CalibrationSettings = { mode: 'static', minSampleSize: 20, windowDays: null };

const COVERAGE_BENCHMARK_LABEL: Record<Coverage['benchmark'], string> = {
  below: 'Below healthy range',
  in_range: 'Healthy coverage',
  above: 'Above healthy range',
  unset: 'Currency mismatch',
};

const COVERAGE_BENCHMARK_TREND: Record<Coverage['benchmark'], 'positive' | 'negative' | 'neutral'> = {
  below: 'negative',
  in_range: 'positive',
  above: 'neutral',
  unset: 'neutral',
};

type Props = {
  brand: string;
  label: string;
};

export function ForecastClient({ brand, label }: Props) {
  const [data, setData] = useState<Forecast | null>(null);
  const [loading, setLoading] = useState(true);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [calibrationSettings, setCalibrationSettings] = useState<CalibrationSettings>(DEFAULT_CALIBRATION_SETTINGS);
  const [winRates, setWinRates] = useState<WinRatesResponse | null>(null);
  const [winRatesLoading, setWinRatesLoading] = useState(true);
  const [winRatesError, setWinRatesError] = useState<string | null>(null);
  const [savingCalibrationMode, setSavingCalibrationMode] = useState(false);
  const [ticketSizeCalibration, setTicketSizeCalibration] = useState<TicketSizeCalibrationResponse | null>(null);
  const [ticketSizeCalibrationLoading, setTicketSizeCalibrationLoading] = useState(true);
  const [ticketSizeCalibrationError, setTicketSizeCalibrationError] = useState<string | null>(null);

  const loadForecast = useCallback(async (brandKey: string) => {
    setLoading(true);
    setError(null);
    try {
      // Issue #147 — this page's own tenantId has always equalled brandKey
      // itself (not lib/tenant.ts's generic 'default'); previously written
      // as `brandKey === 'cogmap' ? 'cogmap' : 'seyu'`, which silently
      // mapped any brand other than 'cogmap' to 'seyu' — wrong for a third
      // brand. Equivalent for both existing brands, correct for any brand.
      const tenantId = brandKey;
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
      setCalibrationSettings(settingsJson.calibration || DEFAULT_CALIBRATION_SETTINGS);
    } catch (err: any) {
      setError(err?.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Computed client-side from already-fetched data isn't possible here — win
  // rates require their own aggregation over outcomelogs — but this never
  // blocks the rest of the page: a failed/slow win-rates fetch surfaces its
  // own AdminFormStatus in the calibration panel while every other panel on
  // this page renders normally from loadForecast's own data.
  const loadWinRates = useCallback(async (brandKey: string) => {
    setWinRatesLoading(true);
    setWinRatesError(null);
    try {
      // Issue #147 — this page's own tenantId has always equalled brandKey
      // itself (not lib/tenant.ts's generic 'default'); previously written
      // as `brandKey === 'cogmap' ? 'cogmap' : 'seyu'`, which silently
      // mapped any brand other than 'cogmap' to 'seyu' — wrong for a third
      // brand. Equivalent for both existing brands, correct for any brand.
      const tenantId = brandKey;
      const res = await fetch(`/api/win-rates?brand=${encodeURIComponent(brandKey)}&tenantId=${encodeURIComponent(tenantId)}`);
      if (!res.ok) throw new Error(`Win-rates API: ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setWinRates(json);
    } catch (err: any) {
      setWinRatesError(err?.message || 'Load failed');
    } finally {
      setWinRatesLoading(false);
    }
  }, []);

  // Same independent-panel contract as loadWinRates above (issue #56): a
  // failed/slow fetch here surfaces its own AdminFormStatus in this one
  // panel, never blocking the rest of the page.
  const loadTicketSizeCalibration = useCallback(async (brandKey: string) => {
    setTicketSizeCalibrationLoading(true);
    setTicketSizeCalibrationError(null);
    try {
      // Issue #147 — this page's own tenantId has always equalled brandKey
      // itself (not lib/tenant.ts's generic 'default'); previously written
      // as `brandKey === 'cogmap' ? 'cogmap' : 'seyu'`, which silently
      // mapped any brand other than 'cogmap' to 'seyu' — wrong for a third
      // brand. Equivalent for both existing brands, correct for any brand.
      const tenantId = brandKey;
      const res = await fetch(`/api/ticket-size-calibration?brand=${encodeURIComponent(brandKey)}&tenantId=${encodeURIComponent(tenantId)}`);
      if (!res.ok) throw new Error(`Ticket-size calibration API: ${res.status}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setTicketSizeCalibration(json);
    } catch (err: any) {
      setTicketSizeCalibrationError(err?.message || 'Load failed');
    } finally {
      setTicketSizeCalibrationLoading(false);
    }
  }, []);

  useEffect(() => {
    loadForecast(brand);
    loadWinRates(brand);
    loadTicketSizeCalibration(brand);
  }, [brand, loadForecast, loadWinRates, loadTicketSizeCalibration]);

  const handleCalibrationModeChange = async (value: string | null) => {
    if (value !== 'static' && value !== 'calibrated') return;
    const next: CalibrationSettings = { ...calibrationSettings, mode: value };
    setCalibrationSettings(next);
    setSavingCalibrationMode(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calibration: next }),
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      await res.json().catch(() => ({}));
      // The board's pipeline probabilities depend on calibration.mode — reload
      // so probability/probabilitySource reflect the new mode immediately.
      await loadForecast(brand);
    } catch (err: any) {
      console.error('Calibration mode save failed:', err);
    } finally {
      setSavingCalibrationMode(false);
    }
  };

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
    // Issue #111: brand was never actually sent, so the server (which
    // hardcoded 'cogmap' regardless) always exported CogMap's data
    // regardless of which brand's page this button was clicked from.
    // tenantId has always literally equalled brand itself (same as this
    // file's other fetches above) -- previously a 2-brand ternary that
    // silently sent 'seyu' for DVSC (found in a 2026-08-02 doc audit,
    // missed by the #147 DVSC-onboarding sweep that fixed the other three).
    const tenantId = brand;
    const url = `/api/forecast/export?format=csv&brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`;
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
        <Title order={2}>{label + ' Forecast'}</Title>
        <Button
          size="xs"
          variant="light"
          color="gray"
          onClick={downloadCsv}
        >
          Export CSV
        </Button>
      </Group>

      {data.concentrationRisk?.atRisk && (
        <div style={{ marginBottom: 16 }}>
          <InlineAlert
            title="Concentration risk"
            message={`${Math.round(data.concentrationRisk.percentOfTotal * 100)}% of weighted pipeline value is in ${data.concentrationRisk.topN === 1 ? 'one deal' : `the top ${data.concentrationRisk.topN} deals`} — "${data.concentrationRisk.topLeadName}" alone is $${Math.round(data.concentrationRisk.topLeadValue).toLocaleString()}. Threshold: ${Math.round(data.concentrationRisk.threshold * 100)}%.`}
            severity="warning"
          />
        </div>
      )}

      <Paper withBorder p="md" radius="md" mb="lg">
        <Title order={4} mb="xs">Pipeline Coverage</Title>
        {!data.coverage ? (
          <MissingDataPrompt
            title="No revenue target set"
            description="Set a revenue target in Company Setup to see how the weighted pipeline forecast covers it."
          />
        ) : (
          <Stack gap="sm">
            <MetricCard
              label="Coverage ratio"
              value={`${data.coverage.ratio.toFixed(1)}x`}
              description={`${data.coverage.targetCurrency}${data.coverage.weightedPipeline.toLocaleString()} weighted pipeline vs. ${data.coverage.targetCurrency}${data.coverage.target.toLocaleString()} ${data.coverage.targetPeriod} target`}
              trend={{ label: COVERAGE_BENCHMARK_LABEL[data.coverage.benchmark], tone: COVERAGE_BENCHMARK_TREND[data.coverage.benchmark] }}
            />
            {data.coverage.currencyMismatch && (
              <Text size="xs" c="orange">
                Target is set in {data.coverage.targetCurrency} but this brand&apos;s pipeline is forecast in a different currency — no automatic conversion is applied. Update the target currency in Company Setup to compare accurately.
              </Text>
            )}
          </Stack>
        )}
      </Paper>

      <Paper withBorder p="md" radius="md" mb="lg">
        <Group justify="space-between" align="flex-start" mb="xs" wrap="wrap">
          <div>
            <Title order={4}>Forecast Calibration</Title>
            <Text size="xs" c="dimmed">
              Calibrated rates use each stage&apos;s actual WON/LOST history (min. {calibrationSettings.minSampleSize} closed deals) instead of the hand-picked defaults below. A stage without enough closed deals always keeps its static rate, even in calibrated mode.
            </Text>
          </div>
          <AdminSelect
            name="calibration-mode"
            label="Mode"
            value={calibrationSettings.mode}
            onChange={handleCalibrationModeChange}
            data={[
              { value: 'static', label: 'Static (hand-picked)' },
              { value: 'calibrated', label: 'Calibrated (from outcomes)' },
            ]}
            disabled={savingCalibrationMode}
            state={savingCalibrationMode ? 'loading' : 'idle'}
            style={{ minWidth: 240 }}
          />
        </Group>

        {winRatesError ? (
          <AdminFormStatus state="error" title="Couldn't load calibration data" description={winRatesError} />
        ) : winRatesLoading ? (
          <AdminFormStatus state="loading" title="Loading calibration data" />
        ) : !winRates || CALIBRATABLE_STAGES.every((stage) => (winRates.stages[stage]?.sampleSize ?? 0) === 0) ? (
          <AdminResourceEmptyState
            title="No closed deals yet"
            description="Calibration needs at least one WON or LOST outcome per stage. Once leads close, this table fills in automatically."
          />
        ) : (
          <>
            <AdminDataTable<CalibrationRow>
              rows={CALIBRATABLE_STAGES.filter((stage) => winRates.stages[stage]).map((stage) => ({
                stage,
                staticRate: weights[stage] ?? 0,
                calibrated: winRates.stages[stage],
                source: data.pipeline?.[stage]?.probabilitySource || 'static',
              }))}
              caption="Static vs. calibrated close probability per stage"
              columns={[
                { key: 'stage', header: 'Stage', rowHeader: true },
                { key: 'staticRate', header: 'Static', numeric: true, accessor: (row) => `${Math.round(row.staticRate * 100)}%` },
                { key: 'calibratedRate', header: 'Calibrated', numeric: true, accessor: (row) => `${Math.round(row.calibrated.rate * 100)}%` },
                { key: 'sample', header: 'Sample (won/total)', numeric: true, accessor: (row) => `${row.calibrated.wonCount}/${row.calibrated.sampleSize}` },
                {
                  key: 'confidence',
                  header: 'Confidence',
                  accessor: (row) => (
                    <StatusBadge
                      status={row.calibrated.confidence === 'ok' ? 'success' : 'warning'}
                      aria-label={
                        row.calibrated.confidence === 'ok'
                          ? `Sufficient sample size: ${row.calibrated.sampleSize} closed deals`
                          : `Insufficient sample size: only ${row.calibrated.sampleSize} closed deals, needs ${calibrationSettings.minSampleSize}`
                      }
                    >
                      {row.calibrated.confidence === 'ok' ? 'Sufficient data' : 'Insufficient data'}
                    </StatusBadge>
                  ),
                },
                { key: 'source', header: 'Used in forecast', accessor: (row) => (row.source === 'calibrated' ? 'Calibrated' : 'Static') },
              ]}
              getRowKey={(row) => row.stage}
            />
            {winRates.computedAt && (
              <Text size="xs" c="dimmed" mt="xs">Last computed {new Date(winRates.computedAt).toLocaleString()}</Text>
            )}
          </>
        )}
      </Paper>

      <Paper withBorder p="md" radius="md" mb="lg">
        <Title order={4}>Ticket-Size Calibration</Title>
        <Text size="xs" c="dimmed" mb="xs">
          Compares each closed-won lead&apos;s real contract value (captured in the detail drawer once a lead is WON) against what the ticket-size estimate predicted at the time — issue #79&apos;s engine ships with fixed placeholder assumptions precisely because this data doesn&apos;t exist yet; this table is what eventually replaces them with real figures.
        </Text>

        {ticketSizeCalibrationError ? (
          <AdminFormStatus state="error" title="Couldn't load ticket-size calibration data" description={ticketSizeCalibrationError} />
        ) : ticketSizeCalibrationLoading ? (
          <AdminFormStatus state="loading" title="Loading ticket-size calibration data" />
        ) : !ticketSizeCalibration || ticketSizeCalibration.groups.length === 0 ? (
          <AdminResourceEmptyState
            title="No calibration data yet"
            description="Needs at least one WON lead with both a ticket-size estimate and a real captured deal value. Set the actual deal value in a WON lead's detail drawer to start building this up."
          />
        ) : (
          <>
            <AdminDataTable<TicketSizeCalibrationGroup>
              rows={ticketSizeCalibration.groups}
              caption="Estimate accuracy by size tier and method"
              columns={[
                { key: 'tier', header: 'Size Tier', rowHeader: true },
                { key: 'method', header: 'Method', accessor: (row) => (row.method === 'tier_band' ? 'Company-size tier' : 'Per-participant') },
                { key: 'sample', header: 'Sample size', numeric: true, accessor: (row) => row.sampleSize },
                { key: 'meanError', header: 'Mean bias', numeric: true, accessor: (row) => `${row.meanPercentError > 0 ? '+' : ''}${row.meanPercentError}%` },
                { key: 'medianError', header: 'Median bias', numeric: true, accessor: (row) => `${row.medianPercentError > 0 ? '+' : ''}${row.medianPercentError}%` },
                {
                  key: 'confidence',
                  header: 'Confidence',
                  accessor: (row) => (
                    <StatusBadge
                      status={row.confidence === 'ok' ? 'success' : 'warning'}
                      aria-label={
                        row.confidence === 'ok'
                          ? `Sufficient sample size: ${row.sampleSize} closed deals`
                          : `Insufficient sample size: only ${row.sampleSize} closed deals, needs ${ticketSizeCalibration.minSampleSize}`
                      }
                    >
                      {row.confidence === 'ok' ? 'Sufficient data' : 'Insufficient data'}
                    </StatusBadge>
                  ),
                },
              ]}
              getRowKey={(row) => `${row.tier}:${row.method}`}
            />
            <Text size="xs" c="dimmed" mt="xs">
              Positive bias = the model underestimates this group (real deals close bigger than predicted) — consider raising the corresponding Sales Settings deal-size band. Negative bias = the model overestimates.
            </Text>
            {(ticketSizeCalibration.wonWithoutEstimate > 0 || ticketSizeCalibration.wonWithoutActual > 0) && (
              <Text size="xs" c="dimmed" mt="xs">
                {ticketSizeCalibration.wonWithoutEstimate > 0 && `${ticketSizeCalibration.wonWithoutEstimate} WON lead(s) had no usable ticket-size estimate when closed. `}
                {ticketSizeCalibration.wonWithoutActual > 0 && `${ticketSizeCalibration.wonWithoutActual} WON lead(s) have an estimate but no actual deal value captured yet.`}
              </Text>
            )}
            <Text size="xs" c="dimmed" mt="xs">Last computed {new Date(ticketSizeCalibration.computedAt).toLocaleString()}</Text>
          </>
        )}
      </Paper>

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
                <Group key={col} justify="space-between" py={4} style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
                  <div>
                    <Text fw={500}>{col}</Text>
                    <Text size="xs" c="dimmed">{raw.leads} leads · {raw.participants} participants</Text>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <Text fw={700}>${raw.weightedRevenue.toLocaleString()}</Text>
                    <Text size="xs" c="dimmed">{Math.round(raw.probability * 100)}% · raw ${raw.rawRevenue.toLocaleString()}</Text>
                    {raw.concentrationRisk?.atRisk && (
                      <StatusBadge
                        status="warning"
                        aria-label={`Concentration risk: ${Math.round(raw.concentrationRisk.percentOfTotal * 100)} percent of this column's raw value is in ${raw.concentrationRisk.topLeadName}`}
                      >
                        {Math.round(raw.concentrationRisk.percentOfTotal * 100)}% in {raw.concentrationRisk.topN === 1 ? '1 deal' : `${raw.concentrationRisk.topN} deals`}
                      </StatusBadge>
                    )}
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
              <Group key={tier} justify="space-between" py={4} style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
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
              <Group key={model} justify="space-between" py={4} style={{ borderBottom: '1px solid var(--mantine-color-gray-3)' }}>
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
