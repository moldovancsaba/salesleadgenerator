'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Container, Title, Text, Stack, Group, Button, TextInput } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminModal } from '@sovereignsquad/gds-admin/client'
import { StatusBadge } from '@sovereignsquad/gds-core/client'
import {
  ALL_PROVIDERS, isOAuthProvider, PROVIDER_LABELS, type IntegrationProvider,
} from '@/lib/integration-connections'

type ConnectionRow = {
  id: string
  provider: IntegrationProvider
  authMethod: 'oauth2' | 'api_key'
  providerAccountLabel?: string
  status: 'active' | 'expired' | 'revoked' | 'error'
  lastVerifiedAt?: string
  lastSyncError?: string
}

type IntegrationsClientProps = { brand: string; label: string }

function relativeTime(iso: string | undefined): string {
  if (!iso) return 'Never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const hours = Math.floor(diffMs / 3_600_000)
  if (hours < 1) return 'Less than an hour ago'
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Issue #217 — one settings surface, consistent Connect/Reconnect/
// Disconnect/Test affordances across every provider (§13). Ships as a
// sub-page of the existing per-brand Sales Settings surface rather than a
// tab inside sales-settings-client.tsx's own 600+-line single form, which
// has no existing tab structure to extend.
export function IntegrationsClient({ brand, label }: IntegrationsClientProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [tenantId, setTenantId] = useState('default')
  const [connections, setConnections] = useState<ConnectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, string>>({})

  const [connectModalProvider, setConnectModalProvider] = useState<IntegrationProvider | null>(null)
  const [apiKeyValue, setApiKeyValue] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  const [disconnectTarget, setDisconnectTarget] = useState<ConnectionRow | null>(null)

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tenantId')) setTenantId(params.get('tenantId') || 'default')
    } catch {}
  }, [])

  const loadConnections = useCallback(async (forTenantId: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/integrations/connections?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(forTenantId)}`)
      if (!res.ok) throw new Error('Failed to load integration connections')
      const data = await res.json()
      setConnections(data.connections || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load integration connections')
    } finally {
      setLoading(false)
    }
  }, [brand])

  useEffect(() => { loadConnections(tenantId) }, [tenantId, loadConnections])

  // Surfaces the OAuth callback route's own redirect outcome (?connected=/
  // ?connect_error=), then strips the query params so a page refresh
  // doesn't re-show a stale banner.
  useEffect(() => {
    const connected = searchParams.get('connected')
    const connectErrorParam = searchParams.get('connect_error')
    if (connected) {
      setBanner({ type: 'success', message: `Connected to ${PROVIDER_LABELS[connected as IntegrationProvider] || connected}.` })
      router.replace(`/salessettings/${brand}/integrations`)
    } else if (connectErrorParam) {
      setBanner({ type: 'error', message: `Could not complete the connection (${connectErrorParam}). Please try again.` })
      router.replace(`/salessettings/${brand}/integrations`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  function openConnect(provider: IntegrationProvider) {
    if (isOAuthProvider(provider)) {
      // A real browser navigation, not a Next.js client-side route
      // transition — this route returns an HTTP redirect to Google's own
      // consent screen, outside this app's routing entirely. Same pattern
      // already established by AuthProvider.tsx's own SSO login redirect.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = `/api/integrations/${provider}/connect?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`
      return
    }
    setApiKeyValue('')
    setConnectError(null)
    setConnectModalProvider(provider)
  }

  async function submitApiKeyConnect() {
    if (!connectModalProvider) return
    setConnecting(true)
    setConnectError(null)
    try {
      const res = await fetch(`/api/integrations/${connectModalProvider}/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, tenantId, apiKey: apiKeyValue.trim() }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Could not verify this key against the provider')
      }
      const connectedProvider = connectModalProvider
      setConnectModalProvider(null)
      setBanner({ type: 'success', message: `Connected to ${PROVIDER_LABELS[connectedProvider]}.` })
      await loadConnections(tenantId)
    } catch (err: any) {
      setConnectError(err?.message || 'Could not verify this key against the provider')
    } finally {
      setConnecting(false)
    }
  }

  async function confirmDisconnect() {
    if (!disconnectTarget) return
    try {
      const res = await fetch(`/api/integrations/connections/${disconnectTarget.id}/disconnect`, { method: 'POST' })
      if (!res.ok) throw new Error('Failed to disconnect')
      setDisconnectTarget(null)
      await loadConnections(tenantId)
    } catch (err: any) {
      setError(err?.message || 'Failed to disconnect')
    }
  }

  async function runTest(row: ConnectionRow) {
    setTestingId(row.id)
    try {
      const res = await fetch(`/api/integrations/connections/${row.id}/test`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      setTestResult((prev) => ({
        ...prev,
        [row.id]: data.status === 'active' ? 'Connection verified.' : `Verification failed: ${data.lastSyncError || 'unknown error'}`,
      }))
      await loadConnections(tenantId)
    } catch {
      setTestResult((prev) => ({ ...prev, [row.id]: 'Verification failed: could not reach the server.' }))
    } finally {
      setTestingId(null)
    }
  }

  const rows = ALL_PROVIDERS.map((provider) => ({
    provider,
    label: PROVIDER_LABELS[provider],
    connection: connections.find((c) => c.provider === provider),
  }))

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <div>
          <Title order={2}>{label} — Integrations</Title>
          <Text size="sm" c="dimmed">
            Connect this brand to Google Calendar, Gmail, Google Contacts, and Calendly. A connection is
            entered here at runtime by an admin, encrypted at rest, and never shown again after it&apos;s
            saved — for Calendly, the pasted token is verified against the provider before it&apos;s ever
            stored.
          </Text>
        </div>

        {banner && (
          <AdminFormStatus
            state={banner.type}
            title={banner.type === 'success' ? 'Success' : 'Something went wrong'}
            description={banner.message}
          />
        )}
        {error && <AdminFormStatus state="error" title="Something went wrong" description={error} />}

        {loading ? (
          <Group justify="center" py="xl"><Text c="dimmed" size="sm">Loading…</Text></Group>
        ) : (
          <AdminDataTable<{ provider: IntegrationProvider; label: string; connection?: ConnectionRow } & Record<string, unknown>>
            rows={rows}
            caption={`Integrations for ${label}`}
            columns={[
              { key: 'provider', header: 'Provider', rowHeader: true, accessor: (row) => row.label },
              {
                key: 'account',
                header: 'Connected as',
                accessor: (row) => row.connection && row.connection.status !== 'revoked'
                  ? (row.connection.providerAccountLabel || '(connected)')
                  : 'Not connected',
              },
              {
                key: 'status',
                header: 'Status',
                accessor: (row) => {
                  const connection = row.connection
                  if (!connection) return <Text size="sm" c="dimmed">—</Text>
                  if (connection.status === 'active') return <StatusBadge status="success">Active</StatusBadge>
                  if (connection.status === 'revoked') return <StatusBadge status="neutral">Revoked</StatusBadge>
                  return <StatusBadge status="danger">{connection.status === 'expired' ? 'Expired' : 'Error'}</StatusBadge>
                },
              },
              {
                key: 'lastVerified',
                header: 'Last verified',
                accessor: (row) => relativeTime(row.connection?.lastVerifiedAt),
              },
              {
                key: 'actions',
                header: 'Actions',
                accessor: (row) => {
                  const connection = row.connection
                  return (
                    <Group gap="xs" wrap="nowrap">
                      <Button size="xs" variant="light" onClick={() => openConnect(row.provider)}>
                        {connection ? 'Reconnect' : 'Connect'}
                      </Button>
                      {connection && connection.status !== 'revoked' && (
                        <>
                          <Button size="xs" variant="light" loading={testingId === connection.id} onClick={() => runTest(connection)}>Test</Button>
                          <Button size="xs" variant="light" color="red" onClick={() => setDisconnectTarget(connection)}>Disconnect</Button>
                        </>
                      )}
                    </Group>
                  )
                },
              },
            ]}
            getRowKey={(row) => row.provider}
            empty={<Text c="dimmed" size="sm">No providers.</Text>}
          />
        )}

        {Object.entries(testResult).map(([id, message]) => (
          <Text key={id} size="xs" c="dimmed" role="status" aria-live="polite">{message}</Text>
        ))}
      </Stack>

      <AdminModal
        opened={!!connectModalProvider}
        onClose={() => setConnectModalProvider(null)}
        title={`Connect ${connectModalProvider ? PROVIDER_LABELS[connectModalProvider] : ''}`}
        size="sm"
      >
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Generate a personal access token in Calendly (Integrations → API &amp; Webhooks → Generate new
            token) and paste it below. Calendly does not display or store it after generation — if it&apos;s
            lost, generate a new one; there is no recovery. This token acts with the full permission of
            your Calendly account, broader than a Google connection&apos;s scoped access.
          </Text>
          <TextInput
            label="Personal access token"
            type="password"
            value={apiKeyValue}
            onChange={(e) => setApiKeyValue(e.currentTarget.value)}
            aria-describedby={connectError ? 'integration-connect-error' : undefined}
          />
          {connectError && <Text id="integration-connect-error" c="red" size="sm" role="alert">{connectError}</Text>}
          <Text size="xs" c="dimmed">Verified immediately and stored encrypted — never displayed again after this closes.</Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={() => setConnectModalProvider(null)} disabled={connecting}>Cancel</Button>
            <Button onClick={submitApiKeyConnect} loading={connecting} disabled={!apiKeyValue.trim()}>Connect</Button>
          </Group>
        </Stack>
      </AdminModal>

      <AdminModal opened={!!disconnectTarget} onClose={() => setDisconnectTarget(null)} title="Disconnect?" size="sm">
        <Stack gap="sm">
          <Text size="sm">
            Disconnect <Text span fw={700}>{disconnectTarget ? PROVIDER_LABELS[disconnectTarget.provider] : ''}</Text>?
            Any feature relying on it will stop working until it&apos;s reconnected.
          </Text>
          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={() => setDisconnectTarget(null)}>Cancel</Button>
            <Button color="red" onClick={confirmDisconnect}>Disconnect</Button>
          </Group>
        </Stack>
      </AdminModal>
    </Container>
  )
}
