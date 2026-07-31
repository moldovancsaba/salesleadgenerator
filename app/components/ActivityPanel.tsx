'use client'

import { useEffect, useState } from 'react'
import { Box, Text, Stack, Badge, Loader, Group } from '@mantine/core'

type ActivityEntry = {
  id: string
  type: 'email-outbound' | 'email-inbound' | 'note' | 'system'
  direction: 'outbound' | 'inbound' | null
  subject?: string
  bodyExcerpt?: string
  source: 'inbound-webhook' | 'manual' | 'outreach-log'
  createdAt: string
}

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

  return (
    <Box>
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
