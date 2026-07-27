'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Button, Group, Stack, TextInput, TagsInput, Badge, Pill, ActionIcon, Paper } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { AdminTextInput, AdminTextarea, AdminDataTable, AdminFormStatus } from '@sovereignsquad/gds-admin/client'
import { BRAND_CONFIG, type Brand } from '@/app/lib/brand'

type Objection = { objection: string; response: string }

type Battlecard = {
  id: string
  competitorName: string
  positioningSummary: string
  proofPoints: string[]
  objections: Objection[]
  tags?: string[]
}

const EMPTY_FORM: Omit<Battlecard, 'id'> = {
  competitorName: '',
  positioningSummary: '',
  proofPoints: [],
  objections: [],
  tags: [],
}

type Props = {
  brand: Brand;
};

// This admin page uses GDS Admin field/table/status primitives throughout
// (AdminTextInput/AdminTextarea/AdminDataTable/AdminFormStatus), per repo
// policy and issue #65's explicit acceptance criterion. Two exceptions,
// both documented rather than silently substituted:
// 1. Repeatable proofPoints/objections rows — gds-admin has no repeatable-
//    rows primitive (the same gap already documented for the sales-settings
//    form, _archived/roadmap.md) — plain Mantine Stack/Group/ActionIcon rows instead.
// 2. Save/Reset/Delete actions use plain Mantine Buttons, not
//    AdminFormActions/ActionBar — those require resolving each action to a
//    SemanticActionId from GDS's internal vocabulary registry
//    (GdsVocabulary), which isn't safely inferable from the installed type
//    definitions alone; guessing at vocabulary keys risked a silently wrong
//    integration, so plain Buttons were used instead, matching how
//    app/detail.tsx already composes plain Mantine Buttons alongside GDS
//    chrome elsewhere in this codebase.
export function BattlecardsClient({ brand }: Props) {
  // tenantId is a separate multi-tenancy axis from brand (issue #100 only
  // concerns brand/client mixing) — still override-able via ?tenantId=,
  // unlike brand, which now comes exclusively from the URL path segment.
  const [tenantId, setTenantId] = useState('default')

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tenantId')) setTenantId(params.get('tenantId') || 'default')
    } catch {}
  }, [])

  const [battlecards, setBattlecards] = useState<Battlecard[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Omit<Battlecard, 'id'>>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadBattlecards = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/battlecards?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`)
      if (!res.ok) throw new Error('Failed to load battlecards')
      const data = await res.json()
      setBattlecards(data.battlecards || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load battlecards')
    } finally {
      setLoading(false)
    }
  }, [brand, tenantId])

  useEffect(() => {
    loadBattlecards()
  }, [loadBattlecards])

  function resetForm() {
    setForm(EMPTY_FORM)
    setEditingId(null)
    setError(null)
  }

  function startEdit(bc: Battlecard) {
    setEditingId(bc.id)
    setForm({
      competitorName: bc.competitorName,
      positioningSummary: bc.positioningSummary,
      proofPoints: bc.proofPoints || [],
      objections: bc.objections || [],
      tags: bc.tags || [],
    })
  }

  async function saveBattlecard() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...form,
        proofPoints: (form.proofPoints || []).map((p) => p.trim()).filter(Boolean),
        objections: (form.objections || []).filter((o) => o.objection.trim() || o.response.trim()),
        tags: (form.tags || []).filter(Boolean),
      }

      const url = editingId
        ? `/api/battlecards/${editingId}?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`
        : `/api/battlecards?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`

      const res = await fetch(url, {
        method: editingId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to save battlecard')
      }

      resetForm()
      await loadBattlecards()
    } catch (err: any) {
      setError(err?.message || 'Failed to save battlecard')
    } finally {
      setSaving(false)
    }
  }

  async function deleteBattlecard(bc: Battlecard) {
    const confirmed = window.confirm(`Delete battlecard for "${bc.competitorName}"?`)
    if (!confirmed) return

    setDeletingId(bc.id)
    setError(null)
    try {
      const res = await fetch(`/api/battlecards/${bc.id}?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`, {
        method: 'DELETE',
      })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to delete battlecard')
      }
      if (editingId === bc.id) resetForm()
      await loadBattlecards()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete battlecard')
    } finally {
      setDeletingId(null)
    }
  }

  function updateProofPoint(index: number, value: string) {
    setForm((f) => ({ ...f, proofPoints: f.proofPoints.map((p, i) => (i === index ? value : p)) }))
  }

  function removeProofPoint(index: number) {
    setForm((f) => ({ ...f, proofPoints: f.proofPoints.filter((_, i) => i !== index) }))
  }

  function updateObjection(index: number, field: keyof Objection, value: string) {
    setForm((f) => ({
      ...f,
      objections: f.objections.map((o, i) => (i === index ? { ...o, [field]: value } : o)),
    }))
  }

  function removeObjection(index: number) {
    setForm((f) => ({ ...f, objections: f.objections.filter((_, i) => i !== index) }))
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Title order={2}>Battlecards</Title>
            <Text size="sm" c="dimmed">
              Competitor positioning and objection responses for <Text span fw={700}>{BRAND_CONFIG[brand].label}</Text>.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={resetForm} variant="light">
            New Battlecard
          </Button>
        </Group>

        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <AdminTextInput
              name="competitorName"
              label="Competitor name"
              value={form.competitorName}
              onChange={(value) => setForm((f) => ({ ...f, competitorName: value }))}
              placeholder="Acme Corp"
              required
            />

            <AdminTextarea
              name="positioningSummary"
              label="Positioning summary"
              value={form.positioningSummary}
              onChange={(value) => setForm((f) => ({ ...f, positioningSummary: value }))}
              placeholder="How we compare and why we win"
              minRows={3}
              required
            />

            {/* No native GDS tag/chip input primitive exists (issue #64) — same
                Mantine TagsInput pattern already established on the outreach
                templates page and compose modal. */}
            <TagsInput
              label="Tags"
              placeholder="objection-handling, enterprise"
              value={form.tags || []}
              onChange={(value) => setForm((f) => ({ ...f, tags: value }))}
              description="Press Enter or comma to add a tag"
              clearable
              renderPill={({ option, onRemove, disabled }) => (
                <Pill
                  withRemoveButton
                  onRemove={onRemove}
                  disabled={disabled}
                  removeButtonProps={{ 'aria-label': `Remove tag ${option.value}` }}
                >
                  {option.value}
                </Pill>
              )}
            />

            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Text size="sm" fw={600}>Proof points</Text>
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => setForm((f) => ({ ...f, proofPoints: [...f.proofPoints, ''] }))}
                >
                  Add proof point
                </Button>
              </Group>
              {form.proofPoints.map((point, i) => (
                <Group key={i} gap="xs" wrap="nowrap">
                  <TextInput
                    style={{ flex: 1 }}
                    value={point}
                    onChange={(e) => updateProofPoint(i, e.currentTarget.value)}
                    placeholder="Faster time-to-value than the incumbent"
                    aria-label={`Proof point ${i + 1}`}
                  />
                  <ActionIcon
                    color="red"
                    variant="light"
                    onClick={() => removeProofPoint(i)}
                    aria-label={`Remove proof point ${i + 1}`}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
              ))}
              {form.proofPoints.length === 0 && (
                <Text size="xs" c="dimmed">No proof points yet.</Text>
              )}
            </Stack>

            <Stack gap="xs">
              <Group justify="space-between" align="center">
                <Text size="sm" fw={600}>Objections</Text>
                <Button
                  size="xs"
                  variant="subtle"
                  leftSection={<IconPlus size={14} />}
                  onClick={() => setForm((f) => ({ ...f, objections: [...f.objections, { objection: '', response: '' }] }))}
                >
                  Add objection
                </Button>
              </Group>
              {form.objections.map((entry, i) => (
                <Paper key={i} withBorder p="sm" radius="sm">
                  <Group justify="space-between" align="flex-start" wrap="nowrap">
                    <Stack gap={4} style={{ flex: 1 }}>
                      <TextInput
                        label="Objection"
                        value={entry.objection}
                        onChange={(e) => updateObjection(i, 'objection', e.currentTarget.value)}
                        placeholder="We already use a competitor."
                      />
                      <TextInput
                        label="Response"
                        value={entry.response}
                        onChange={(e) => updateObjection(i, 'response', e.currentTarget.value)}
                        placeholder="How to respond"
                      />
                    </Stack>
                    <ActionIcon
                      color="red"
                      variant="light"
                      onClick={() => removeObjection(i)}
                      aria-label={`Remove objection ${i + 1}`}
                      mt={24}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Paper>
              ))}
              {form.objections.length === 0 && (
                <Text size="xs" c="dimmed">No objection responses yet.</Text>
              )}
            </Stack>

            {error && <AdminFormStatus state="error" title="Couldn't save battlecard" description={error} />}
            {saving && <AdminFormStatus state="loading" title="Saving…" />}

            <Group justify="flex-end" gap="xs">
              <Button variant="light" onClick={resetForm} disabled={saving}>
                Reset
              </Button>
              <Button onClick={saveBattlecard} loading={saving} disabled={!form.competitorName || !form.positioningSummary}>
                {editingId ? 'Update' : 'Create'} Battlecard
              </Button>
            </Group>
          </Stack>
        </Paper>

        {loading ? (
          <AdminFormStatus state="loading" title="Loading battlecards" />
        ) : (
          <AdminDataTable<Battlecard>
            rows={battlecards}
            caption="Battlecards"
            columns={[
              { key: 'competitorName', header: 'Competitor', rowHeader: true },
              {
                key: 'tags',
                header: 'Tags',
                accessor: (row) =>
                  row.tags && row.tags.length > 0 ? (
                    <Group gap={4}>
                      {row.tags.map((tag) => (
                        <Badge key={tag} variant="light" size="xs" color="gray">{tag}</Badge>
                      ))}
                    </Group>
                  ) : '—',
              },
              { key: 'objections', header: 'Objections', numeric: true, accessor: (row) => row.objections.length },
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
                      onClick={() => deleteBattlecard(row)}
                      loading={deletingId === row.id}
                    >
                      <IconTrash size={14} />
                    </Button>
                  </Group>
                ),
              },
            ]}
            empty={<Text c="dimmed" size="sm">No battlecards yet. Create your first one above.</Text>}
            getRowKey={(row) => row.id}
          />
        )}
      </Stack>
    </Container>
  )
}
