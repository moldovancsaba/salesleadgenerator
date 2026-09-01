'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Container, Title, Text, Group, Stack, TextInput, Badge, Loader } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState } from '@sovereignsquad/gds-admin/client'
import { IconSearch } from '@tabler/icons-react'
import Link from 'next/link'
import type { Brand } from '@/app/lib/brand'

type ContactRow = {
  key: string
  name: string
  title: string
  email: string
  phone: string
  isDecisionMaker: boolean
  leads: Array<{ leadId: string; entity_name: string }>
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
  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const loadContacts = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    try {
      const url = new URL('/api/contacts', window.location.origin)
      url.searchParams.set('brand', brand)
      url.searchParams.set('tenantId', tenantId)
      if (q.trim()) url.searchParams.set('q', q.trim())
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
    debounceRef.current = setTimeout(() => loadContacts(query), 250)
    return () => clearTimeout(debounceRef.current)
  }, [query, loadContacts])

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <div>
          <Title order={2}>Contacts</Title>
          <Text size="sm" c="dimmed">
            Every contact across <Text span fw={700}>{label}</Text> leads, searchable by name.
          </Text>
        </div>

        <TextInput
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search contacts by name…"
          aria-label="Search contacts"
          leftSection={<IconSearch size={16} />}
        />

        {error && <AdminFormStatus state="error" title="Couldn't load contacts" description={error} />}

        {loading ? (
          <Group justify="center" py="lg"><Loader size="sm" /></Group>
        ) : contacts.length === 0 ? (
          <AdminResourceEmptyState
            title={query.trim() ? 'No matching contacts' : 'No contacts yet'}
            description={query.trim() ? 'Try a different name.' : 'Contacts appear here once leads have named contacts.'}
          />
        ) : (
          <AdminDataTable<ContactRow>
            rows={contacts}
            caption="Contacts"
            columns={[
              {
                key: 'name',
                header: 'Name',
                rowHeader: true,
                accessor: (row) => (
                  <Group gap={6} wrap="nowrap">
                    <Text fw={600}>{row.name || '—'}</Text>
                    {row.isDecisionMaker && <Badge size="xs" color="indigo" variant="light">Decision maker</Badge>}
                  </Group>
                ),
              },
              { key: 'title', header: 'Title', accessor: (row) => row.title || '—' },
              { key: 'email', header: 'Email', accessor: (row) => row.email || '—' },
              { key: 'phone', header: 'Phone', accessor: (row) => row.phone || '—' },
              {
                key: 'leads',
                header: 'Leads',
                accessor: (row) => (
                  <Group gap={4}>
                    {row.leads.map((lead) => (
                      <Link key={lead.leadId} href={`/sales/${brand}?leadId=${encodeURIComponent(lead.leadId)}`}>
                        <Badge variant="light" color="gray" style={{ cursor: 'pointer' }}>
                          {lead.entity_name || 'Untitled lead'}
                        </Badge>
                      </Link>
                    ))}
                  </Group>
                ),
              },
            ]}
            empty={<Text c="dimmed" size="sm">No contacts.</Text>}
            getRowKey={(row) => row.key}
          />
        )}
      </Stack>
    </Container>
  )
}
