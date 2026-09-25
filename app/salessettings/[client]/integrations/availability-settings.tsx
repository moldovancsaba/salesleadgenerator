'use client'

import { useEffect, useState } from 'react'
import { Paper, Stack, Title, Text, Group, Button, TextInput, NumberInput, Checkbox } from '@mantine/core'

type AvailabilityWindow = {
  weekdays: number[]
  startMinuteOfDay: number
  endMinuteOfDay: number
  slotMinutes: number
  bufferMinutes: number
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, '0')
  const m = (minutes % 60).toString().padStart(2, '0')
  return `${h}:${m}`
}

function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

type Props = { brand: string }

// Issue #207 — the availability-window editor for this brand's shared
// booking calendar. Mounted only once Google Calendar shows status:
// 'active' on the parent Integrations page — there is nothing to
// configure before a calendar is actually connected.
export function AvailabilitySettings({ brand }: Props) {
  const [loading, setLoading] = useState(true)
  const [timeZone, setTimeZone] = useState('UTC')
  const [window_, setWindow] = useState<AvailabilityWindow>({ weekdays: [1, 2, 3, 4, 5], startMinuteOfDay: 540, endMinuteOfDay: 1020, slotMinutes: 30, bufferMinutes: 0 })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/scheduling-settings/${encodeURIComponent(brand)}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.settings) return
        setTimeZone(data.settings.timeZone)
        setWindow(data.settings.availabilityWindow)
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [brand])

  function toggleWeekday(day: number) {
    setWindow((w) => ({
      ...w,
      weekdays: w.weekdays.includes(day) ? w.weekdays.filter((d) => d !== day) : [...w.weekdays, day].sort(),
    }))
  }

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch(`/api/scheduling-settings/${encodeURIComponent(brand)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeZone, availabilityWindow: window_ }),
      })
      if (!res.ok) throw new Error('Failed to save availability settings')
      setSaved(true)
    } catch (err: any) {
      setError(err?.message || 'Failed to save availability settings')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  return (
    <Paper withBorder p="md" radius="md">
      <Stack gap="sm">
        <Title order={4}>Booking availability</Title>
        <Text size="sm" c="dimmed">
          When your public scheduling page (shared from a lead&apos;s detail view) offers open times. Computed
          against your real Google Calendar — a busy block is never offered as open.
        </Text>
        <TextInput
          label="Time zone (IANA, e.g. America/New_York)"
          value={timeZone}
          onChange={(e) => setTimeZone(e.currentTarget.value)}
        />
        <Checkbox.Group label="Available days" value={window_.weekdays.map(String)} onChange={(v) => setWindow((w) => ({ ...w, weekdays: v.map(Number) }))}>
          <Group gap="sm" mt="xs">
            {WEEKDAY_LABELS.map((label, i) => (
              <Checkbox key={i} value={String(i)} label={label} checked={window_.weekdays.includes(i)} onChange={() => toggleWeekday(i)} />
            ))}
          </Group>
        </Checkbox.Group>
        <Group grow>
          <TextInput label="Start time" type="time" value={minutesToTime(window_.startMinuteOfDay)} onChange={(e) => setWindow((w) => ({ ...w, startMinuteOfDay: timeToMinutes(e.currentTarget.value) }))} />
          <TextInput label="End time" type="time" value={minutesToTime(window_.endMinuteOfDay)} onChange={(e) => setWindow((w) => ({ ...w, endMinuteOfDay: timeToMinutes(e.currentTarget.value) }))} />
        </Group>
        <Group grow>
          <NumberInput label="Slot length (minutes)" value={window_.slotMinutes} onChange={(v) => setWindow((w) => ({ ...w, slotMinutes: typeof v === 'number' ? v : w.slotMinutes }))} min={5} max={240} />
          <NumberInput label="Buffer before/after (minutes)" value={window_.bufferMinutes} onChange={(v) => setWindow((w) => ({ ...w, bufferMinutes: typeof v === 'number' ? v : w.bufferMinutes }))} min={0} max={120} />
        </Group>
        {error && <Text c="red" size="sm">{error}</Text>}
        {saved && !error && <Text c="green" size="sm">Saved.</Text>}
        <Group justify="flex-end">
          <Button onClick={save} loading={saving}>Save availability</Button>
        </Group>
      </Stack>
    </Paper>
  )
}
