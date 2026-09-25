'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Stack, Group, Button, Select, Paper, TextInput, CopyButton, ActionIcon, Tooltip, Checkbox, Divider } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState, AdminModal } from '@sovereignsquad/gds-admin/client'
import { StatusBadge } from '@sovereignsquad/gds-core/client'
import { IconPlus, IconTrash, IconCopy, IconCheck, IconRefresh } from '@tabler/icons-react'
import { useAuth } from '@/app/components/AuthProvider'
import type { ApiKeyScope } from '@/lib/scoped-api-keys'
import { VALID_WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@/lib/webhooks'

type ApiKeyRow = {
  id: string
  name: string
  brand: string
  scopes: ApiKeyScope[]
  keyPrefix: string
  createdBy: string
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

type WebhookRow = {
  id: string
  brand: string
  url: string
  events: WebhookEventType[]
  createdBy: string
  createdAt: string
  disabledAt: string | null
  disabledReason: string | null
  consecutiveFailures: number
}

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never used'
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 1) return 'Less than an hour ago'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Issue #210 — API key management (Phase 1) plus outbound webhook
// subscription management (sub-issue #219), sharing this one page and its
// brand selector rather than splitting into a second admin route.
export function AdminApiKeysClient() {
  const { brandLabels } = useAuth()
  const brandKeys = Object.keys(brandLabels)
  const [brand, setBrand] = useState<string>('')

  const [keys, setKeys] = useState<ApiKeyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<ApiKeyScope>('read')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)

  const [revokeTarget, setRevokeTarget] = useState<ApiKeyRow | null>(null)

  const [webhooks, setWebhooks] = useState<WebhookRow[]>([])
  const [webhooksLoading, setWebhooksLoading] = useState(true)
  const [webhooksError, setWebhooksError] = useState<string | null>(null)

  const [createWebhookOpen, setCreateWebhookOpen] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookEvents, setWebhookEvents] = useState<WebhookEventType[]>([])
  const [savingWebhook, setSavingWebhook] = useState(false)
  const [webhookSaveError, setWebhookSaveError] = useState<string | null>(null)
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null)

  const [deleteWebhookTarget, setDeleteWebhookTarget] = useState<WebhookRow | null>(null)

  useEffect(() => {
    if (!brand && brandKeys.length > 0) setBrand(brandKeys[0])
  }, [brand, brandKeys])

  const loadKeys = useCallback(async (forBrand: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/api-keys?brand=${encodeURIComponent(forBrand)}`)
      if (!res.ok) throw new Error(`Failed to load API keys (${res.status})`)
      const data = await res.json()
      setKeys(data.keys || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (brand) loadKeys(brand) }, [brand, loadKeys])

  function openCreate() {
    setName('')
    setScope('read')
    setRevealedKey(null)
    setSaveError(null)
    setCreateOpen(true)
  }

  async function createKey() {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, brand, scopes: [scope] }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Failed to create key (${res.status})`)
      }
      const data = await res.json()
      setRevealedKey(data.rawKey)
      await loadKeys(brand)
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to create key')
    } finally {
      setSaving(false)
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return
    try {
      const res = await fetch(`/api/admin/api-keys/${encodeURIComponent(revokeTarget.id)}?brand=${encodeURIComponent(brand)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('Failed to revoke key')
      setRevokeTarget(null)
      await loadKeys(brand)
    } catch (err: any) {
      setError(err?.message || 'Failed to revoke key')
    }
  }

  const loadWebhooks = useCallback(async (forBrand: string) => {
    setWebhooksLoading(true)
    setWebhooksError(null)
    try {
      const res = await fetch(`/api/admin/webhooks?brand=${encodeURIComponent(forBrand)}`)
      if (!res.ok) throw new Error(`Failed to load webhooks (${res.status})`)
      const data = await res.json()
      setWebhooks(data.webhooks || [])
    } catch (err: any) {
      setWebhooksError(err?.message || 'Failed to load webhooks')
    } finally {
      setWebhooksLoading(false)
    }
  }, [])

  useEffect(() => { if (brand) loadWebhooks(brand) }, [brand, loadWebhooks])

  function openCreateWebhook() {
    setWebhookUrl('')
    setWebhookEvents([])
    setRevealedSecret(null)
    setWebhookSaveError(null)
    setCreateWebhookOpen(true)
  }

  async function createWebhook() {
    setSavingWebhook(true)
    setWebhookSaveError(null)
    try {
      const res = await fetch('/api/admin/webhooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, url: webhookUrl, events: webhookEvents }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Failed to create webhook (${res.status})`)
      }
      const data = await res.json()
      setRevealedSecret(data.secret)
      await loadWebhooks(brand)
    } catch (err: any) {
      setWebhookSaveError(err?.message || 'Failed to create webhook')
    } finally {
      setSavingWebhook(false)
    }
  }

  async function confirmDeleteWebhook() {
    if (!deleteWebhookTarget) return
    try {
      const res = await fetch(`/api/admin/webhooks/${encodeURIComponent(deleteWebhookTarget.id)}?brand=${encodeURIComponent(brand)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete webhook')
      setDeleteWebhookTarget(null)
      await loadWebhooks(brand)
    } catch (err: any) {
      setWebhooksError(err?.message || 'Failed to delete webhook')
    }
  }

  async function reEnableWebhook(row: WebhookRow) {
    try {
      const res = await fetch(`/api/admin/webhooks/${encodeURIComponent(row.id)}?brand=${encodeURIComponent(brand)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      })
      if (!res.ok) throw new Error('Failed to re-enable webhook')
      await loadWebhooks(brand)
    } catch (err: any) {
      setWebhooksError(err?.message || 'Failed to re-enable webhook')
    }
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <div>
          <Title order={2}>Admin — API Keys &amp; Webhooks</Title>
          <Text size="sm" c="dimmed">
            Per-integration, per-brand, revocable credentials — a replacement for sharing one unscoped key across every machine caller. The raw key is shown exactly once, at creation. Below that: outbound webhook subscriptions, which push signed lead-lifecycle events to an external URL instead of requiring that system to poll.
          </Text>
        </div>

        <Select
          label="Brand"
          data={brandKeys.map((k) => ({ value: k, label: brandLabels[k] }))}
          value={brand || null}
          onChange={(value) => setBrand(value || '')}
          aria-label="Select brand to manage API keys and webhooks for"
          style={{ maxWidth: 300 }}
        />

        <Title order={3}>API Keys</Title>

        <Group justify="flex-end">
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate} disabled={!brand}>Create key</Button>
        </Group>

        {error && <AdminFormStatus state="error" title="Something went wrong" description={error} />}

        {loading ? (
          <Group justify="center" py="xl"><Text c="dimmed" size="sm">Loading…</Text></Group>
        ) : keys.length === 0 ? (
          <AdminResourceEmptyState title="No API keys yet for this brand" description="Create the first one above." />
        ) : (
          <AdminDataTable<ApiKeyRow & Record<string, unknown>>
            rows={keys as (ApiKeyRow & Record<string, unknown>)[]}
            caption={`API keys for ${brandLabels[brand] || brand}`}
            columns={[
              { key: 'name', header: 'Name', rowHeader: true, accessor: (row) => row.name },
              { key: 'prefix', header: 'Key', accessor: (row) => `${row.keyPrefix}…` },
              { key: 'scopes', header: 'Scope', accessor: (row) => row.scopes.join(', ') },
              { key: 'lastUsed', header: 'Last used', accessor: (row) => relativeTime(row.lastUsedAt) },
              {
                key: 'status',
                header: 'Status',
                accessor: (row) => row.revokedAt
                  ? <StatusBadge status="danger">Revoked</StatusBadge>
                  : <StatusBadge status="success">Active</StatusBadge>,
              },
              {
                key: 'actions',
                header: 'Actions',
                accessor: (row) => !row.revokedAt && (
                  <ActionIcon size="lg" variant="light" color="red" aria-label={`Revoke ${row.name}`} onClick={() => setRevokeTarget(row)}>
                    <IconTrash size={16} />
                  </ActionIcon>
                ),
              },
            ]}
            empty={<Text c="dimmed" size="sm">No keys.</Text>}
            getRowKey={(row) => row.id}
          />
        )}

        <Divider my="sm" />

        <Title order={3}>Webhooks</Title>
        <Text size="sm" c="dimmed">
          Registering a webhook grants the URL you enter a feed of lead data, including contact PII — only register endpoints you control. The signing secret is shown exactly once, at creation.
        </Text>

        <Group justify="flex-end">
          <Button leftSection={<IconPlus size={16} />} onClick={openCreateWebhook} disabled={!brand}>Add webhook</Button>
        </Group>

        {webhooksError && <AdminFormStatus state="error" title="Something went wrong" description={webhooksError} />}

        {webhooksLoading ? (
          <Group justify="center" py="xl"><Text c="dimmed" size="sm">Loading…</Text></Group>
        ) : webhooks.length === 0 ? (
          <AdminResourceEmptyState title="No webhooks yet for this brand" description="Add the first one above." />
        ) : (
          <AdminDataTable<WebhookRow & Record<string, unknown>>
            rows={webhooks as (WebhookRow & Record<string, unknown>)[]}
            caption={`Webhooks for ${brandLabels[brand] || brand}`}
            columns={[
              { key: 'url', header: 'URL', rowHeader: true, accessor: (row) => row.url },
              { key: 'events', header: 'Events', accessor: (row) => row.events.join(', ') },
              { key: 'failures', header: 'Consecutive failures', accessor: (row) => row.consecutiveFailures },
              {
                key: 'status',
                header: 'Status',
                accessor: (row) => row.disabledAt
                  ? <StatusBadge status="danger">Disabled — {row.disabledReason || 'disabled'}</StatusBadge>
                  : <StatusBadge status="success">Active</StatusBadge>,
              },
              {
                key: 'actions',
                header: 'Actions',
                accessor: (row) => (
                  <Group gap="xs" wrap="nowrap">
                    {row.disabledAt && (
                      <ActionIcon size="lg" variant="light" color="teal" aria-label={`Re-enable webhook for ${row.url}`} onClick={() => reEnableWebhook(row)}>
                        <IconRefresh size={16} />
                      </ActionIcon>
                    )}
                    <ActionIcon size="lg" variant="light" color="red" aria-label={`Delete webhook for ${row.url}`} onClick={() => setDeleteWebhookTarget(row)}>
                      <IconTrash size={16} />
                    </ActionIcon>
                  </Group>
                ),
              },
            ]}
            empty={<Text c="dimmed" size="sm">No webhooks.</Text>}
            getRowKey={(row) => row.id}
          />
        )}
      </Stack>

      <AdminModal opened={createOpen} onClose={() => setCreateOpen(false)} title="Create API key" size="sm">
        {revealedKey ? (
          <Stack gap="sm">
            <Text size="sm" fw={600} c="red">This key will not be shown again — copy it now.</Text>
            <Group gap="xs" wrap="nowrap">
              <TextInput value={revealedKey} readOnly style={{ flex: 1 }} aria-label="New API key" />
              <CopyButton value={revealedKey}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? 'Copied' : 'Copy'}>
                    <ActionIcon size="lg" variant="light" color={copied ? 'teal' : 'gray'} onClick={copy} aria-label="Copy API key">
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            <Group justify="flex-end">
              <Button onClick={() => setCreateOpen(false)}>Done</Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="sm">
            <TextInput label="Name" placeholder="e.g. research-agent-cogmap" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
            <Select
              label="Scope"
              data={[{ value: 'read', label: 'Read only' }, { value: 'read-write', label: 'Read + write' }]}
              value={scope}
              onChange={(v) => setScope((v as ApiKeyScope) || 'read')}
            />
            {saveError && <Text c="red" size="sm">{saveError}</Text>}
            <Group justify="flex-end" gap="xs">
              <Button variant="subtle" color="gray" onClick={() => setCreateOpen(false)} disabled={saving}>Cancel</Button>
              <Button onClick={createKey} loading={saving} disabled={!name.trim()}>Create</Button>
            </Group>
          </Stack>
        )}
      </AdminModal>

      <AdminModal opened={!!revokeTarget} onClose={() => setRevokeTarget(null)} title="Revoke key?" size="sm">
        <Stack gap="sm">
          <Text size="sm">
            Revoke <Text span fw={700}>{revokeTarget?.name}</Text>? Its next request will be rejected immediately. This can&apos;t be undone — there is no way to restore a revoked key.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button color="red" onClick={confirmRevoke}>Revoke</Button>
          </Group>
        </Stack>
      </AdminModal>

      <AdminModal opened={createWebhookOpen} onClose={() => setCreateWebhookOpen(false)} title="Add webhook" size="sm">
        {revealedSecret ? (
          <Stack gap="sm">
            <Text size="sm" fw={600} c="red">This signing secret will not be shown again — copy it now. Losing it means revoke and recreate; there is no recovery.</Text>
            <Group gap="xs" wrap="nowrap">
              <TextInput value={revealedSecret} readOnly style={{ flex: 1 }} aria-label="New webhook signing secret" />
              <CopyButton value={revealedSecret}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? 'Copied' : 'Copy'}>
                    <ActionIcon size="lg" variant="light" color={copied ? 'teal' : 'gray'} onClick={copy} aria-label="Copy webhook secret">
                      {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>
            <Group justify="flex-end">
              <Button onClick={() => setCreateWebhookOpen(false)}>Done</Button>
            </Group>
          </Stack>
        ) : (
          <Stack gap="sm">
            <TextInput
              label="URL"
              placeholder="https://example.com/webhooks/salesleadgenerator"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.currentTarget.value)}
              description="Must be a public https:// address you control — private/internal targets are rejected."
              required
            />
            <Checkbox.Group
              label="Events"
              value={webhookEvents}
              onChange={(values) => setWebhookEvents(values as WebhookEventType[])}
              description="At least one event is required."
            >
              <Stack gap="xs" mt="xs">
                {VALID_WEBHOOK_EVENT_TYPES.map((eventType) => (
                  <Checkbox key={eventType} value={eventType} label={eventType} />
                ))}
              </Stack>
            </Checkbox.Group>
            {webhookSaveError && <Text c="red" size="sm">{webhookSaveError}</Text>}
            <Group justify="flex-end" gap="xs">
              <Button variant="subtle" color="gray" onClick={() => setCreateWebhookOpen(false)} disabled={savingWebhook}>Cancel</Button>
              <Button onClick={createWebhook} loading={savingWebhook} disabled={!webhookUrl.trim() || webhookEvents.length === 0}>Add</Button>
            </Group>
          </Stack>
        )}
      </AdminModal>

      <AdminModal opened={!!deleteWebhookTarget} onClose={() => setDeleteWebhookTarget(null)} title="Delete webhook?" size="sm">
        <Stack gap="sm">
          <Text size="sm">
            Delete the webhook for <Text span fw={700}>{deleteWebhookTarget?.url}</Text>? Delivery stops immediately. This can&apos;t be undone.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={() => setDeleteWebhookTarget(null)}>Cancel</Button>
            <Button color="red" onClick={confirmDeleteWebhook}>Delete</Button>
          </Group>
        </Stack>
      </AdminModal>
    </Container>
  )
}
