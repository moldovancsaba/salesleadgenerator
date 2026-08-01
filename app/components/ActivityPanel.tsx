'use client'

import { useEffect, useState } from 'react'
import { Box, Text, Stack, Badge, Loader, Group, Button } from '@mantine/core'

type ActivityEntry = {
  id: string
  type: 'email-outbound' | 'email-inbound' | 'note' | 'system'
  direction: 'outbound' | 'inbound' | null
  subject?: string
  bodyExcerpt?: string
  source: 'inbound-webhook' | 'manual' | 'outreach-log'
  createdAt: string
}

// Issue #142 — a suggested contacts[] update from a matched inbound reply's
// signature block. Never auto-applied; accept/reject are the only way its
// fields ever reach contacts[].
type ContactSuggestion = {
  id: string
  matchedContactKey: string
  current: { name?: string; title?: string; phone?: string }
  suggested: { name?: string; title?: string; phone?: string }
  status: 'pending' | 'accepted' | 'rejected'
  createdAt: string
}

const SUGGESTION_FIELD_LABEL: Record<string, string> = { name: 'Name', title: 'Title', phone: 'Phone' }

type Props = {
  leadId: string
  brand: string
}

const TYPE_LABEL: Record<ActivityEntry['type'], string> = {
  'email-outbound': 'Outbound email',
  'email-inbound': 'Inbound reply',
  note: 'Note',
  system: 'System',
}

// Issue #140 — the first genuinely unified per-lead activity timeline in this
// app. Self-fetching, matching app/outreach/compose-modal.tsx's own
// established pattern (LeadDetailModal itself makes no direct fetch() calls
// — every data mutation there goes through the onAction/onDelete/onUpdated
// callback props its parent supplies; a child component that needs its own
// read is the correct place for that fetch, not the modal itself). Mounted
// unconditionally inside LeadDetailModal's content, which only ever renders
// while the modal is open (LeadDetailModal returns null when !opened), so
// this naturally only fetches while the lead detail is actually visible.
export function ActivityPanel({ leadId, brand }: Props) {
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([])
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/leads/${encodeURIComponent(leadId)}/activity?brand=${encodeURIComponent(brand)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load activity (${res.status})`)
        return res.json()
      })
      .then((data) => {
        if (!cancelled) setActivity(data.activity || [])
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Failed to load activity')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [leadId, brand])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/contact-suggestions?leadId=${encodeURIComponent(leadId)}&brand=${encodeURIComponent(brand)}`)
      .then((res) => (res.ok ? res.json() : { suggestions: [] }))
      .then((data) => {
        if (!cancelled) setSuggestions(data.suggestions || [])
      })
      .catch(() => {
        // Non-fatal — the activity timeline above is the primary content;
        // a failed suggestions fetch just means no badge shows this pass.
      })
    return () => { cancelled = true }
  }, [leadId, brand])

  function resolveSuggestion(id: string, action: 'ACCEPT' | 'REJECT') {
    setResolvingId(id)
    fetch(`/api/contact-suggestions/${encodeURIComponent(id)}?brand=${encodeURIComponent(brand)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to ${action.toLowerCase()} suggestion (${res.status})`)
        setSuggestions((prev) => prev.filter((s) => s.id !== id))
      })
      .catch(() => {
        // Leave the suggestion in place on failure — the user can retry;
        // no silent removal of something that didn't actually resolve.
      })
      .finally(() => setResolvingId(null))
  }

  return (
    <Box>
      {suggestions.length > 0 && (
        <Box mb="sm">
          <Text size="xs" c="dimmed" fw={600} mb={4}>SUGGESTED CONTACT UPDATES</Text>
          <Stack gap="xs">
            {suggestions.map((s) => (
              <Box key={s.id} p="xs" style={{ border: '1px solid var(--mantine-color-yellow-4)', borderRadius: 6, background: 'var(--mantine-color-yellow-0)' }}>
                <Stack gap={2} mb="xs">
                  {(Object.keys(s.suggested) as Array<keyof typeof s.suggested>).map((field) => (
                    <Text size="xs" key={field}>
                      <Text span fw={600}>{SUGGESTION_FIELD_LABEL[field] || field}:</Text>{' '}
                      {s.current[field] ? <Text span td="line-through" c="dimmed">{s.current[field]}</Text> : null}{' '}
                      {s.current[field] ? '→ ' : ''}{s.suggested[field]}
                    </Text>
                  ))}
                </Stack>
                <Group gap="xs">
                  <Button size="xs" color="teal" loading={resolvingId === s.id} onClick={() => resolveSuggestion(s.id, 'ACCEPT')}>Accept</Button>
                  <Button size="xs" variant="subtle" color="gray" loading={resolvingId === s.id} onClick={() => resolveSuggestion(s.id, 'REJECT')}>Reject</Button>
                </Group>
              </Box>
            ))}
          </Stack>
        </Box>
      )}
      <Text size="xs" c="dimmed" fw={600} mb={4}>ACTIVITY</Text>
      {loading ? (
        <Group gap="xs"><Loader size="xs" /><Text size="xs" c="dimmed">Loading…</Text></Group>
      ) : error ? (
        <Text size="xs" c="red">{error}</Text>
      ) : activity.length === 0 ? (
        <Text size="xs" c="dimmed">No activity yet.</Text>
      ) : (
        <Stack gap="xs">
          {activity.map((entry) => (
            <Box key={entry.id} p="xs" style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6 }}>
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Badge size="xs" variant="light" color={entry.direction === 'inbound' ? 'teal' : 'blue'}>
                  {TYPE_LABEL[entry.type]}
                </Badge>
                <Text size="xs" c="dimmed">{new Date(entry.createdAt).toLocaleString()}</Text>
              </Group>
              {entry.subject && <Text size="sm" fw={500} mt={2}>{entry.subject}</Text>}
              {entry.bodyExcerpt && <Text size="xs" c="dimmed" mt={2} lineClamp={2}>{entry.bodyExcerpt}</Text>}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  )
}
