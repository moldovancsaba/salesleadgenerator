'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Button, Group, Stack, TextInput, NumberInput, Select, Switch, ActionIcon, Paper, Badge } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { AdminTextInput, AdminDataTable, AdminFormStatus } from '@sovereignsquad/gds-admin/client'
import type { Brand } from '@/app/lib/brand'
import type { CadenceStepChannel } from '@/lib/cadences'

type CadenceStep = {
  id: string
  channel: CadenceStepChannel
  waitDaysAfterPrevious: number
  templateId?: string
  reminderNote?: string
}

type Cadence = {
  id: string
  name: string
  steps: CadenceStep[]
  enabled: boolean
  enrolledCount?: number
}

type OutreachTemplate = { id: string; name: string; channel: 'email' | 'linkedin' }

const CHANNEL_OPTIONS = [
  { value: 'email', label: 'Email (sent automatically)' },
  { value: 'linkedin', label: 'LinkedIn (human reminder)' },
  { value: 'call', label: 'Call (human reminder)' },
]

const EMPTY_FORM: Omit<Cadence, 'id' | 'enrolledCount'> = {
  name: '',
  steps: [],
  enabled: false,
}

function makeStepId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `step_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

type Props = {
  brand: Brand;
  label: string;
};

// Same repeatable-rows exception this repo's own battlecards page already
// documents (gds-admin has no repeatable-rows primitive) — plain Mantine
// Stack/Group/ActionIcon rows for the step editor, matching that precedent
// exactly rather than inventing a new pattern.
export function CadencesClient({ brand, label }: Props) {
  const [tenantId, setTenantId] = useState('default')

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tenantId')) setTenantId(params.get('tenantId') || 'default')
    } catch {}
  }, [])

  const [cadences, setCadences] = useState<Cadence[]>([])
  const [templates, setTemplates] = useState<OutreachTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Omit<Cadence, 'id' | 'enrolledCount'>>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadCadences = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/cadences?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`)
      if (!res.ok) throw new Error('Failed to load cadences')
      const data = await res.json()
      setCadences(data.cadences || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load cadences')
    } finally {
      setLoading(false)
    }
  }, [brand, tenantId])

  useEffect(() => {
    loadCadences()
  }, [loadCadences])

  // Loaded once per brand/tenant — the step editor's own templateId picker
  // filters this list client-side per step channel, matching how the
  // outreach compose modal already filters DEFAULT_OUTREACH_TEMPLATES/
  // outreach_templates by channel rather than issuing a fetch per step.
  useEffect(() => {
    let cancelled = false
    fetch(`/api/outreach-templates?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setTemplates(data.templates || [])
      })
      .catch(() => {
        if (!cancelled) setTemplates([])
      })
    return () => {
      cancelled = true
    }
  }, [brand, tenantId])

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setError(null)
  }

  function startEdit(cadence: Cadence) {
    setEditingId(cadence.id)
    setForm({
      name: cadence.name,
      steps: cadence.steps || [],
      enabled: cadence.enabled,
    })
  }

  async function saveCadence() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name,
        steps: form.steps,
        enabled: form.enabled,
      }

      const url = editingId
        ? `/api/cadences/${editingId}?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`
        : `/api/cadences?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`

      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to save cadence')
      }

      resetForm()
      await loadCadences()
    } catch (err: any) {
      setError(err?.message || 'Failed to save cadence')
    } finally {
      setSaving(false)
    }
  }

  async function deleteCadence(cadence: Cadence) {
    const confirmed = window.confirm(`Delete cadence "${cadence.name}"?`)
    if (!confirmed) return

    setDeletingId(cadence.id)
    setError(null)
    try {
      const res = await fetch(`/api/cadences/${cadence.id}?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        // 409 (leads still enrolled) already carries a clear, specific
        // count/explanation from the server — surfaced verbatim rather than
        // a generic "failed to delete" that would hide the real reason.
        throw new Error(data?.error || 'Failed to delete cadence')
      }
      if (editingId === cadence.id) resetForm()
      await loadCadences()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete cadence')
    } finally {
      setDeletingId(null)
    }
  }

  function updateStep(index: number, field: keyof CadenceStep, value: any) {
    setForm((f) => ({
      ...f,
      steps: f.steps.map((s, i) => (i === index ? { ...s, [field]: value } : s)),
    }))
  }

  function removeStep(index: number) {
    setForm((f) => ({ ...f, steps: f.steps.filter((_, i) => i !== index) }))
  }

  function addStep() {
    setForm((f) => ({
      ...f,
      steps: [...f.steps, { id: makeStepId(), channel: 'email', waitDaysAfterPrevious: 0 }],
    }))
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Title order={2}>Sales Cadences</Title>
            <Text size="sm" c="dimmed">
              Multi-step, multi-day automated outreach sequences for <Text span fw={700}>{label}</Text>.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={resetForm} variant="light">
            New Cadence
          </Button>
        </Group>

        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <AdminTextInput
              name="name"
              label="Cadence name"
              value={form.name}
              onChange={(value) => setForm((f) => ({ ...f, name: value }))}
              placeholder="Academy outreach — 4 touch"
              required
            />

            {/* CLAUDE.md Rule 7 — this toggle's copy is deliberately explicit
                about causing real, automated sends the moment it's on; never
                phrased as a soft "draft" state. Defaults off (see EMPTY_FORM)
                per issue #124's own safety rail. */}
            <Switch
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.currentTarget.checked }))}
              label={form.enabled ? 'Enabled — sending real, automated messages to enrolled leads' : 'Disabled — no message will ever be sent automatically'}
              description="Email steps are sent with no human involved as soon as they're due. LinkedIn/call steps only ever set a reminder — turning this on never sends a LinkedIn message or makes a call for you."
              color="red"
            />

            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Text size="sm" fw={600}>Steps</Text>
                <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={addStep}>
                  Add step
                </Button>
              </Group>

              {form.steps.map((step, i) => {
                const stepTemplates = templates.filter((t) => t.channel === step.channel)
                return (
                  <Paper key={step.id} withBorder p="sm" radius="sm">
                    <Stack gap={8}>
                      <Group justify="space-between" align="flex-start" wrap="nowrap">
                        <Text size="xs" c="dimmed" fw={600}>Step {i + 1}</Text>
                        <ActionIcon
                          color="red"
                          variant="light"
                          onClick={() => removeStep(i)}
                          aria-label={`Remove step ${i + 1}`}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Group>
                      <Group grow wrap="wrap">
                        <Select
                          label="Channel"
                          data={CHANNEL_OPTIONS}
                          value={step.channel}
                          onChange={(value) => value && updateStep(i, 'channel', value as CadenceStepChannel)}
                          allowDeselect={false}
                        />
                        <NumberInput
                          label="Days after previous step"
                          value={step.waitDaysAfterPrevious}
                          onChange={(value) => updateStep(i, 'waitDaysAfterPrevious', typeof value === 'number' ? value : 0)}
                          min={0}
                          max={365}
                        />
                      </Group>
                      {(step.channel === 'email' || step.channel === 'linkedin') && (
                        <Select
                          label="Template"
                          placeholder={stepTemplates.length ? 'Select a template' : 'No templates for this channel yet'}
                          data={stepTemplates.map((t) => ({ value: t.id, label: t.name }))}
                          value={step.templateId || null}
                          onChange={(value) => updateStep(i, 'templateId', value || undefined)}
                          required={step.channel === 'email'}
                          description={step.channel === 'email' ? 'Required — an email step can\'t send without one' : undefined}
                          clearable
                        />
                      )}
                      {(step.channel === 'linkedin' || step.channel === 'call') && (
                        <TextInput
                          label="Reminder note"
                          placeholder="Send a personalized connection request"
                          value={step.reminderNote || ''}
                          onChange={(e) => updateStep(i, 'reminderNote', e.currentTarget.value)}
                          description="Shown as the lead's follow-up note when this step comes due"
                        />
                      )}
                    </Stack>
                  </Paper>
                )
              })}
              {form.steps.length === 0 && (
                <Text size="xs" c="dimmed">No steps yet. Add at least one to save this cadence.</Text>
              )}
            </Stack>

            {error && <AdminFormStatus state="error" title="Couldn't save cadence" description={error} />}
            {saving && <AdminFormStatus state="loading" title="Saving…" />}

            <Group justify="flex-end" gap="xs">
              <Button variant="light" onClick={resetForm} disabled={saving}>
                Reset
              </Button>
              <Button onClick={saveCadence} loading={saving} disabled={!form.name || form.steps.length === 0}>
                {editingId ? 'Update' : 'Create'} Cadence
              </Button>
            </Group>
          </Stack>
        </Paper>

        {loading ? (
          <AdminFormStatus state="loading" title="Loading cadences" />
        ) : (
          <AdminDataTable<Cadence>
            rows={cadences}
            caption="Cadences"
            columns={[
              { key: 'name', header: 'Name', rowHeader: true },
              { key: 'steps', header: 'Steps', numeric: true, accessor: (row) => row.steps.length },
              {
                key: 'enabled',
                header: 'Status',
                accessor: (row) => (
                  <Badge color={row.enabled ? 'red' : 'gray'} variant="light">
                    {row.enabled ? 'Enabled (sending)' : 'Disabled'}
                  </Badge>
                ),
              },
              { key: 'enrolledCount', header: 'Leads enrolled', numeric: true, accessor: (row) => row.enrolledCount ?? 0 },
              {
                key: 'actions',
                header: 'Actions',
                accessor: (row) => (
                  <Group gap="xs">
                    <Button size="xs" variant="light" onClick={() => startEdit(row)}>
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      onClick={() => deleteCadence(row)}
                      loading={deletingId === row.id}
                    >
                      <IconTrash size={14} />
                    </Button>
                  </Group>
                ),
              },
            ]}
            empty={<Text c="dimmed" size="sm">No cadences yet. Create your first one above.</Text>}
            getRowKey={(row) => row.id}
          />
        )}
      </Stack>
    </Container>
  )
}
