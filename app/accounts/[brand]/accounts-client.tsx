'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Group, Stack, Badge, Loader, SimpleGrid, UnstyledButton } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState, AdminDetailDrawer, AdminModal, InfoCard, type AdminDataTableSort } from '@sovereignsquad/gds-admin/client'
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

  const sortedAccounts = [...accounts].sort((a, b) => {
    const dir = sort.direction === 'asc' ? 1 : -1;
    if (sort.key === 'activity') {
      const at = a.mostRecentUpdatedAt ? new Date(a.mostRecentUpdatedAt).getTime() : 0;
      const bt = b.mostRecentUpdatedAt ? new Date(b.mostRecentUpdatedAt).getTime() : 0;
      return (at - bt) * dir;
    }
    return (rollupRank(a) - rollupRank(b)) * dir;
  });

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
    </Stack>
  ) : null;

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <div>
          <Title order={2}>Accounts</Title>
          <Text size="sm" c="dimmed">
            Every parent organization with at least one <Text span fw={700}>{label}</Text> lead, grouped
            by <code>parentOrgId</code>, with a rollup of its leads. A lead with no parent organization set
            never appears here.
          </Text>
        </div>

        {error && <AdminFormStatus state="error" title="Couldn't load accounts" description={error} />}
        {truncated && (
          <Text size="sm" c="dimmed">
            Showing a partial list — more accounts exist than are shown below.
          </Text>
        )}

        {loading ? (
          <Group justify="center" py="lg"><Loader size="sm" /></Group>
        ) : sortedAccounts.length === 0 ? (
          <AdminResourceEmptyState
            title="No leads linked to a parent organization yet"
            description="Accounts appear here once a lead's parentOrgId is set."
          />
        ) : (
          <AdminDataTable<AccountRollup & Record<string, unknown>>
            rows={sortedAccounts as (AccountRollup & Record<string, unknown>)[]}
            caption="Accounts"
            sort={sort}
            onSortChange={setSort}
            columns={[
              {
                key: 'name',
                header: 'Organization',
                rowHeader: true,
                accessor: (row) => (
                  <UnstyledButton onClick={() => setSelectedParentOrgId(row.parentOrgId)} aria-label={`Open account ${row.parentOrgName || row.parentOrgId}`}>
                    <Text fw={600} c="indigo">{row.parentOrgName || row.parentOrgId}</Text>
                  </UnstyledButton>
                ),
              },
              {
                key: 'relationship',
                header: 'Relationship',
                accessor: (row) => (
                  <Group gap={4}>
                    {row.relationshipCodes.length === 0 ? '—' : row.relationshipCodes.map((code) => (
                      <Badge key={code} size="xs" color={RELATIONSHIP_BADGE_COLOR[code] ?? 'gray'} variant="light">{code}</Badge>
                    ))}
                  </Group>
                ),
              },
              { key: 'leadCount', header: 'Leads', numeric: true, accessor: (row) => row.leadCount },
              {
                key: 'value',
                header: 'Value',
                sortable: true,
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
                accessor: (row) => formatDate(row.mostRecentUpdatedAt),
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
    </Container>
  )
}
