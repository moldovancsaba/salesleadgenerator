'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Container, Title, Text, Stack, Group, Button, TextInput, Loader, Paper } from '@mantine/core'

type Slot = { start: string; end: string }

type Props = { brand: string; label: string; leadId?: string }

function formatDayHeader(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// Issue #207 — the first fully public, unauthenticated, prospect-facing
// page this app has shipped. No app chrome (AppHeader hides itself here —
// see app/components/AppHeader.tsx), no login, no knowledge of this app
// required. Slot times are grouped and displayed in the PROSPECT's own
// browser-local timezone (computed client-side from the UTC ISO strings
// the API returns) — distinct from the rep's stored IANA timeZone, which
// only governs which wall-clock hours count as available server-side.
export function ScheduleClient({ brand, label, leadId }: Props) {
  const [loading, setLoading] = useState(true)
  const [slots, setSlots] = useState<Slot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Slot | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState<Slot | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const loadSlots = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/schedule/${encodeURIComponent(brand)}/availability?days=14`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'This scheduling link is not available right now')
      setSlots(data.slots || [])
    } catch (err: any) {
      setError(err?.message || 'This scheduling link is not available right now')
    } finally {
      setLoading(false)
    }
  }, [brand])

  useEffect(() => { loadSlots() }, [loadSlots])

  const slotsByDay = useMemo(() => {
    const groups = new Map<string, Slot[]>()
    for (const slot of slots) {
      const dayKey = new Date(slot.start).toDateString()
      const existing = groups.get(dayKey) || []
      existing.push(slot)
      groups.set(dayKey, existing)
    }
    return Array.from(groups.entries())
  }, [slots])

  function pickSlot(slot: Slot) {
    setSelected(slot)
    setSubmitError(null)
    setAnnouncement(`Selected ${formatDayHeader(slot.start)} at ${formatTime(slot.start)}. Enter your name and email to confirm.`)
  }

  async function submitBooking() {
    if (!selected) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await fetch(`/api/schedule/${encodeURIComponent(brand)}/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slotStart: selected.start, slotEnd: selected.end, leadId, prospectName: name.trim(), prospectEmail: email.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 409 && Array.isArray(data.freshSlots)) {
          setSlots(data.freshSlots)
          setSelected(null)
          setAnnouncement('That time was just taken. Please pick another.')
        }
        throw new Error(data?.error || 'Could not book this meeting')
      }
      setConfirmed(selected)
      setAnnouncement(`Confirmed for ${formatDayHeader(selected.start)} at ${formatTime(selected.start)}.`)
    } catch (err: any) {
      setSubmitError(err?.message || 'Could not book this meeting')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Container size="xs" py="xl">
      <Stack gap="md">
        <div>
          <Title order={2}>Schedule a meeting</Title>
          <Text size="sm" c="dimmed">{label}</Text>
        </div>

        <Text role="status" aria-live="polite" size="xs" c="dimmed" style={{ position: confirmed ? 'static' : 'absolute', left: confirmed ? undefined : -9999 }}>
          {announcement}
        </Text>

        {confirmed ? (
          <Paper withBorder p="md" radius="md">
            <Stack gap="xs">
              <Title order={4}>You&apos;re booked</Title>
              <Text>{formatDayHeader(confirmed.start)} at {formatTime(confirmed.start)}</Text>
              <Text size="sm" c="dimmed">A calendar invite has been sent to {email}.</Text>
            </Stack>
          </Paper>
        ) : loading ? (
          <Group justify="center" py="xl"><Loader /></Group>
        ) : error ? (
          <Paper withBorder p="md" radius="md">
            <Text c="red">{error}</Text>
          </Paper>
        ) : selected ? (
          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Text fw={600}>{formatDayHeader(selected.start)} at {formatTime(selected.start)}</Text>
              <TextInput label="Your name" value={name} onChange={(e) => setName(e.currentTarget.value)} required />
              <TextInput label="Your email" type="email" value={email} onChange={(e) => setEmail(e.currentTarget.value)} required />
              {submitError && <Text c="red" size="sm" role="alert">{submitError}</Text>}
              <Group gap="xs">
                <Button onClick={submitBooking} loading={submitting} disabled={!name.trim() || !email.trim()}>Confirm booking</Button>
                <Button variant="subtle" color="gray" onClick={() => setSelected(null)} disabled={submitting}>Choose a different time</Button>
              </Group>
            </Stack>
          </Paper>
        ) : slots.length === 0 ? (
          <Text c="dimmed">No times available in the next two weeks.</Text>
        ) : (
          <Stack gap="md">
            {slotsByDay.map(([dayKey, daySlots]) => (
              <div key={dayKey}>
                <Text size="sm" fw={600} mb={4}>{formatDayHeader(daySlots[0].start)}</Text>
                <Group gap="xs">
                  {daySlots.map((slot) => (
                    <Button key={slot.start} size="sm" variant="light" onClick={() => pickSlot(slot)}>
                      {formatTime(slot.start)}
                    </Button>
                  ))}
                </Group>
              </div>
            ))}
          </Stack>
        )}
      </Stack>
    </Container>
  )
}
