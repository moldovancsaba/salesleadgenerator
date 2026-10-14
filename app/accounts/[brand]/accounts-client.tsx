'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Container, Title, Text, Group, Stack, Badge, Loader, SimpleGrid, UnstyledButton, Button, Box, TextInput, ActionIcon, Paper } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState, AdminDetailDrawer, AdminModal, InfoCard, type AdminDataTableSort } from '@sovereignsquad/gds-admin/client'
import { IconSearch, IconX, IconDownload } from '@tabler/icons-react'
import Link from 'next/link'
import type { Brand } from '@/app/lib/brand'
import { CURRENCY_SYMBOLS, type CurrencyCode } from '@/app/lib/brand-constants'
import { TABLET_LANDSCAPE_MAX } from '../../constants'
import { useIsCompactViewport } from '../../lib/use-is-compact-viewport'
import type { AccountRollup, AccountDetail } from '../../../lib/accounts'

type Props = {
  brand: Brand;
  label: string;
  currency: CurrencyCode;
};

// Issue #209 §15 — a group's own relationshipCodes chip set uses the same
// plain-color-mapped Mantine Badge convention as contacts-client.tsx's
// buyingRole badges (a categorical label, not a health/system status, so
// GDS's StatusBadge's success/danger/warning/info semantics don't fit).
const RELATIONSHIP_BADGE_COLOR: Record<string, string> = {
  owned: 'indigo',
  operated: 'blue',
  licensed: 'grape',
  franchise: 'teal',
  affiliate: 'cyan',
  partner: 'green',
  unverified: 'gray',
};

function formatMoney(value: number, currency: CurrencyCode): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? '$';
  return `${symbol}${Math.round(value).toLocaleString()}`;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function rollupRank(rollup: AccountRollup): number {
  return rollup.pipelineValueUsd + rollup.wonValueUsd;
}

// Issue #209, Phase 1 — a read-only, rep-facing view grouping leads by their
// existing parentOrgId field (see lib/accounts.ts for the rollup math and
// docs/ARCHITECTURE.md for the Phase 1 virtual-view design). No create/edit
// affordance anywhere on this page, matching app/contacts/[brand] — an
// Account here is purely a computed lens onto existing lead data, never a
// new source of truth (CLAUDE.md's UI-affordance rule).
export function AccountsClient({ brand, label, currency }: Props) {
  const [tenantId, setTenantId] = useState('default')

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tenantId')) setTenantId(params.get('tenantId') || 'default')
    } catch {}
  }, [])

  const [accounts, setAccounts] = useState<AccountRollup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [sort, setSort] = useState<AdminDataTableSort>({ key: 'value', direction: 'desc' })

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = new URL('/api/accounts', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to load accounts')
      const data = await res.json()
      setAccounts(data.accounts || [])
      setTruncated(Boolean(data.truncated))
    } catch (err: any) {
      setError(err?.message || 'Failed to load accounts')
    } finally {
      setLoading(false)
    }
  }, [brand, tenantId])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  const [query, setQuery] = useState('')

  const filteredAccounts = useMemo(() => {
    let list = accounts
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter((a) =>
        (a.parentOrgName && a.parentOrgName.toLowerCase().includes(q)) ||
        a.parentOrgId.toLowerCase().includes(q) ||
        a.relationshipCodes.some((code) => code.toLowerCase().includes(q))
      )
    }
    return [...list].sort((a, b) => {
      const dir = sort.direction === 'asc' ? 1 : -1;
      if (sort.key === 'name') {
        const nameA = a.parentOrgName || a.parentOrgId;
        const nameB = b.parentOrgName || b.parentOrgId;
        return nameA.localeCompare(nameB) * dir;
      }
      if (sort.key === 'leadCount') {
        return (a.leadCount - b.leadCount) * dir;
      }
      if (sort.key === 'activity') {
        const at = a.mostRecentUpdatedAt ? new Date(a.mostRecentUpdatedAt).getTime() : 0;
        const bt = b.mostRecentUpdatedAt ? new Date(b.mostRecentUpdatedAt).getTime() : 0;
        return (at - bt) * dir;
      }
      return (rollupRank(a) - rollupRank(b)) * dir;
    });
  }, [accounts, query, sort]);

  const [selectedParentOrgId, setSelectedParentOrgId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AccountDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const fullScreen = useIsCompactViewport(TABLET_LANDSCAPE_MAX, true);

  useEffect(() => {
    if (!selectedParentOrgId) { setDetail(null); return }
    let cancelled = false;
    setDetailLoading(true)
    setDetailError(null)
    const url = new URL(`/api/accounts/${encodeURIComponent(selectedParentOrgId)}`, window.location.origin)
    url.searchParams.set('brand', brand)
    url.searchParams.set('tenantId', tenantId)
    fetch(url.toString())
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load account')
        const data = await res.json()
        if (!cancelled) setDetail(data.account)
      })
      .catch((err: any) => { if (!cancelled) setDetailError(err?.message || 'Failed to load account') })
      .finally(() => { if (!cancelled) setDetailLoading(false) })
    return () => { cancelled = true }
  }, [selectedParentOrgId, brand, tenantId])

  const closeDetail = () => setSelectedParentOrgId(null)

  const detailBody = detailLoading ? (
    <Group justify="center" py="lg"><Loader size="sm" /></Group>
  ) : detailError ? (
    <AdminFormStatus state="error" title="Couldn't load account" description={detailError} />
  ) : detail ? (
    <Stack gap="md">
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm">
        <InfoCard title="Leads" value={detail.leadCount} />
        <InfoCard title="Pipeline" value={formatMoney(detail.pipelineValueUsd, currency)} />
        <InfoCard title="Won (USD)" value={formatMoney(detail.wonValueUsd, 'USD')} />
        <InfoCard title="Contacts" value={detail.contactCount} />
      </SimpleGrid>
      {detail.relationshipCodes.length > 0 && (
        <Group gap={6}>
          {detail.relationshipCodes.map((code) => (
            <Badge key={code} color={RELATIONSHIP_BADGE_COLOR[code] ?? 'gray'} variant="light">{code}</Badge>
          ))}
        </Group>
      )}
      <AdminDataTable
        rows={detail.leads}
        caption="Leads in this account"
        columns={[
          {
            key: 'entity_name',
            header: 'Lead',
            rowHeader: true,
            accessor: (row) => (
              <Link href={`/sales/${brand}?leadId=${encodeURIComponent(row._id)}`}>
                {row.entity_name || 'Untitled lead'}
              </Link>
            ),
          },
          { key: 'kanbanColumn', header: 'Stage', accessor: (row) => row.kanbanColumn || '—' },
          { key: 'sport_or_sector', header: 'Sector', accessor: (row) => row.sport_or_sector || '—' },
          {
            key: 'value',
            header: 'Value',
            accessor: (row) => {
              if (row.kanbanColumn === 'WON' && typeof row.actualDealValueUsd === 'number') {
                return formatMoney(row.actualDealValueUsd, 'USD');
              }
              if (row.ticketSizeEstimate?.method !== 'unconfigured' && typeof row.ticketSizeEstimate?.expected === 'number') {
                return formatMoney(row.ticketSizeEstimate.expected, row.ticketSizeEstimate.currency ?? currency);
              }
              return '—';
            },
          },
          { key: 'updatedAt', header: 'Last updated', accessor: (row) => formatDate(row.updatedAt || null) },
        ]}
        empty={<Text c="dimmed" size="sm">No leads.</Text>}
        getRowKey={(row) => row._id}
      />
      <Box mt="xs">
        <Group justify="space-between" align="center" mb="xs">
          <Text size="xs" fw={700} c="dimmed" tt="uppercase">Account Activity Timeline</Text>
          <Badge size="xs" variant="light" color="indigo">{detail.activities?.length || 0} events</Badge>
        </Group>
        {!detail.activities || detail.activities.length === 0 ? (
          <Text size="xs" c="dimmed">No activity recorded across this account&apos;s leads yet.</Text>
        ) : (
          <Stack gap="xs">
            {detail.activities.map((act) => (
              <Box key={act.id} p="xs" style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6 }}>
                <Group justify="space-between" gap="xs" wrap="nowrap">
                  <Group gap={4} wrap="wrap">
                    {act.leadName && (
                      <Link href={`/sales/${brand}?leadId=${encodeURIComponent(act.leadId)}`} style={{ textDecoration: 'none' }}>
                        <Badge size="xs" variant="filled" color="dark">
                          {act.leadName}
                        </Badge>
                      </Link>
                    )}
                    <Badge size="xs" variant="light" color={act.type === 'call' ? 'grape' : act.type === 'meeting-scheduled' ? 'indigo' : act.type === 'note' ? 'yellow' : act.direction === 'inbound' ? 'teal' : 'blue'}>
                      {act.type === 'call' ? 'Call' : act.type === 'meeting-scheduled' ? 'Meeting' : act.type === 'note' ? 'Note' : act.direction === 'inbound' ? 'Inbound reply' : 'Outbound email'}
                    </Badge>
                    {(act.dealLabel || act.dealId) && (
                      <Badge size="xs" variant="outline" color="cyan">{act.dealLabel || `Deal ${act.dealId?.slice(0, 8)}`}</Badge>
                    )}
                    {act.callDisposition && (
                      <Badge size="xs" variant="outline" color="gray">{act.callDisposition}</Badge>
                    )}
                    {act.emailStatus && (
                      <Badge size="xs" variant="light" color={act.emailStatus === 'replied' ? 'teal' : act.emailStatus === 'opened' ? 'green' : 'blue'}>
                        {act.emailStatus}
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">{new Date(act.createdAt).toLocaleString()}</Text>
                </Group>
                {act.subject && <Text size="xs" fw={600} mt={4}>{act.subject}</Text>}
                {act.bodyExcerpt && (
                  <Text size="xs" c={act.type === 'note' ? undefined : 'dimmed'} mt={2} lineClamp={act.type === 'note' ? 4 : 2} style={act.type === 'note' ? { whiteSpace: 'pre-wrap' } : undefined}>
                    {act.bodyExcerpt}
                  </Text>
                )}
                {(act.loggedBy || act.callDurationMinutes) && (
                  <Text size="xs" c="dimmed" mt={2}>
                    {act.callDurationMinutes ? `${act.callDurationMinutes} min · ` : ''}
                    {act.loggedBy ? `Logged by ${act.loggedBy}` : ''}
                  </Text>
                )}
              </Box>
            ))}
          </Stack>
        )}
      </Box>
    </Stack>
  ) : null;

  return (
    <Box px={{ base: 'sm', sm: 'md', md: 'lg' }} py="md" w="100%" style={{ flex: 1, minWidth: 0 }}>
      <Stack gap="md">
        {/* Compact Application Header matching Contacts reference */}
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <div>
            <Group gap="xs" align="center">
              <Title order={2} style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Accounts</Title>
              <Badge variant="light" color="indigo" size="md">
                {filteredAccounts.length} {filteredAccounts.length === 1 ? 'account' : 'accounts'}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" mt={2}>
              Every parent organization with at least one <Text span fw={600}>{label}</Text> lead, grouped by <code>parentOrgId</code>.
            </Text>
          </div>
          <Button
            component="a"
            href={`/api/accounts?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}&format=csv${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}`}
            variant="default"
            size="xs"
            leftSection={<IconDownload size={14} />}
            download
            disabled={accounts.length === 0}
          >
            Export CSV
          </Button>
        </Group>

        {/* High-Density Filter Toolbar matching Contacts reference */}
        <Paper withBorder p="xs" radius="md">
          <Group gap="xs" wrap="wrap" align="center">
            <TextInput
              style={{ flex: 1, minWidth: 260 }}
              size="xs"
              value={query}
              onChange={(e) => setQuery(e.currentTarget.value)}
              placeholder="Search accounts by organization name or ID…"
              aria-label="Search accounts"
              leftSection={<IconSearch size={14} />}
              rightSection={
                query ? (
                  <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setQuery('')} aria-label="Clear search">
                    <IconX size={12} />
                  </ActionIcon>
                ) : null
              }
            />
            {query && (
              <Button variant="subtle" color="gray" size="xs" onClick={() => setQuery('')}>
                Reset
              </Button>
            )}
          </Group>
        </Paper>

        {error && <AdminFormStatus state="error" title="Couldn't load accounts" description={error} />}
        {truncated && (
          <Text size="sm" c="dimmed">
            Showing a partial list — more accounts exist than are shown below.
          </Text>
        )}

        {loading ? (
          <Group justify="center" py="lg"><Loader size="sm" /></Group>
        ) : filteredAccounts.length === 0 ? (
          <AdminResourceEmptyState
            title={query ? 'No matching accounts' : 'No leads linked to a parent organization yet'}
            description={query ? 'Try adjusting your search query.' : "Accounts appear here once a lead's parentOrgId is set."}
          />
        ) : (
          <AdminDataTable<AccountRollup & Record<string, unknown>>
            rows={filteredAccounts as (AccountRollup & Record<string, unknown>)[]}
            caption="Accounts"
            sort={sort}
            onSortChange={setSort}
            columns={[
              {
                key: 'name',
                header: 'Organization',
                rowHeader: true,
                sortable: true,
                width: 260,
                accessor: (row) => (
                  <UnstyledButton onClick={() => setSelectedParentOrgId(row.parentOrgId)} aria-label={`Open account ${row.parentOrgName || row.parentOrgId}`}>
                    <Text fw={600} c="indigo">{row.parentOrgName || row.parentOrgId}</Text>
                  </UnstyledButton>
                ),
              },
              {
                key: 'relationship',
                header: 'Relationship',
                width: 200,
                accessor: (row) => (
                  <Group gap={4}>
                    {row.relationshipCodes.length === 0 ? '—' : row.relationshipCodes.map((code) => (
                      <Badge key={code} size="xs" color={RELATIONSHIP_BADGE_COLOR[code] ?? 'gray'} variant="light">{code}</Badge>
                    ))}
                  </Group>
                ),
              },
              { key: 'leadCount', header: 'Leads', numeric: true, sortable: true, width: 100, accessor: (row) => row.leadCount },
              {
                key: 'value',
                header: 'Value',
                sortable: true,
                width: 240,
                accessor: (row) => (
                  <Text size="sm">
                    {formatMoney(row.pipelineValueUsd, currency)} pipeline
                    {row.wonValueUsd > 0 ? ` + ${formatMoney(row.wonValueUsd, 'USD')} won` : ''}
                  </Text>
                ),
              },
              {
                key: 'activity',
                header: 'Last activity',
                sortable: true,
                width: 160,
                accessor: (row) => formatDate(row.mostRecentUpdatedAt),
              },
              {
                key: 'actions',
                header: '',
                width: 80,
                align: 'end',
                accessor: (row) => (
                  <Button size="xs" variant="light" color="indigo" onClick={() => setSelectedParentOrgId(row.parentOrgId)}>
                    View
                  </Button>
                ),
              },
            ]}
            empty={<Text c="dimmed" size="sm">No accounts.</Text>}
            getRowKey={(row) => row.parentOrgId}
          />
        )}
      </Stack>

      {fullScreen ? (
        <AdminModal opened={!!selectedParentOrgId} onClose={closeDetail} title={detail?.parentOrgName || selectedParentOrgId || ''} size="full">
          {detailBody}
        </AdminModal>
      ) : (
        <AdminDetailDrawer opened={!!selectedParentOrgId} onClose={closeDetail} title={detail?.parentOrgName || selectedParentOrgId || ''}>
          {detailBody}
        </AdminDetailDrawer>
      )}
    </Box>
  )
}
