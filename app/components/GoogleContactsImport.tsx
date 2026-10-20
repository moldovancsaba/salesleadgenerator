'use client'

import { useCallback, useState } from 'react'
import { Modal, Stack, Group, Text, Button, TextInput, Loader, Tooltip, Alert } from '@mantine/core'
import { showNotification } from '@mantine/notifications'
import { IconBrandGoogle, IconAlertCircle } from '@tabler/icons-react'

type GoogleContactResult = {
  resourceName: string
  name: string
  email?: string
  phone?: string
  organization?: string
}

type Props = {
  leadId: string
  brand: string
  // Issue #216 §13/§14/Rule 7 — the action stays visible but genuinely
  // disabled (with an explanation, via Tooltip) rather than hidden or
  // clickable-but-broken, when the brand has no active Google Contacts
  // connection. `undefined` (not yet known, still checking) is treated
  // the same as disabled — never optimistically enabled before the real
  // connection state is confirmed.
  connected: boolean | undefined
  onImported: () => void
}

// Issue #216 — "Import from Google Contacts" affordance on a lead's
// Contacts section. Kept as its own component (not inlined into the
// already-very-large app/detail.tsx) so the search/import flow and its
// accessibility requirements (§14: keyboard-navigable listbox, aria-live
// result announcements, aria-disabled on the trigger) are isolated and
// testable independently of that file.
export function GoogleContactsImport({ leadId, brand, connected, onImported }: Props) {
  const [opened, setOpened] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [results, setResults] = useState<GoogleContactResult[]>([])
  const [searchError, setSearchError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [importingResourceName, setImportingResourceName] = useState<string | null>(null)

  const runSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults([])
      setAnnouncement('')
      return
    }
    setSearching(true)
    setSearchError(null)
    try {
      const res = await fetch(`/api/integrations/google-contacts/search?brand=${encodeURIComponent(brand)}&q=${encodeURIComponent(q)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Search failed')
      }
      const data = await res.json()
      const found: GoogleContactResult[] = data.results || []
      setResults(found)
      setAnnouncement(found.length === 0 ? 'No contacts found.' : `${found.length} contact${found.length === 1 ? '' : 's'} found.`)
    } catch (err: any) {
      setSearchError(err?.message || 'Search failed')
      setResults([])
    } finally {
      setSearching(false)
    }
  }, [brand])

  async function importContact(resourceName: string) {
    setImportingResourceName(resourceName)
    try {
      const res = await fetch(`/api/leads/${leadId}/contacts/import-google?brand=${encodeURIComponent(brand)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resourceName }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to import contact')
      setAnnouncement(data.status === 'already-exists' ? 'Already a contact on this lead.' : 'Contact added.')
      showNotification({
        message: data.status === 'already-exists' ? 'Already a contact on this lead' : 'Contact added',
        color: data.status === 'already-exists' ? 'gray' : 'green',
        autoClose: 4000,
      })
      if (data.status === 'added') onImported()
    } catch (err: any) {
      showNotification({ message: err?.message || 'Failed to import contact', color: 'red', autoClose: 5000 })
    } finally {
      setImportingResourceName(null)
    }
  }

  function open() {
    setQuery('')
    setResults([])
    setSearchError(null)
    setAnnouncement('')
    setOpened(true)
  }

  const trigger = (
    <Button
      size="xs"
      variant="light"
      onClick={open}
      disabled={!connected}
      aria-disabled={!connected}
    >
      Import from Google Contacts
    </Button>
  )

  return (
    <>
      {connected ? trigger : (
        <Tooltip label="Connect Google Contacts in Sales Settings → Integrations first" multiline w={220}>
          <span>{trigger}</span>
        </Tooltip>
      )}

      <Modal opened={opened} onClose={() => setOpened(false)} title="Import from Google Contacts" size="sm">
        <Stack gap="sm">
          <TextInput
            label="Search your Google Contacts"
            placeholder="Name or email"
            value={query}
            onChange={(e) => { const v = e.currentTarget.value; setQuery(v); runSearch(v) }}
            aria-describedby="google-contacts-search-status"
          />
          <Text id="google-contacts-search-status" role="status" aria-live="polite" size="xs" c="dimmed">
            {searching ? 'Searching…' : announcement}
          </Text>
          {searchError && (
            <Alert
              color="red"
              variant="light"
              title="Google Contacts Connection Error"
              icon={<IconAlertCircle size={16} />}
            >
              <Text size="xs" mb="xs">{searchError}</Text>
              {(searchError.toLowerCase().includes('token') ||
                searchError.toLowerCase().includes('expired') ||
                searchError.toLowerCase().includes('revoked') ||
                searchError.toLowerCase().includes('reconnect') ||
                searchError.toLowerCase().includes('authorization') ||
                searchError.toLowerCase().includes('denied')) && (
                <Button
                  component="a"
                  href={`/api/integrations/google_contacts/connect?brand=${encodeURIComponent(brand)}&returnUrl=${encodeURIComponent(typeof window !== 'undefined' ? window.location.pathname + window.location.search : '')}`}
                  size="xs"
                  color="red"
                  leftSection={<IconBrandGoogle size={14} />}
                >
                  Reconnect Google Contacts
                </Button>
              )}
            </Alert>
          )}

          {searching ? (
            <Group justify="center" py="md"><Loader size="sm" /></Group>
          ) : (
            <Stack gap={4} role="listbox" aria-label="Google Contacts search results">
              {results.map((contact) => (
                <Group
                  key={contact.resourceName}
                  role="option"
                  aria-selected={false}
                  tabIndex={0}
                  justify="space-between"
                  wrap="nowrap"
                  p="xs"
                  style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6 }}
                  onKeyDown={(e) => { if (e.key === 'Enter') importContact(contact.resourceName) }}
                >
                  <Stack gap={0}>
                    <Text size="sm" fw={600}>{contact.name}</Text>
                    {contact.email && <Text size="xs" c="dimmed">{contact.email}</Text>}
                    {contact.organization && <Text size="xs" c="dimmed">{contact.organization}</Text>}
                  </Stack>
                  <Button
                    size="xs"
                    variant="light"
                    loading={importingResourceName === contact.resourceName}
                    onClick={() => importContact(contact.resourceName)}
                  >
                    Add
                  </Button>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </Modal>
    </>
  )
}
