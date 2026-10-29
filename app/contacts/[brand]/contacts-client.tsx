'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Box, Title, Text, Group, Stack, TextInput, Loader, Button, Select, ActionIcon, Paper } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState } from '@sovereignsquad/gds-admin/client'
import { StatusBadge, LabelTag, CountBadge, InlineAlert } from '@sovereignsquad/gds-core/client'
import { IconSearch, IconBrandLinkedin, IconDownload, IconX, IconBrandGoogle, IconCheck } from '@tabler/icons-react'
import { showNotification } from '@mantine/notifications'
import Link from 'next/link'
import type { Brand } from '@/app/lib/brand'
import { GoogleContactsWorkspaceModal } from '@/app/components/GoogleContactsWorkspaceModal'
import { PhoneActions } from '@/app/components/PhoneActions'

type BuyingRole = 'economic_buyer' | 'champion' | 'influencer' | 'blocker' | 'decision_maker' | 'unknown'

type ContactRow = {
  key: string
  name: string
  title: string
  email: string
  secondaryEmail?: string
  phone: string
  linkedin?: string
  buyingRole: BuyingRole
  isDecisionMaker: boolean
  crmStatus?: string
  leads: Array<{ leadId: string; entity_name: string }>
}

// Issue #206 — role-specific badge, replacing the single "Decision maker"
// badge. 'blocker' is danger (a real risk signal to flag, not
// decorative); 'unknown' renders no badge, same as the old
// isDecisionMaker: false "no badge" state.
const BUYING_ROLE_BADGE: Partial<Record<BuyingRole, { label: string; tone: 'neutral' | 'info' | 'success' | 'warning'; isDanger?: boolean }>> = {
  economic_buyer: { label: 'Economic Buyer', tone: 'info' },
  champion: { label: 'Champion', tone: 'success' },
  influencer: { label: 'Influencer', tone: 'info' },
  blocker: { label: 'Blocker', tone: 'warning', isDanger: true },
  decision_maker: { label: 'Decision Maker', tone: 'info' },
}

function getCrmStatusVariant(status?: string): 'neutral' | 'info' | 'success' | 'warning' | 'danger' {
  switch (status?.toLowerCase()) {
    case 'active':
    case 'customer':
      return 'success'
    case 'lead':
      return 'info'
    case 'inactive':
    case 'archived':
      return 'neutral'
    default:
      return 'info'
  }
}

type Props = {
  brand: Brand;
  label: string;
};

// Issue #139 — read-only aggregation view over every lead's own contacts[]
// array (GET /api/contacts). No create/edit affordance here at all: a
// contact is only ever edited from inside its own lead's detail modal
// (app/components/ContactsEditor.tsx), matching this page's role as another
// lens onto the same lead data (like Table/Kanban), not a competing source
// of truth. Per CLAUDE.md's UI-affordance rule, this page must never render
// as if editing were possible here.
export function ContactsClient({ brand, label }: Props) {
  const [tenantId, setTenantId] = useState('default')

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tenantId')) setTenantId(params.get('tenantId') || 'default')
    } catch {}
  }, [])

  const [query, setQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [crmStatusFilter, setCrmStatusFilter] = useState<string>('all')
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' })
  const [isGoogleConnected, setIsGoogleConnected] = useState<boolean | undefined>(undefined)
  const [connectedBanner, setConnectedBanner] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const checkConnectionStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/integrations/connections?brand=${encodeURIComponent(brand)}`)
      if (res.ok) {
        const data = await res.json()
        const active = (data.connections || []).some(
          (c: any) => c.provider === 'google_contacts' && c.status === 'active'
        )
        setIsGoogleConnected(active)
      } else {
        setIsGoogleConnected(false)
      }
    } catch {
      setIsGoogleConnected(false)
    }
  }, [brand])

  useEffect(() => {
    void checkConnectionStatus()
  }, [checkConnectionStatus])

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('connected') === 'google_contacts') {
        setConnectedBanner(true)
        setIsGoogleConnected(true)
        showNotification({
          title: 'Google Contacts Connected',
          message: 'Your Google Contacts account is now connected. You can import contacts into leads.',
          color: 'teal',
          autoClose: 5000,
        })
        const newUrl = new URL(window.location.href)
        newUrl.searchParams.delete('connected')
        window.history.replaceState({}, '', newUrl.toString())
      }
    } catch {}
  }, [])

  const loadContacts = useCallback(async (q: string, role: string, status: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = new URL('/api/contacts', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      if (q.trim()) url.searchParams.set('q', q.trim())
      if (role && role !== 'all') url.searchParams.set('buyingRole', role)
      if (status && status !== 'all') url.searchParams.set('crmStatus', status)
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to load contacts')
      const data = await res.json()
      setContacts(data.contacts || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load contacts')
    } finally {
      setLoading(false)
    }
  }, [brand, tenantId])

  // Debounced search-as-you-type, matching the pattern already established
  // on the sales board's own search box (app/sales/[brand]/sales-page-client.tsx).
  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => loadContacts(query, roleFilter, crmStatusFilter), 250)
    return () => clearTimeout(debounceRef.current)
  }, [query, roleFilter, crmStatusFilter, loadContacts])

  const sortedContacts = useMemo(() => {
    const list = [...contacts]
    list.sort((a, b) => {
      let cmp = 0
      if (sort.key === 'name') {
        cmp = (a.name || '').localeCompare(b.name || '')
      } else if (sort.key === 'leads' || sort.key === 'company') {
        const leadA = a.leads?.[0]?.entity_name || ''
        const leadB = b.leads?.[0]?.entity_name || ''
        cmp = leadA.localeCompare(leadB)
      } else if (sort.key === 'title') {
        cmp = (a.title || '').localeCompare(b.title || '')
      } else if (sort.key === 'email') {
        cmp = (a.email || '').localeCompare(b.email || '')
      } else if (sort.key === 'phone') {
        cmp = (a.phone || '').localeCompare(b.phone || '')
      } else if (sort.key === 'buyingRole') {
        cmp = (a.buyingRole || '').localeCompare(b.buyingRole || '')
      } else if (sort.key === 'crmStatus') {
        cmp = (a.crmStatus || '').localeCompare(b.crmStatus || '')
      }
      return sort.direction === 'asc' ? cmp : -cmp
    })
    return list
  }, [contacts, sort])

  return (
    <Box px={{ base: 'sm', sm: 'md', md: 'lg' }} py="md" w="100%" style={{ flex: 1, minWidth: 0 }}>
      <Stack gap="md">
        {/* Compact Application Header */}
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <div>
            <Group gap="xs" align="center">
              <Title order={2} style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Contacts</Title>
              <CountBadge value={contacts.length} size="md" srLabel="Total contacts" />
              {isGoogleConnected && (
                <StatusBadge status="success" size="xs">
                  Google Contacts Active
                </StatusBadge>
              )}
            </Group>
            <Text size="xs" c="dimmed" mt={2}>
              Every contact across <Text span fw={600}>{label}</Text> leads, searchable by name, company, title, and email.
            </Text>
          </div>
          <Group gap="xs" wrap="wrap">
            {isGoogleConnected ? (
              <Button
                variant="light"
                color="indigo"
                size="xs"
                leftSection={<IconBrandGoogle size={14} />}
                onClick={() => setImportModalOpen(true)}
              >
                Import from Google Contacts
              </Button>
            ) : isGoogleConnected === false ? (
              <Button
                component="a"
                href={`/api/integrations/google_contacts/connect?brand=${encodeURIComponent(brand)}&returnUrl=/contacts/${encodeURIComponent(brand)}`}
                variant="light"
                color="blue"
                size="xs"
                leftSection={<IconBrandGoogle size={14} />}
              >
                Connect Google Contacts
              </Button>
            ) : null}
            <Button
              component="a"
              href={`/api/contacts?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}&format=csv${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}${roleFilter !== 'all' ? `&buyingRole=${encodeURIComponent(roleFilter)}` : ''}${crmStatusFilter !== 'all' ? `&crmStatus=${encodeURIComponent(crmStatusFilter)}` : ''}`}
              variant="default"
              size="xs"
              leftSection={<IconDownload size={14} />}
              download
              disabled={contacts.length === 0}
            >
              Export CSV
            </Button>
          </Group>
        </Group>

        {connectedBanner && (
          <InlineAlert
            severity="success"
            title="Google Contacts Connected"
            message="Google Contacts connected successfully! You can now import contacts directly into your leads."
            action={
              <Group gap="xs" mt="xs">
                <Button size="xs" variant="filled" color="teal" onClick={() => setImportModalOpen(true)}>
                  Import Contacts
                </Button>
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setConnectedBanner(false)} aria-label="Dismiss notice">
                  <IconX size={12} />
                </ActionIcon>
              </Group>
            }
          />
        )}

        {/* High-Density Filter Toolbar */}
        <Paper withBorder p="xs" radius="md">
          <Group gap="xs" wrap="wrap" align="center">
            <TextInput
              style={{ flex: 1, minWidth: 260 }}
              size="xs"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search by name, company, title, email, phone…"
              aria-label="Search contacts"
              leftSection={<IconSearch size={14} />}
              rightSection={
                query ? (
                  <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => setQuery('')} aria-label="Clear search">
                    <IconX size={12} />
                  </ActionIcon>
                ) : null
              }
            />
            <Select
              size="xs"
              w={160}
              aria-label="Filter by buying role"
              value={roleFilter}
              onChange={(val) => setRoleFilter(val || 'all')}
              data={[
                { value: 'all', label: 'All Roles' },
                { value: 'economic_buyer', label: 'Economic Buyer' },
                { value: 'champion', label: 'Champion' },
                { value: 'decision_maker', label: 'Decision Maker' },
                { value: 'influencer', label: 'Influencer' },
                { value: 'blocker', label: 'Blocker' },
                { value: 'unknown', label: 'Unclassified' },
              ]}
            />
            <Select
              size="xs"
              w={140}
              aria-label="Filter by CRM status"
              value={crmStatusFilter}
              onChange={(val) => setCrmStatusFilter(val || 'all')}
              data={[
                { value: 'all', label: 'All Statuses' },
                { value: 'prospect', label: 'Prospect' },
                { value: 'lead', label: 'Lead' },
                { value: 'active', label: 'Active' },
                { value: 'customer', label: 'Customer' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
            {(query || roleFilter !== 'all' || crmStatusFilter !== 'all') && (
              <Button
                variant="subtle"
                color="gray"
                size="xs"
                onClick={() => {
                  setQuery('')
                  setRoleFilter('all')
                  setCrmStatusFilter('all')
                }}
              >
                Reset
              </Button>
            )}
          </Group>
        </Paper>

        {error && <AdminFormStatus state="error" title="Couldn't load contacts" description={error} />}

        {loading ? (
          <Group justify="center" py="xl"><Loader size="sm" /></Group>
        ) : contacts.length === 0 ? (
          <AdminResourceEmptyState
            title={query.trim() || roleFilter !== 'all' || crmStatusFilter !== 'all' ? 'No matching contacts' : 'No contacts yet'}
            description={query.trim() || roleFilter !== 'all' || crmStatusFilter !== 'all' ? 'Try adjusting your search query or role/status filters.' : 'Contacts appear here once leads have named contacts.'}
          />
        ) : (
          <AdminDataTable<ContactRow>
            rows={sortedContacts}
            caption={`Showing ${sortedContacts.length} contacts`}
            sort={sort}
            onSortChange={setSort}
            columns={[
              {
                key: 'name',
                header: 'Contact Name',
                rowHeader: true,
                sortable: true,
                width: 220,
                accessor: (row) => (
                  <Box>
                    <Text fw={600} size="sm">{row.name || '—'}</Text>
                    {row.secondaryEmail && (
                      <Text size="xs" c="dimmed" truncate title={row.secondaryEmail}>
                        Alt: {row.secondaryEmail}
                      </Text>
                    )}
                  </Box>
                ),
              },
              {
                key: 'leads',
                header: 'Company / Lead',
                sortable: true,
                width: 260,
                accessor: (row) => {
                  if (!row.leads || row.leads.length === 0) {
                    return <Text size="sm" c="dimmed">—</Text>
                  }
                  return (
                    <Group gap={6} wrap="wrap">
                      {row.leads.map((lead) => (
                        <Link
                          key={lead.leadId}
                          href={`/sales/${brand}?leadId=${encodeURIComponent(lead.leadId)}`}
                          style={{ textDecoration: 'none' }}
                          title={`Open ${lead.entity_name || 'lead'}`}
                        >
                          <LabelTag
                            tone="info"
                            size="xs"
                            label={lead.entity_name || 'Untitled lead'}
                            style={{
                              cursor: 'pointer',
                              maxWidth: 240,
                            }}
                          />
                        </Link>
                      ))}
                    </Group>
                  )
                },
              },
              {
                key: 'title',
                header: 'Title',
                sortable: true,
                width: 200,
                accessor: (row) => (
                  <Text size="sm" c={row.title ? undefined : 'dimmed'}>
                    {row.title || '—'}
                  </Text>
                ),
              },
              {
                key: 'buyingRole',
                header: 'Buying Role',
                sortable: true,
                width: 150,
                accessor: (row) => {
                  const badge = BUYING_ROLE_BADGE[row.buyingRole]
                  if (!badge) return <Text size="xs" c="dimmed">—</Text>
                  if (badge.isDanger) {
                    return (
                      <StatusBadge size="xs" status="danger">
                        {badge.label}
                      </StatusBadge>
                    )
                  }
                  return (
                    <LabelTag size="xs" tone={badge.tone} label={badge.label} />
                  )
                },
              },
              {
                key: 'email',
                header: 'Email',
                sortable: true,
                width: 240,
                accessor: (row) => {
                  if (!row.email) return <Text size="sm" c="dimmed">—</Text>
                  return (
                    <Text
                      component="a"
                      href={`mailto:${row.email}`}
                      size="sm"
                      c="blue"
                      style={{ textDecoration: 'none' }}
                    >
                      {row.email}
                    </Text>
                  )
                },
              },
              {
                key: 'phone',
                header: 'Phone / Chat',
                width: 220,
                accessor: (row) => (
                  <PhoneActions
                    phone={row.phone}
                    contactName={row.name}
                    leadId={row.leads?.[0]?.leadId}
                    brand={brand}
                  />
                ),
              },
              {
                key: 'linkedin',
                header: 'LinkedIn',
                width: 80,
                align: 'center',
                accessor: (row) => {
                  if (!row.linkedin) return <Text size="xs" c="dimmed">—</Text>
                  const href = row.linkedin.startsWith('http') ? row.linkedin : `https://${row.linkedin}`
                  return (
                    <ActionIcon
                      component="a"
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      size="sm"
                      variant="subtle"
                      color="blue"
                      aria-label={`Open LinkedIn profile for ${row.name || 'contact'}`}
                    >
                      <IconBrandLinkedin size={16} />
                    </ActionIcon>
                  )
                },
              },
              {
                key: 'crmStatus',
                header: 'Status',
                sortable: true,
                width: 110,
                accessor: (row) => {
                  const status = row.crmStatus || 'prospect'
                  return (
                    <StatusBadge size="xs" status={getCrmStatusVariant(status)}>
                      {status}
                    </StatusBadge>
                  )
                },
              },
            ]}
            renderMobileCard={(row) => (
              <Paper withBorder p="sm" radius="md">
                <Group justify="space-between" align="flex-start" mb="xs">
                  <div>
                    <Text fw={600} size="sm">{row.name || '—'}</Text>
                    {row.title && <Text size="xs" c="dimmed">{row.title}</Text>}
                  </div>
                  {BUYING_ROLE_BADGE[row.buyingRole] && (
                    BUYING_ROLE_BADGE[row.buyingRole]!.isDanger ? (
                      <StatusBadge size="xs" status="danger">
                        {BUYING_ROLE_BADGE[row.buyingRole]!.label}
                      </StatusBadge>
                    ) : (
                      <LabelTag
                        size="xs"
                        tone={BUYING_ROLE_BADGE[row.buyingRole]!.tone}
                        label={BUYING_ROLE_BADGE[row.buyingRole]!.label}
                      />
                    )
                  )}
                </Group>
                {row.leads?.length > 0 && (
                  <Group gap={4} mb="xs">
                    {row.leads.map((l) => (
                      <Link key={l.leadId} href={`/sales/${brand}?leadId=${encodeURIComponent(l.leadId)}`} style={{ textDecoration: 'none' }}>
                        <LabelTag tone="info" size="xs" label={l.entity_name} />
                      </Link>
                    ))}
                  </Group>
                )}
                <Group gap="md">
                  {row.email && (
                    <Text component="a" href={`mailto:${row.email}`} size="xs" c="blue">{row.email}</Text>
                  )}
                  {row.phone && (
                    <PhoneActions
                      phone={row.phone}
                      contactName={row.name}
                      leadId={row.leads?.[0]?.leadId}
                      brand={brand}
                      size="xs"
                    />
                  )}
                </Group>
              </Paper>
            )}
            empty={<Text c="dimmed" size="sm">No contacts match the criteria.</Text>}
            getRowKey={(row) => row.key}
          />
        )}
      </Stack>

      <GoogleContactsWorkspaceModal
        opened={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        brand={brand}
        tenantId={tenantId}
        onImported={() => void loadContacts(query, roleFilter, crmStatusFilter)}
      />
    </Box>
  )
}
