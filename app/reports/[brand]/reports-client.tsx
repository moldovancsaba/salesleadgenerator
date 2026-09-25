'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Button, Group, Stack, Paper, TextInput, Select, MultiSelect, NumberInput, Switch, TagsInput, Loader, Badge, SegmentedControl, ActionIcon } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState, AdminModal } from '@sovereignsquad/gds-admin/client'
import { GdsBarChart, GdsLineChart } from '@sovereignsquad/gds-core/client'
import { IconPlus, IconTrash, IconPlayerPlay } from '@tabler/icons-react'
import type { Brand } from '@/app/lib/brand'
import { METRIC_OPTIONS, GROUP_BY_OPTIONS, FILTER_FIELD_OPTIONS } from '@/lib/report-pipeline'
import type { ReportMetric, ReportGroupByField, ReportFilterField, ReportFilterOp, ReportDateRange } from '@/lib/report-pipeline'
import type { ReportDefinition, ReportChartType } from '@/lib/report-definitions'

type Props = { brand: Brand; label: string }

type FilterRow = { field: ReportFilterField; op: ReportFilterOp; value: string }

type FormState = {
  id: string | null
  name: string
  metric: ReportMetric
  groupBy: ReportGroupByField[]
  filters: FilterRow[]
  dateRangeMode: 'all' | 'relative' | 'fixed'
  relativeDays: number
  fixedFrom: string
  fixedTo: string
  chartType: ReportChartType
  scheduleEnabled: boolean
  scheduleFrequency: 'daily' | 'weekly' | 'monthly'
  scheduleHourUtc: number
  scheduleDayOfWeek: number
  scheduleDayOfMonth: number
  scheduleRecipients: string[]
}

function emptyForm(): FormState {
  return {
    id: null, name: '', metric: 'lead_count', groupBy: [], filters: [],
    dateRangeMode: 'all', relativeDays: 30, fixedFrom: '', fixedTo: '',
    chartType: 'table',
    scheduleEnabled: false, scheduleFrequency: 'weekly', scheduleHourUtc: 9, scheduleDayOfWeek: 1, scheduleDayOfMonth: 1,
    scheduleRecipients: [],
  }
}

function formFromDefinition(r: ReportDefinition): FormState {
  const dateRange = r.dateRange
  return {
    id: r.id, name: r.name, metric: r.metric, groupBy: r.groupBy,
    filters: r.filters.map((f) => ({ field: f.field, op: f.op, value: Array.isArray(f.value) ? f.value.join(', ') : f.value })),
    dateRangeMode: dateRange.mode,
    relativeDays: dateRange.mode === 'relative' ? dateRange.days : 30,
    fixedFrom: dateRange.mode === 'fixed' ? dateRange.from.slice(0, 10) : '',
    fixedTo: dateRange.mode === 'fixed' ? dateRange.to.slice(0, 10) : '',
    chartType: r.chartType,
    scheduleEnabled: r.schedule?.enabled ?? false,
    scheduleFrequency: r.schedule?.frequency ?? 'weekly',
    scheduleHourUtc: r.schedule?.hourUtc ?? 9,
    scheduleDayOfWeek: r.schedule?.dayOfWeek ?? 1,
    scheduleDayOfMonth: r.schedule?.dayOfMonth ?? 1,
    scheduleRecipients: r.schedule?.recipients ?? [],
  }
}

function formToPayload(f: FormState) {
  let dateRange: ReportDateRange
  if (f.dateRangeMode === 'relative') dateRange = { mode: 'relative', days: f.relativeDays }
  else if (f.dateRangeMode === 'fixed') dateRange = { mode: 'fixed', from: f.fixedFrom, to: f.fixedTo }
  else dateRange = { mode: 'all' }

  return {
    name: f.name.trim(),
    metric: f.metric,
    groupBy: f.groupBy,
    filters: f.filters.filter((row) => row.value.trim()).map((row) => ({
      field: row.field, op: row.op,
      value: row.op === 'in' ? row.value.split(',').map((v) => v.trim()).filter(Boolean) : row.value.trim(),
    })),
    dateRange,
    chartType: f.chartType,
    schedule: f.scheduleRecipients.length > 0 || f.scheduleEnabled ? {
      enabled: f.scheduleEnabled,
      frequency: f.scheduleFrequency,
      hourUtc: f.scheduleHourUtc,
      dayOfWeek: f.scheduleFrequency === 'weekly' ? f.scheduleDayOfWeek : undefined,
      dayOfMonth: f.scheduleFrequency === 'monthly' ? f.scheduleDayOfMonth : undefined,
      recipients: f.scheduleRecipients,
    } : null,
  }
}

type ResultRow = { groupKey: Record<string, string | null>; value: number | null; sampleSize?: number }

function rowLabel(row: ResultRow): string {
  const parts = Object.values(row.groupKey).map((v) => v ?? '(missing)')
  return parts.length > 0 ? parts.join(' / ') : '(all)'
}

export function ReportsClient({ brand, label }: Props) {
  const [tenantId] = useState('default')
  const [reports, setReports] = useState<ReportDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [runningId, setRunningId] = useState<string | null>(null)
  const [runResult, setRunResult] = useState<{ reportId: string; reportName: string; chartType: ReportChartType; rows: ResultRow[] } | null>(null)
  const [runError, setRunError] = useState<string | null>(null)

  const [deleteTarget, setDeleteTarget] = useState<ReportDefinition | null>(null)

  const loadReports = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = new URL('/api/reports', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error(`Failed to load reports (${res.status})`)
      const data = await res.json()
      setReports(data.reports || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load reports')
    } finally {
      setLoading(false)
    }
  }, [brand, tenantId])

  useEffect(() => { loadReports() }, [loadReports])

  function openCreate() {
    setForm(emptyForm())
    setSaveError(null)
    setFormOpen(true)
  }

  function openEdit(r: ReportDefinition) {
    setForm(formFromDefinition(r))
    setSaveError(null)
    setFormOpen(true)
  }

  const canSave = form.name.trim().length > 0

  async function saveReport() {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = formToPayload(form)
      const url = new URL(form.id ? `/api/reports/${encodeURIComponent(form.id)}` : '/api/reports', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      const res = await fetch(url.toString(), {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Failed to save report (${res.status})`)
      }
      setFormOpen(false)
      await loadReports()
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save report')
    } finally {
      setSaving(false)
    }
  }

  async function runReport(r: ReportDefinition) {
    setRunningId(r.id)
    setRunError(null)
    try {
      const url = new URL(`/api/reports/${encodeURIComponent(r.id)}/run`, window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      const res = await fetch(url.toString(), { method: 'POST' })
      if (!res.ok) throw new Error(`Failed to run report (${res.status})`)
      const data = await res.json()
      setRunResult({ reportId: r.id, reportName: r.name, chartType: r.chartType, rows: data.rows || [] })
      await loadReports()
    } catch (err: any) {
      setRunError(err?.message || 'Failed to run report')
    } finally {
      setRunningId(null)
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return
    try {
      const url = new URL(`/api/reports/${encodeURIComponent(deleteTarget.id)}`, window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      const res = await fetch(url.toString(), { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete report')
      setDeleteTarget(null)
      if (runResult?.reportId === deleteTarget.id) setRunResult(null)
      await loadReports()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete report')
    }
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>Reports</Title>
            <Text size="sm" c="dimmed">
              Build an ad-hoc report for <Text span fw={700}>{label}</Text> — pick a metric, group by, filter, and a date range — and optionally schedule it for recurring email delivery.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>New report</Button>
        </Group>

        {error && <AdminFormStatus state="error" title="Something went wrong" description={error} />}
        {runError && <AdminFormStatus state="error" title="Couldn't run report" description={runError} />}

        {loading ? (
          <Group justify="center" py="xl"><Loader /></Group>
        ) : reports.length === 0 ? (
          <AdminResourceEmptyState title="No reports yet" description="Build the first one above." />
        ) : (
          <AdminDataTable<ReportDefinition & Record<string, unknown>>
            rows={reports as (ReportDefinition & Record<string, unknown>)[]}
            caption="Saved reports"
            columns={[
              {
                key: 'name',
                header: 'Name',
                rowHeader: true,
                accessor: (row) => (
                  <Group gap={6} wrap="nowrap">
                    <Text fw={600} c="indigo" style={{ cursor: 'pointer' }} onClick={() => openEdit(row)}>{row.name}</Text>
                    {row.schedule?.enabled && <Badge size="xs" color="teal" variant="light">Scheduled</Badge>}
                  </Group>
                ),
              },
              { key: 'metric', header: 'Metric', accessor: (row) => METRIC_OPTIONS.find((o) => o.value === row.metric)?.label ?? row.metric },
              {
                key: 'lastRun',
                header: 'Last run',
                accessor: (row) => row.lastRunAt
                  ? `${new Date(row.lastRunAt).toLocaleString()} (${row.lastRunStatus ?? '—'})`
                  : 'Never',
              },
              {
                key: 'actions',
                header: 'Actions',
                accessor: (row) => (
                  <Group gap="xs">
                    <Button size="xs" variant="light" leftSection={<IconPlayerPlay size={14} />} onClick={() => runReport(row)} loading={runningId === row.id} disabled={runningId !== null && runningId !== row.id}>
                      Run
                    </Button>
                    <Button size="xs" variant="light" onClick={() => openEdit(row)}>Edit</Button>
                    <ActionIcon size="lg" variant="light" color="red" aria-label={`Delete ${row.name}`} onClick={() => setDeleteTarget(row)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                ),
              },
            ]}
            empty={<Text c="dimmed" size="sm">No reports.</Text>}
            getRowKey={(row) => row.id}
          />
        )}

        {runResult && (
          <Paper withBorder p="md" radius="md">
            <Title order={4} mb="sm">{runResult.reportName} — result</Title>
            {runResult.rows.length === 0 ? (
              <AdminResourceEmptyState title="No data" description="No leads matched this report's filters and date range." />
            ) : runResult.chartType === 'table' ? (
              <AdminDataTable<{ key: string; label: string; value: string; sampleSize: string } & Record<string, unknown>>
                rows={runResult.rows.map((r, i) => ({ key: String(i), label: rowLabel(r), value: r.value === null ? 'Insufficient data' : String(r.value), sampleSize: r.sampleSize !== undefined ? String(r.sampleSize) : '' }))}
                caption="Report result"
                columns={[
                  { key: 'label', header: 'Group', rowHeader: true, accessor: (row) => row.label },
                  { key: 'value', header: 'Value', numeric: true, accessor: (row) => row.value },
                ]}
                empty={<Text c="dimmed" size="sm">No rows.</Text>}
                getRowKey={(row) => row.key}
              />
            ) : (
              (() => {
                const Chart = runResult.chartType === 'line' ? GdsLineChart : GdsBarChart
                return (
                  <Chart
                    title={runResult.reportName}
                    summary={`${runResult.rows.length} group${runResult.rows.length === 1 ? '' : 's'} for ${METRIC_OPTIONS.find((o) => o.value === reports.find((r) => r.id === runResult.reportId)?.metric)?.label ?? 'this metric'}`}
                    data={runResult.rows.map((r) => ({ label: rowLabel(r), value: r.value }))}
                  />
                )
              })()
            )}
          </Paper>
        )}
      </Stack>

      <AdminModal opened={formOpen} onClose={() => setFormOpen(false)} title={form.id ? 'Edit report' : 'New report'} size="lg">
        <Stack gap="sm">
          <TextInput label="Name" value={form.name} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, name: v })) }} required />

          <Group grow align="flex-start">
            <Select label="Metric" data={METRIC_OPTIONS} value={form.metric} onChange={(v) => setForm((f) => ({ ...f, metric: (v as ReportMetric) || 'lead_count' }))} />
            <MultiSelect
              label="Group by (max 2)"
              data={GROUP_BY_OPTIONS.filter((o) => o.value !== 'none')}
              value={form.groupBy}
              onChange={(v) => setForm((f) => ({ ...f, groupBy: v.slice(0, 2) as ReportGroupByField[] }))}
              clearable
            />
          </Group>

          <Stack gap={4}>
            <Text size="sm" fw={500}>Filters (max 5)</Text>
            {form.filters.map((row, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Select size="xs" data={FILTER_FIELD_OPTIONS} value={row.field} onChange={(v) => setForm((f) => ({ ...f, filters: f.filters.map((r, idx) => idx === i ? { ...r, field: (v as ReportFilterField) || r.field } : r) }))} style={{ flex: 1 }} />
                <Select size="xs" data={[{ value: 'eq', label: 'equals' }, { value: 'in', label: 'is one of' }]} value={row.op} onChange={(v) => setForm((f) => ({ ...f, filters: f.filters.map((r, idx) => idx === i ? { ...r, op: (v as ReportFilterOp) || 'eq' } : r) }))} style={{ flex: 1 }} />
                <TextInput size="xs" placeholder={row.op === 'in' ? 'value1, value2' : 'value'} value={row.value} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, filters: f.filters.map((r, idx) => idx === i ? { ...r, value: v } : r) })) }} style={{ flex: 2 }} />
                <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove filter" onClick={() => setForm((f) => ({ ...f, filters: f.filters.filter((_, idx) => idx !== i) }))}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
            <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} disabled={form.filters.length >= 5} onClick={() => setForm((f) => ({ ...f, filters: [...f.filters, { field: 'industry', op: 'eq', value: '' }] }))}>
              Add filter
            </Button>
          </Stack>

          <Select
            label="Date range"
            data={[{ value: 'all', label: 'All time' }, { value: 'relative', label: 'Last N days' }, { value: 'fixed', label: 'Fixed range' }]}
            value={form.dateRangeMode}
            onChange={(v) => setForm((f) => ({ ...f, dateRangeMode: (v as FormState['dateRangeMode']) || 'all' }))}
          />
          {form.dateRangeMode === 'relative' && (
            <NumberInput label="Days" value={form.relativeDays} onChange={(v) => setForm((f) => ({ ...f, relativeDays: typeof v === 'number' ? v : 30 }))} min={1} max={365} />
          )}
          {form.dateRangeMode === 'fixed' && (
            <Group grow>
              <TextInput label="From (YYYY-MM-DD)" value={form.fixedFrom} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, fixedFrom: v })) }} />
              <TextInput label="To (YYYY-MM-DD)" value={form.fixedTo} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, fixedTo: v })) }} />
            </Group>
          )}

          <div>
            <Text size="sm" fw={500} mb={4}>Chart type</Text>
            <SegmentedControl
              data={[{ value: 'table', label: 'Table' }, { value: 'bar', label: 'Bar' }, { value: 'line', label: 'Line' }]}
              value={form.chartType}
              onChange={(v) => setForm((f) => ({ ...f, chartType: v as ReportChartType }))}
            />
          </div>

          <Paper withBorder p="sm" radius="md">
            <Switch label="Schedule recurring delivery" checked={form.scheduleEnabled} onChange={(e) => { const v = e.currentTarget.checked; setForm((f) => ({ ...f, scheduleEnabled: v })) }} mb="sm" />
            {form.scheduleEnabled && (
              <Stack gap="sm">
                <Group grow align="flex-start">
                  <Select label="Frequency" data={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} value={form.scheduleFrequency} onChange={(v) => setForm((f) => ({ ...f, scheduleFrequency: (v as FormState['scheduleFrequency']) || 'weekly' }))} />
                  <NumberInput label="Hour (UTC)" value={form.scheduleHourUtc} onChange={(v) => setForm((f) => ({ ...f, scheduleHourUtc: typeof v === 'number' ? v : 9 }))} min={0} max={23} />
                </Group>
                {form.scheduleFrequency === 'weekly' && (
                  <Select label="Day of week" data={['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => ({ value: String(i), label: d }))} value={String(form.scheduleDayOfWeek)} onChange={(v) => setForm((f) => ({ ...f, scheduleDayOfWeek: v ? parseInt(v, 10) : 1 }))} />
                )}
                {form.scheduleFrequency === 'monthly' && (
                  <NumberInput label="Day of month (1-28)" value={form.scheduleDayOfMonth} onChange={(v) => setForm((f) => ({ ...f, scheduleDayOfMonth: typeof v === 'number' ? v : 1 }))} min={1} max={28} />
                )}
                <TagsInput label="Recipients (email addresses)" value={form.scheduleRecipients} onChange={(v) => setForm((f) => ({ ...f, scheduleRecipients: v }))} clearable />
              </Stack>
            )}
          </Paper>

          {saveError && <Text c="red" size="sm">{saveError}</Text>}

          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveReport} loading={saving} disabled={!canSave}>Save</Button>
          </Group>
        </Stack>
      </AdminModal>

      <AdminModal opened={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete report?" size="sm">
        <Stack gap="sm">
          <Text size="sm">
            Delete <Text span fw={700}>{deleteTarget?.name}</Text>? This also stops its scheduled delivery, if any. This can&apos;t be undone.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button color="red" onClick={confirmDelete}>Delete</Button>
          </Group>
        </Stack>
      </AdminModal>
    </Container>
  )
}
