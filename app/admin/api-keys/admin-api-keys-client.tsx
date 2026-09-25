'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Stack, Group, Button, Select, Paper, TextInput, CopyButton, ActionIcon, Tooltip } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState, AdminModal } from '@sovereignsquad/gds-admin/client'
import { StatusBadge } from '@sovereignsquad/gds-core/client'
import { IconPlus, IconTrash, IconCopy, IconCheck } from '@tabler/icons-react'
import { useAuth } from '@/app/components/AuthProvider'
import type { ApiKeyScope } from '@/lib/scoped-api-keys'

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

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never used'
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 1) return 'Less than an hour ago'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Issue #210, Phase 1 — API key management (issuance, listing, revocation).
// Webhook management (the issue's own second half) is deliberately not
// built here — see docs/ARCHITECTURE.md for why this delivery is scoped
// to Phase 1/5-partial of the issue's own 6-phase sequencing.
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

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <div>
          <Title order={2}>Admin — API Keys</Title>
          <Text size="sm" c="dimmed">
            Per-integration, per-brand, revocable credentials — a replacement for sharing one unscoped key across every machine caller. The raw key is shown exactly once, at creation.
          </Text>
        </div>

        <Select
          label="Brand"
          data={brandKeys.map((k) => ({ value: k, label: brandLabels[k] }))}
          value={brand || null}
          onChange={(value) => setBrand(value || '')}
          aria-label="Select brand to manage API keys for"
          style={{ maxWidth: 300 }}
        />

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
    </Container>
  )
}
