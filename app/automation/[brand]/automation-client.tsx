'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Button, Group, Stack, TextInput, NumberInput, Select, Switch, Paper, Badge } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { AdminTextInput, AdminDataTable, AdminFormStatus } from '@sovereignsquad/gds-admin/client'
import type { Brand } from '@/app/lib/brand'
import type { AutomationTriggerType, AutomationActionType } from '@/lib/automation-rules'

type AutomationRule = {
  id: string
  name: string
  trigger: { type: AutomationTriggerType; column?: string; thresholdDays?: number }
  action: { type: AutomationActionType; dueInDays?: number; note?: string; tag?: string; message?: string }
  enabled: boolean
  lastEvaluatedAt?: string
  firingCount?: number
}

// lead_assigned deliberately excluded — this app has no lead-assignment
// model for it to fire from yet (issue #201 §6/§13: schema-defined for
// forward-compatibility only, never offered as a selectable option).
const TRIGGER_OPTIONS: { value: AutomationTriggerType; label: string }[] = [
  { value: 'lead_created', label: 'Lead created' },
  { value: 'lead_moved_to_column', label: 'Lead moved to column' },
  { value: 'stale_no_activity', label: 'No activity for N days' },
]

const ACTION_OPTIONS: { value: AutomationActionType; label: string }[] = [
  { value: 'set_next_action', label: 'Set a follow-up reminder' },
  { value: 'apply_tag', label: 'Apply a tag' },
  { value: 'log_notification', label: 'Log a note on the lead' },
]

// Matches lib/validate-lead.ts's KANBAN_COLUMNS exactly.
const KANBAN_COLUMNS = ['DISCOVERED', 'QUALIFIED', 'ENGAGED', 'PROPOSAL', 'WON', 'LOST', 'BACKLOG']

const EMPTY_FORM: Omit<AutomationRule, 'id' | 'lastEvaluatedAt' | 'firingCount'> = {
  name: '',
  trigger: { type: 'lead_created' },
  action: { type: 'apply_tag', tag: '' },
  enabled: false,
}

type Props = {
  brand: Brand;
  label: string;
};

// Structured form only — no visual/drag-and-drop builder (issue #201's own
// explicit v1 Non-Goal). Mirrors app/outreach/cadences's own client
// component shape and auth conventions exactly (GDS/Mantine primitives, the
// same requireApiKey-gated write endpoints).
export function AutomationClient({ brand, label }: Props) {
  const [tenantId, setTenantId] = useState('default')

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tenantId')) setTenantId(params.get('tenantId') || 'default')
    } catch {}
  }, [])

  const [rules, setRules] = useState<AutomationRule[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Omit<AutomationRule, 'id' | 'lastEvaluatedAt' | 'firingCount'>>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadRules = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/automation-rules?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`)
      if (!res.ok) throw new Error('Failed to load automation rules')
      const data = await res.json()
      setRules(data.rules || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load automation rules')
    } finally {
      setLoading(false)
    }
  }, [brand, tenantId])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setError(null)
  }

  function startEdit(rule: AutomationRule) {
    setEditingId(rule.id)
    setForm({
      name: rule.name,
      trigger: rule.trigger,
      action: rule.action,
      enabled: rule.enabled,
    })
  }

  async function saveRule() {
    setSaving(true)
    setError(null)
    try {
      const payload = { name: form.name, trigger: form.trigger, action: form.action, enabled: form.enabled }
      const url = editingId
        ? `/api/automation-rules/${editingId}?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`
        : `/api/automation-rules?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`

      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to save automation rule')
      }

      resetForm()
      await loadRules()
    } catch (err: any) {
      setError(err?.message || 'Failed to save automation rule')
    } finally {
      setSaving(false)
    }
  }

  async function deleteRule(rule: AutomationRule) {
    const confirmed = window.confirm(`Delete automation rule "${rule.name}"?`)
    if (!confirmed) return

    setDeletingId(rule.id)
    setError(null)
    try {
      const res = await fetch(`/api/automation-rules/${rule.id}?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to delete automation rule')
      }
      if (editingId === rule.id) resetForm()
      await loadRules()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete automation rule')
    } finally {
      setDeletingId(null)
    }
  }

  function updateTriggerType(type: AutomationTriggerType) {
    if (type === 'lead_moved_to_column') {
      setForm((f) => ({ ...f, trigger: { type, column: 'ENGAGED' } }))
    } else if (type === 'stale_no_activity') {
      setForm((f) => ({ ...f, trigger: { type, thresholdDays: 14 } }))
    } else {
      setForm((f) => ({ ...f, trigger: { type } }))
    }
  }

  function updateActionType(type: AutomationActionType) {
    if (type === 'set_next_action') {
      setForm((f) => ({ ...f, action: { type, dueInDays: 1, note: '' } }))
    } else if (type === 'apply_tag') {
      setForm((f) => ({ ...f, action: { type, tag: '' } }))
    } else {
      setForm((f) => ({ ...f, action: { type, message: '' } }))
    }
  }

  const canSave = Boolean(
    form.name.trim()
    && (form.trigger.type !== 'lead_moved_to_column' || form.trigger.column)
    && (form.trigger.type !== 'stale_no_activity' || (form.trigger.thresholdDays && form.trigger.thresholdDays > 0))
    && (form.action.type !== 'apply_tag' || form.action.tag)
    && (form.action.type !== 'log_notification' || form.action.message)
  )

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Title order={2}>Automation Rules</Title>
            <Text size="sm" c="dimmed">
              Trigger→action rules for <Text span fw={700}>{label}</Text> — when X happens on a lead, do Y.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={resetForm} variant="light">
            New Rule
          </Button>
        </Group>

        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <AdminTextInput
              name="name"
              label="Rule name"
              value={form.name}
              onChange={(value) => setForm((f) => ({ ...f, name: value }))}
              placeholder="Flag stale ENGAGED leads"
              required
            />

            <Group grow align="flex-start">
              <Select
                label="When"
                data={TRIGGER_OPTIONS}
                value={form.trigger.type}
                onChange={(value) => value && updateTriggerType(value as AutomationTriggerType)}
                allowDeselect={false}
              />
              {form.trigger.type === 'lead_moved_to_column' && (
                <Select
                  label="Column"
                  data={KANBAN_COLUMNS}
                  value={form.trigger.column || null}
                  onChange={(value) => value && setForm((f) => ({ ...f, trigger: { type: 'lead_moved_to_column', column: value } }))}
                  allowDeselect={false}
                />
              )}
              {form.trigger.type === 'stale_no_activity' && (
                <NumberInput
                  label="Days without activity"
                  value={form.trigger.thresholdDays}
                  onChange={(value) => setForm((f) => ({ ...f, trigger: { type: 'stale_no_activity', thresholdDays: typeof value === 'number' ? value : 1 } }))}
                  min={1}
                  max={3650}
                />
              )}
            </Group>

            <Group grow align="flex-start">
              <Select
                label="Do"
                data={ACTION_OPTIONS}
                value={form.action.type}
                onChange={(value) => value && updateActionType(value as AutomationActionType)}
                allowDeselect={false}
              />
              {form.action.type === 'set_next_action' && (
                <NumberInput
                  label="Due in days"
                  value={form.action.dueInDays}
                  onChange={(value) => setForm((f) => ({ ...f, action: { ...(f.action as any), dueInDays: typeof value === 'number' ? value : 0 } }))}
                  min={0}
                  max={365}
                />
              )}
              {form.action.type === 'apply_tag' && (
                <TextInput
                  label="Tag"
                  value={form.action.tag || ''}
                  onChange={(e) => setForm((f) => ({ ...f, action: { ...(f.action as any), tag: e.currentTarget.value } }))}
                  required
                />
              )}
            </Group>
            {form.action.type === 'set_next_action' && (
              <TextInput
                label="Reminder note"
                value={form.action.note || ''}
                onChange={(e) => setForm((f) => ({ ...f, action: { ...(f.action as any), note: e.currentTarget.value } }))}
              />
            )}
            {form.action.type === 'log_notification' && (
              <TextInput
                label="Note to log on the lead"
                value={form.action.message || ''}
                onChange={(e) => setForm((f) => ({ ...f, action: { ...(f.action as any), message: e.currentTarget.value } }))}
                required
              />
            )}

            {/* CLAUDE.md Rule 7 — copy is explicit about real, automated writes
                to lead data the moment this is on. Defaults off (EMPTY_FORM),
                same safety rail as Cadence.enabled (issue #124). */}
            <Switch
              checked={form.enabled}
              onChange={(e) => setForm((f) => ({ ...f, enabled: e.currentTarget.checked }))}
              label={form.enabled ? 'Enabled — will automatically run on matching leads' : 'Disabled — will never run automatically'}
              color="red"
            />

            {error && <AdminFormStatus state="error" title="Couldn't save automation rule" description={error} />}
            {saving && <AdminFormStatus state="loading" title="Saving…" />}

            <Group justify="flex-end" gap="xs">
              <Button variant="light" onClick={resetForm} disabled={saving}>
                Reset
              </Button>
              <Button onClick={saveRule} loading={saving} disabled={!canSave}>
                {editingId ? 'Update' : 'Create'} Rule
              </Button>
            </Group>
          </Stack>
        </Paper>

        {loading ? (
          <AdminFormStatus state="loading" title="Loading automation rules" />
        ) : (
          <AdminDataTable<AutomationRule>
            rows={rules}
            caption="Automation rules"
            columns={[
              { key: 'name', header: 'Name', rowHeader: true },
              { key: 'trigger', header: 'Trigger', accessor: (row) => describeTrigger(row.trigger) },
              { key: 'action', header: 'Action', accessor: (row) => describeAction(row.action) },
              {
                key: 'enabled',
                header: 'Status',
                accessor: (row) => (
                  <Badge color={row.enabled ? 'red' : 'gray'} variant="light">
                    {row.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                ),
              },
              {
                key: 'firingCount',
                header: 'Fired',
                numeric: true,
                accessor: (row) => `${row.firingCount ?? 0}${row.lastEvaluatedAt ? ` · last checked ${new Date(row.lastEvaluatedAt).toLocaleString()}` : ''}`,
              },
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
                      onClick={() => deleteRule(row)}
                      loading={deletingId === row.id}
                    >
                      <IconTrash size={14} />
                    </Button>
                  </Group>
                ),
              },
            ]}
            empty={<Text c="dimmed" size="sm">No automation rules yet. Create your first one above.</Text>}
            getRowKey={(row) => row.id}
          />
        )}
      </Stack>
    </Container>
  )
}

function describeTrigger(trigger: AutomationRule['trigger']): string {
  if (trigger.type === 'lead_created') return 'Lead created'
  if (trigger.type === 'lead_moved_to_column') return `Moved to ${trigger.column}`
  if (trigger.type === 'stale_no_activity') return `No activity for ${trigger.thresholdDays}d`
  return trigger.type
}

function describeAction(action: AutomationRule['action']): string {
  if (action.type === 'set_next_action') return `Follow-up in ${action.dueInDays}d`
  if (action.type === 'apply_tag') return `Tag: ${action.tag}`
  if (action.type === 'log_notification') return `Note: ${action.message}`
  return action.type
}
