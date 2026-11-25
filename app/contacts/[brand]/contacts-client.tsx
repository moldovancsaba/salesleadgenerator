'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Title, Text, Group, Stack, TextInput, Loader, Button, Select, ActionIcon, Paper, Pagination } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState } from '@sovereignsquad/gds-admin/client'
import { StatusBadge, LabelTag, CountBadge, InlineAlert } from '@sovereignsquad/gds-core/client'
import { IconSearch, IconBrandLinkedin, IconDownload, IconX, IconBrandGoogle, IconCheck, IconMail, IconPlugConnected, IconWorld, IconPhone } from '@tabler/icons-react'
import { showNotification } from '@mantine/notifications'
import Link from 'next/link'
import type { Brand } from '@/app/lib/brand'
import { GoogleContactsWorkspaceModal } from '@/app/components/GoogleContactsWorkspaceModal'
import { ApolloImportModal } from '@/app/components/ApolloImportModal'
import { PhoneActions } from '@/app/components/PhoneActions'
import { OutreachComposeModal } from '@/app/outreach/compose-modal'

type BuyingRole = 'economic_buyer' | 'champion' | 'influencer' | 'blocker' | 'decision_maker' | 'unknown'

type ContactRow = {
  key: string
  name: string
  firstName?: string
  lastName?: string
  country?: string
  company?: string
  title: string
  department?: string
  industry?: string
  email: string
  secondaryEmail?: string
  phone: string
  linkedin?: string
  companyWebsite?: string
  companyLinkedin?: string
  companyPhone?: string
  leadSource?: string
  lastResearchedAt?: string
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
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [countryFilter, setCountryFilter] = useState<string>('')
  const [phoneOnlyFilter, setPhoneOnlyFilter] = useState<boolean>(false)
  const [emailOnlyFilter, setEmailOnlyFilter] = useState<boolean>(false)
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [totalContacts, setTotalContacts] = useState(0)
  const [filteredCount, setFilteredCount] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(100)
  const [totalPages, setTotalPages] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'name', direction: 'asc' })
  const [isGoogleConnected, setIsGoogleConnected] = useState<boolean | undefined>(undefined)
  const [isApolloConnected, setIsApolloConnected] = useState<boolean>(false)
  const [connectedBanner, setConnectedBanner] = useState(false)
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [apolloModalOpen, setApolloModalOpen] = useState(false)
  const [outreachTarget, setOutreachTarget] = useState<{
    lead: Record<string, any>;
    contactEmail?: string;
    contactName?: string;
  } | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const checkConnectionStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/integrations/connections?brand=${encodeURIComponent(brand)}`)
      if (res.ok) {
        const data = await res.json()
        const list = data.connections || []
        const active = list.some(
          (c: any) => c.provider === 'google_contacts' && c.status === 'active'
        )
        const apolloActive = list.some(
          (c: any) => c.provider === 'apollo' && c.status === 'active'
        )
        setIsGoogleConnected(active)
        setIsApolloConnected(apolloActive)
      } else {
        setIsGoogleConnected(false)
        setIsApolloConnected(false)
      }
    } catch {
      setIsGoogleConnected(false)
      setIsApolloConnected(false)
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

  const loadContacts = useCallback(async (
    q: string,
    role: string,
    status: string,
    dept: string,
    country: string,
    phoneOnly: boolean,
    emailOnly: boolean,
    targetPage: number,
    targetPageSize: number,
    targetSort: { key: string; direction: 'asc' | 'desc' }
  ) => {
    setLoading(true)
    setError(null)
    try {
      const url = new URL('/api/contacts', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      url.searchParams.set('page', String(targetPage))
      url.searchParams.set('pageSize', String(targetPageSize))
      url.searchParams.set('sortBy', targetSort.key)
      url.searchParams.set('sortDir', targetSort.direction)
      if (q.trim()) url.searchParams.set('q', q.trim())
      if (role && role !== 'all') url.searchParams.set('buyingRole', role)
      if (status && status !== 'all') url.searchParams.set('crmStatus', status)
      if (dept && dept !== 'all') url.searchParams.set('department', dept)
      if (country.trim()) url.searchParams.set('country', country.trim().toUpperCase())
      if (phoneOnly) url.searchParams.set('phoneOnly', '1')
      if (emailOnly) url.searchParams.set('emailOnly', '1')
      const res = await fetch(url.toString())
      if (!res.ok) throw new Error('Failed to load contacts')
      const data = await res.json()
      setContacts(data.contacts || [])
      const total = typeof data.totalContacts === 'number' ? data.totalContacts : (data.contacts || []).length
      const filtered = typeof data.filteredCount === 'number' ? data.filteredCount : (data.contacts || []).length
      setTotalContacts(total)
      setFilteredCount(filtered)
      setTotalPages(typeof data.totalPages === 'number' ? data.totalPages : 1)
      if (typeof data.page === 'number' && data.page !== targetPage) {
        setPage(data.page)
      }
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
    debounceRef.current = setTimeout(
      () =>
        loadContacts(
          query,
          roleFilter,
          crmStatusFilter,
          departmentFilter,
          countryFilter,
          phoneOnlyFilter,
          emailOnlyFilter,
          page,
          pageSize,
          sort
        ),
      200
    )
    return () => clearTimeout(debounceRef.current)
  }, [query, roleFilter, crmStatusFilter, departmentFilter, countryFilter, phoneOnlyFilter, emailOnlyFilter, page, pageSize, sort, loadContacts])

  const sortedContacts = contacts
  // Any filter/search change returns to the first page so results never appear empty
  // because the previous page index exceeds the new filtered total.
  useEffect(() => {
    setPage(1)
  }, [query, roleFilter, crmStatusFilter, departmentFilter, countryFilter, phoneOnlyFilter, emailOnlyFilter, pageSize])
  const rangeStart = filteredCount === 0 ? 0 : (page - 1) * pageSize + 1
  const rangeEnd = Math.min(filteredCount, (page - 1) * pageSize + sortedContacts.length)
  const hasActiveFilter = Boolean(
    query.trim() ||
    roleFilter !== 'all' ||
    crmStatusFilter !== 'all' ||
    departmentFilter !== 'all' ||
    countryFilter.trim() ||
    phoneOnlyFilter ||
    emailOnlyFilter
  )

  async function openOutreachForContact(row: ContactRow) {
    const primaryLead = row.leads?.[0]
    if (!primaryLead?.leadId) return
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(primaryLead.leadId)}?brand=${encodeURIComponent(brand)}`)
      if (res.ok) {
        const fullLead = await res.json()
        setOutreachTarget({
          lead: fullLead,
          contactEmail: row.email || undefined,
          contactName: row.name || undefined,
        })
        return
      }
    } catch {
      // Fallback to contact row's own denormalized organization & person fields
    }
    setOutreachTarget({
      lead: {
        _id: primaryLead.leadId,
        entity_name: row.company || primaryLead.entity_name,
        url: row.companyWebsite,
        companyLinkedin: row.companyLinkedin,
        companyPhone: row.companyPhone,
        country: row.country,
        industry: row.industry,
        contacts: [
          {
            name: row.name,
            firstName: row.firstName,
            lastName: row.lastName,
            country: row.country,
            title: row.title,
            department: row.department,
            email: row.email,
            phone: row.phone,
            linkedin: row.linkedin,
            isDecisionMaker: row.isDecisionMaker,
          },
        ],
      },
      contactEmail: row.email || undefined,
      contactName: row.name || undefined,
    })
  }

  return (
    <Box px={{ base: 'sm', sm: 'md', md: 'lg' }} py="md" w="100%" style={{ flex: 1, minWidth: 0 }}>
      <Stack gap="md">
        {/* Compact Application Header */}
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <div>
            <Group gap="xs" align="center">
              <Title order={2} style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Contacts</Title>
              <CountBadge value={totalContacts} cap={Number.MAX_SAFE_INTEGER} size="md" srLabel="Total contacts" />
              {hasActiveFilter && filteredCount !== totalContacts && (
                <Text size="xs" c="dimmed">
                  ({filteredCount.toLocaleString()} matching)
                </Text>
              )}
              {isGoogleConnected && (
                <StatusBadge status="success" size="xs">
                  Google Contacts Active
                </StatusBadge>
              )}
              {isApolloConnected && (
                <StatusBadge status="success" size="xs">
                  Apollo Active
                </StatusBadge>
              )}
            </Group>
            <Text size="xs" c="dimmed" mt={2}>
              Every contact across <Text span fw={600}>{label}</Text> leads, searchable by name, company, title, department, country, industry, and email.
            </Text>
          </div>
          <Group gap="xs" wrap="wrap">
            <Button
              variant="light"
              color="indigo"
              size="xs"
              leftSection={<IconPlugConnected size={14} />}
              onClick={() => setApolloModalOpen(true)}
            >
              {isApolloConnected ? 'Import from Apollo' : 'Connect Apollo'}
            </Button>
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
              href={`/api/contacts?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}&format=csv${query.trim() ? `&q=${encodeURIComponent(query.trim())}` : ''}${roleFilter !== 'all' ? `&buyingRole=${encodeURIComponent(roleFilter)}` : ''}${crmStatusFilter !== 'all' ? `&crmStatus=${encodeURIComponent(crmStatusFilter)}` : ''}${phoneOnlyFilter ? '&phoneOnly=1' : ''}`}
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
          <Stack gap="xs">
            {/* Quick-Filter Pills Strip */}
            <Group gap={6} wrap="wrap" align="center">
              <Text size="xs" c="dimmed" fw={600}>Quick filters:</Text>
              <Button
                size="compact-xs"
                variant={roleFilter === 'all' && !phoneOnlyFilter && !emailOnlyFilter && departmentFilter === 'all' && !countryFilter && crmStatusFilter === 'all' ? 'filled' : 'subtle'}
                color="blue"
                onClick={() => {
                  setRoleFilter('all');
                  setPhoneOnlyFilter(false);
                  setEmailOnlyFilter(false);
                  setDepartmentFilter('all');
                  setCountryFilter('');
                  setCrmStatusFilter('all');
                }}
              >
                All Contacts
              </Button>
              <Button
                size="compact-xs"
                variant={emailOnlyFilter ? 'filled' : 'light'}
                color="cyan"
                onClick={() => setEmailOnlyFilter((prev) => !prev)}
              >
                ✉️ With Email {emailOnlyFilter ? '✓' : ''}
              </Button>
              <Button
                size="compact-xs"
                variant={phoneOnlyFilter ? 'filled' : 'light'}
                color="teal"
                onClick={() => setPhoneOnlyFilter((prev) => !prev)}
              >
                📞 With Phone {phoneOnlyFilter ? '✓' : ''}
              </Button>
              <Button
                size="compact-xs"
                variant={roleFilter === 'decision_maker' ? 'filled' : 'light'}
                color="indigo"
                onClick={() => setRoleFilter((prev) => (prev === 'decision_maker' ? 'all' : 'decision_maker'))}
              >
                Decision Makers {roleFilter === 'decision_maker' ? '✓' : ''}
              </Button>
              <Button
                size="compact-xs"
                variant={roleFilter === 'champion' ? 'filled' : 'light'}
                color="green"
                onClick={() => setRoleFilter((prev) => (prev === 'champion' ? 'all' : 'champion'))}
              >
                Champions {roleFilter === 'champion' ? '✓' : ''}
              </Button>
              <Button
                size="compact-xs"
                variant={roleFilter === 'economic_buyer' ? 'filled' : 'light'}
                color="blue"
                onClick={() => setRoleFilter((prev) => (prev === 'economic_buyer' ? 'all' : 'economic_buyer'))}
              >
                Economic Buyers {roleFilter === 'economic_buyer' ? '✓' : ''}
              </Button>
            </Group>

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
                w={150}
                aria-label="Filter by department"
                value={departmentFilter}
                onChange={(val) => setDepartmentFilter(val || 'all')}
                data={[
                  { value: 'all', label: 'All Departments' },
                  { value: 'Executive', label: 'Executive' },
                  { value: 'Sales', label: 'Sales' },
                  { value: 'Marketing', label: 'Marketing' },
                  { value: 'Operations', label: 'Operations' },
                  { value: 'Unknown', label: 'Unclassified Dept' },
                ]}
              />
              <TextInput
                size="xs"
                w={96}
                aria-label="Filter by country ISO code"
                placeholder="Country (US)"
                maxLength={2}
                value={countryFilter}
                onChange={(e) => setCountryFilter(e.currentTarget.value.toUpperCase())}
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
              {hasActiveFilter && (
                <Button
                  variant="subtle"
                  color="gray"
                  size="xs"
                  onClick={() => {
                    setQuery('')
                    setRoleFilter('all')
                    setCrmStatusFilter('all')
                    setDepartmentFilter('all')
                    setCountryFilter('')
                    setPhoneOnlyFilter(false)
                    setEmailOnlyFilter(false)
                  }}
                >
                  Reset
                </Button>
              )}
            </Group>
          </Stack>
        </Paper>

        {error && <AdminFormStatus state="error" title="Couldn't load contacts" description={error} />}

        {loading ? (
          <Group justify="center" py="xl"><Loader size="sm" /></Group>
        ) : contacts.length === 0 ? (
          <AdminResourceEmptyState
            title={hasActiveFilter ? 'No matching contacts' : 'No contacts yet'}
            description={hasActiveFilter ? 'Try adjusting your search query or role/status filters.' : 'Contacts appear here once leads have named contacts.'}
          />
        ) : (
          <AdminDataTable<ContactRow>
            rows={sortedContacts}
            caption={`Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${filteredCount.toLocaleString()} contacts`}
            sort={sort}
            onSortChange={setSort}
            columns={[
              {
                key: 'name',
                header: 'Person (First / Last)',
                rowHeader: true,
                sortable: true,
                width: 210,
                accessor: (row) => (
                  <Box>
                    <Text fw={600} size="sm">{row.name || '—'}</Text>
                    <Text size="xs" c="dimmed">
                      First: {row.firstName || '—'} · Last: {row.lastName || '—'}
                    </Text>
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
                header: 'Company & Org Channels',
                sortable: true,
                width: 260,
                accessor: (row) => {
                  if (!row.leads || row.leads.length === 0) {
                    return <Text size="sm" c="dimmed">—</Text>
                  }
                  return (
                    <Stack gap={3}>
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
                      <Group gap={6} wrap="wrap">
                        <Text size="11px" c="dimmed">
                          {row.country || '—'} · {row.industry || '—'}
                        </Text>
                        {row.companyWebsite ? (
                          <ActionIcon
                            component="a"
                            href={row.companyWebsite}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="xs"
                            variant="subtle"
                            color="gray"
                            aria-label={`Open website for ${row.company || 'company'}`}
                            title={row.companyWebsite}
                          >
                            <IconWorld size={13} />
                          </ActionIcon>
                        ) : (
                          <Text size="10px" c="dimmed" title="Company website missing">Web: —</Text>
                        )}
                        {row.companyLinkedin ? (
                          <ActionIcon
                            component="a"
                            href={row.companyLinkedin.startsWith('http') ? row.companyLinkedin : `https://${row.companyLinkedin}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            size="xs"
                            variant="subtle"
                            color="blue"
                            aria-label={`Open company LinkedIn for ${row.company || 'company'}`}
                            title={row.companyLinkedin}
                          >
                            <IconBrandLinkedin size={13} />
                          </ActionIcon>
                        ) : (
                          <Text size="10px" c="dimmed" title="Company LinkedIn missing">Org LI: —</Text>
                        )}
                        {row.companyPhone ? (
                          <Text size="10px" c="dimmed" title="Company phone">
                            <IconPhone size={11} style={{ verticalAlign: 'middle' }} /> {row.companyPhone}
                          </Text>
                        ) : (
                          <Text size="10px" c="dimmed" title="Company phone missing">Org Tel: —</Text>
                        )}
                      </Group>
                    </Stack>
                  )
                },
              },
              {
                key: 'title',
                header: 'Title & Department',
                sortable: true,
                width: 200,
                accessor: (row) => (
                  <Stack gap={2}>
                    <Text size="sm" c={row.title ? undefined : 'dimmed'}>
                      {row.title || '—'}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Dept: {row.department && row.department !== 'Unknown' ? row.department : '—'}
                    </Text>
                  </Stack>
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
              {
                key: 'outreach',
                header: 'Outreach',
                width: 115,
                align: 'end',
                accessor: (row) => (
                  <Button
                    size="compact-xs"
                    variant="light"
                    color="indigo"
                    leftSection={<IconMail size={12} />}
                    disabled={!row.leads?.[0]?.leadId}
                    onClick={() => void openOutreachForContact(row)}
                  >
                    Outreach
                  </Button>
                ),
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

        {!loading && filteredCount > 0 && (
          <Group justify="space-between" align="center" wrap="wrap" gap="sm">
            <Text size="xs" c="dimmed">
              {rangeStart.toLocaleString()}–{rangeEnd.toLocaleString()} of {filteredCount.toLocaleString()}
              {hasActiveFilter ? ` matching (${totalContacts.toLocaleString()} total)` : ' contacts'}
            </Text>
            <Group gap="xs" align="center">
              <Select
                size="xs"
                w={110}
                aria-label="Contacts per page"
                value={String(pageSize)}
                onChange={(val) => setPageSize(Number(val) || 100)}
                data={['50', '100', '250', '500']}
                allowDeselect={false}
              />
              {totalPages > 1 && (
                <Pagination size="sm" total={totalPages} value={page} onChange={setPage} aria-label="Contacts pages" />
              )}
            </Group>
          </Group>
        )}
      </Stack>

      <GoogleContactsWorkspaceModal
        opened={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        brand={brand}
        tenantId={tenantId}
        onImported={() =>
          void loadContacts(
            query,
            roleFilter,
            crmStatusFilter,
            departmentFilter,
            countryFilter,
            phoneOnlyFilter,
            emailOnlyFilter,
            page,
            pageSize,
            sort
          )
        }
      />

      <ApolloImportModal
        opened={apolloModalOpen}
        onClose={() => {
          setApolloModalOpen(false)
          void checkConnectionStatus()
        }}
        brand={brand}
        tenantId={tenantId}
        onImported={() =>
          void loadContacts(
            query,
            roleFilter,
            crmStatusFilter,
            departmentFilter,
            countryFilter,
            phoneOnlyFilter,
            emailOnlyFilter,
            page,
            pageSize,
            sort
          )
        }
      />

      {outreachTarget && (
        <OutreachComposeModal
          opened={Boolean(outreachTarget)}
          onClose={() => setOutreachTarget(null)}
          lead={outreachTarget.lead as any}
          brand={brand}
          initialContactEmail={outreachTarget.contactEmail}
          initialContactName={outreachTarget.contactName}
          onSent={() => setOutreachTarget(null)}
        />
      )}
    </Box>
  )
}
