'use client'

import { useCallback, useEffect, useState, useMemo } from 'react'
import { Box, Container, Title, Text, Button, Group, Stack, TextInput, TagsInput, Pill, ActionIcon, Paper, Tooltip, Badge } from '@mantine/core'
import { IconPlus, IconTrash, IconSearch, IconCopy, IconCheck, IconX } from '@tabler/icons-react'
import { CountBadge, LabelTag } from '@sovereignsquad/gds-core/client'
import { AdminTextInput, AdminTextarea, AdminDataTable, AdminFormStatus } from '@sovereignsquad/gds-admin/client'
import { showNotification } from '@mantine/notifications'
import type { Brand } from '@/app/lib/brand'

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
  label: string;
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
export function BattlecardsClient({ brand, label }: Props) {
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
  const [searchQuery, setSearchQuery] = useState('')
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const copyToClipboard = useCallback((text: string, key: string, labelText: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      showNotification({
        title: 'Copied to clipboard',
        message: `${labelText} copied for call reference`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      });
      setTimeout(() => setCopiedKey(null), 2000);
    }
  }, []);

  const filteredBattlecards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return battlecards;
    return battlecards.filter((bc) => {
      const matchName = bc.competitorName.toLowerCase().includes(q);
      const matchSummary = bc.positioningSummary.toLowerCase().includes(q);
      const matchTags = (bc.tags || []).some((t) => t.toLowerCase().includes(q));
      const matchProof = (bc.proofPoints || []).some((p) => p.toLowerCase().includes(q));
      const matchObjections = (bc.objections || []).some(
        (o) => o.objection.toLowerCase().includes(q) || o.response.toLowerCase().includes(q)
      );
      return matchName || matchSummary || matchTags || matchProof || matchObjections;
    });
  }, [battlecards, searchQuery]);

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
    <Box px={{ base: 'sm', sm: 'md', md: 'lg' }} py="md" w="100%" style={{ flex: 1, minWidth: 0 }}>
      <Stack gap="md">
        {/* Compact Application Header matching Contacts reference */}
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <div>
            <Group gap="xs" align="center">
              <Title order={2} style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Battlecards</Title>
              <CountBadge value={battlecards.length} size="md" srLabel="Battlecard count" />
            </Group>
            <Text size="xs" c="dimmed" mt={2}>
              Competitor positioning and objection responses for <Text span fw={600}>{label}</Text>.
            </Text>
          </div>
          <Button size="xs" leftSection={<IconPlus size={14} />} onClick={resetForm} variant="light">
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

        {/* Quick Search & In-Call Reference Bar */}
        <Group justify="space-between" align="center" gap="sm">
          <TextInput
            placeholder="Search competitor, objection, talk-track, or tag... (e.g. Acme, pricing)"
            leftSection={<IconSearch size={15} color="var(--mantine-color-dimmed)" />}
            rightSection={
              searchQuery ? (
                <ActionIcon size="xs" variant="subtle" onClick={() => setSearchQuery('')} aria-label="Clear battlecard search">
                  <IconX size={13} />
                </ActionIcon>
              ) : null
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.currentTarget.value)}
            style={{ flex: 1, maxWidth: 500 }}
            size="sm"
          />
          {searchQuery && (
            <Badge variant="light" color="blue" size="md">
              {filteredBattlecards.length} {filteredBattlecards.length === 1 ? 'match' : 'matches'}
            </Badge>
          )}
        </Group>

        {loading ? (
          <AdminFormStatus state="loading" title="Loading battlecards" />
        ) : (
          <AdminDataTable<Battlecard>
            rows={filteredBattlecards}
            caption="Battlecards"
            columns={[
              {
                key: 'competitorName',
                header: 'Competitor',
                rowHeader: true,
                width: 220,
                accessor: (row) => (
                  <Stack gap={2}>
                    <Text fw={600} size="sm">{row.competitorName}</Text>
                    <Text size="xs" c="dimmed" lineClamp={2}>{row.positioningSummary}</Text>
                  </Stack>
                ),
              },
              {
                key: 'proofPoints',
                header: 'Key Proof Points (Click to copy)',
                width: 280,
                accessor: (row) =>
                  row.proofPoints && row.proofPoints.length > 0 ? (
                    <Stack gap={4}>
                      {row.proofPoints.map((point, idx) => {
                        const key = `${row.id}_proof_${idx}`;
                        const isCopied = copiedKey === key;
                        return (
                          <Group key={idx} gap={6} align="flex-start" wrap="nowrap">
                            <Tooltip label={isCopied ? 'Copied!' : 'Copy proof point to clipboard'} withArrow position="top">
                              <ActionIcon
                                size="xs"
                                variant={isCopied ? 'filled' : 'subtle'}
                                color={isCopied ? 'teal' : 'gray'}
                                onClick={() => copyToClipboard(point, key, 'Proof point')}
                                aria-label="Copy proof point"
                              >
                                {isCopied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                              </ActionIcon>
                            </Tooltip>
                            <Text size="xs" style={{ flex: 1 }}>{point}</Text>
                          </Group>
                        );
                      })}
                    </Stack>
                  ) : <Text size="xs" c="dimmed">—</Text>,
              },
              {
                key: 'objections',
                header: 'Objections & Rebuttals (Click to copy)',
                width: 320,
                accessor: (row) =>
                  row.objections && row.objections.length > 0 ? (
                    <Stack gap={6}>
                      {row.objections.map((obj, idx) => {
                        const key = `${row.id}_obj_${idx}`;
                        const isCopied = copiedKey === key;
                        return (
                          <Paper key={idx} withBorder p={6} radius="xs" bg="var(--mantine-color-gray-0)">
                            <Group justify="space-between" align="flex-start" wrap="nowrap" gap={4}>
                              <Text size="xs" fw={600} c="dark.4" style={{ flex: 1 }}>
                                &ldquo;{obj.objection}&rdquo;
                              </Text>
                              {obj.response && (
                                <Tooltip label={isCopied ? 'Copied!' : 'Copy rebuttal to clipboard'} withArrow position="left">
                                  <ActionIcon
                                    size="xs"
                                    variant={isCopied ? 'filled' : 'light'}
                                    color={isCopied ? 'teal' : 'blue'}
                                    onClick={() => copyToClipboard(obj.response, key, 'Objection rebuttal')}
                                    aria-label="Copy objection rebuttal"
                                  >
                                    {isCopied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                                  </ActionIcon>
                                </Tooltip>
                              )}
                            </Group>
                            {obj.response && (
                              <Text size="xs" c="dimmed" mt={2}>
                                {obj.response}
                              </Text>
                            )}
                          </Paper>
                        );
                      })}
                    </Stack>
                  ) : <Text size="xs" c="dimmed">0 objections</Text>,
              },
              {
                key: 'tags',
                header: 'Tags',
                width: 160,
                accessor: (row) =>
                  row.tags && row.tags.length > 0 ? (
                    <Group gap={4}>
                      {row.tags.map((tag) => (
                        <LabelTag key={tag} tone="neutral" size="xs" label={tag} />
                      ))}
                    </Group>
                  ) : '—',
              },
              {
                key: 'actions',
                header: '',
                width: 140,
                align: 'end',
                accessor: (row) => (
                  <Group gap="xs" justify="flex-end">
                    <Button size="xs" variant="light" onClick={() => startEdit(row)}>
                      Edit
                    </Button>
                    <Button
                      size="xs"
                      color="red"
                      variant="light"
                      onClick={() => deleteBattlecard(row)}
                      loading={deletingId === row.id}
                      aria-label={`Delete battlecard for ${row.competitorName}`}
                    >
                      <IconTrash size={14} />
                    </Button>
                  </Group>
                ),
              },
            ]}
            empty={
              searchQuery ? (
                <Text c="dimmed" size="sm">No battlecards match &ldquo;{searchQuery}&rdquo;. Try another search term.</Text>
              ) : (
                <Text c="dimmed" size="sm">No battlecards yet. Create your first one above.</Text>
              )
            }
            getRowKey={(row) => row.id}
          />
        )}
      </Stack>
    </Box>
  )
}
