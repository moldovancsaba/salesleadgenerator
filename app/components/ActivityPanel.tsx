'use client'

import { useEffect, useRef, useState } from 'react'
import { Box, Text, Stack, Badge, Loader, Group, Button, Select, NumberInput, Textarea, Tooltip } from '@mantine/core'
import { showNotification } from '@mantine/notifications'

// Issue #200 — closed set, mirrors app/lib/activity-log-store.ts's own
// CallDisposition (not imported directly — this file already keeps its own
// local ActivityEntry type independent of the server module, same as
// before this change).
const CALL_DISPOSITIONS = ['connected', 'voicemail', 'no-answer', 'busy', 'wrong-number', 'not-interested'] as const
type CallDisposition = typeof CALL_DISPOSITIONS[number]
const DISPOSITION_LABEL: Record<CallDisposition, string> = {
  connected: 'Connected',
  voicemail: 'Voicemail',
  'no-answer': 'No answer',
  busy: 'Busy',
  'wrong-number': 'Wrong number',
  'not-interested': 'Not interested',
}

type ActivityEntry = {
  id: string
  type: 'email-outbound' | 'email-inbound' | 'note' | 'system' | 'call'
  direction: 'outbound' | 'inbound' | null
  subject?: string
  bodyExcerpt?: string
  source: 'inbound-webhook' | 'manual' | 'outreach-log' | 'gmail-sync'
  createdAt: string
  callDisposition?: CallDisposition
  callDurationMinutes?: number
  loggedBy?: string
}

type ActivityContact = { name?: string; email?: string; phone?: string }

// Mirrors lib/contacts.ts's contactKey() exactly (name+phone, else
// name+email, else bare name, all lowercased) — duplicated rather than
// imported so this client component never pulls in lib/contacts.ts's own
// server-oriented dependency chain (title-normalization, field-verifications,
// etc.). lead.contacts[] returned by the API is already normalized/deduped
// server-side, so this reduction is safe to compute directly on it.
function computeContactKey(c: ActivityContact): string {
  const name = (c.name || '').toLowerCase().trim()
  if (!name) return ''
  if (c.phone) return `${name}|${c.phone}`
  if (c.email) return `${name}|${c.email.toLowerCase()}`
  return name
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
  // Issue #200 — the lead's current contacts[], for the "who did you call"
  // picker. Optional so this component's existing two call sites that don't
  // pass it (if any) keep compiling; the picker/button simply behaves as
  // the zero-contacts case (disabled) when omitted.
  contacts?: ActivityContact[]
}

const TYPE_LABEL: Record<ActivityEntry['type'], string> = {
  'email-outbound': 'Outbound email',
  'email-inbound': 'Inbound reply',
  note: 'Note',
  system: 'System',
  call: 'Call',
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
export function ActivityPanel({ leadId, brand, contacts = [] }: Props) {
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<ContactSuggestion[]>([])
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  // Issue #200 — manual call-logging form state, kept inline in this same
  // component (a 4-field form, well within what one component can hold
  // clearly) rather than a sibling component, so this stays the one place
  // that owns and refreshes activity[] after a submit — a second component
  // would need its own callback wiring back into this one for that.
  const [callFormOpen, setCallFormOpen] = useState(false)
  const [callContactKey, setCallContactKey] = useState<string | null>(null)
  const [callDisposition, setCallDisposition] = useState<CallDisposition | null>(null)
  const [callDuration, setCallDuration] = useState<number | ''>('')
  const [callNotes, setCallNotes] = useState('')
  const [callFieldErrors, setCallFieldErrors] = useState<{ contact?: string; disposition?: string; duration?: string }>({})
  const [loggingCall, setLoggingCall] = useState(false)
  const contactSelectRef = useRef<HTMLInputElement>(null)
  const dispositionSelectRef = useRef<HTMLInputElement>(null)
  const durationInputRef = useRef<HTMLInputElement>(null)

  const contactOptions = contacts
    .map((c) => ({ value: computeContactKey(c), label: c.name || c.email || c.phone || 'Unnamed contact' }))
    .filter((o) => o.value)

  function loadActivity() {
    setLoading(true)
    setError(null)
    return fetch(`/api/leads/${encodeURIComponent(leadId)}/activity?brand=${encodeURIComponent(brand)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load activity (${res.status})`)
        return res.json()
      })
      .then((data) => {
        setActivity(data.activity || [])
      })
      .catch((err) => {
        setError(err?.message || 'Failed to load activity')
      })
      .finally(() => {
        setLoading(false)
      })
  }

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

  // Issue #200 — server re-validates contactKey/disposition/duration
  // regardless; this client-side pass exists only so a rep gets immediate,
  // field-level feedback and focus moves to the first invalid field,
  // per this issue's own Accessibility requirement.
  function handleLogCall() {
    const errors: typeof callFieldErrors = {}
    if (!callContactKey) errors.contact = 'Select who you called'
    if (!callDisposition) errors.disposition = 'Select an outcome'
    if (callDuration !== '' && (typeof callDuration !== 'number' || !Number.isFinite(callDuration) || callDuration <= 0)) {
      errors.duration = 'Duration must be a positive number'
    }
    setCallFieldErrors(errors)
    if (errors.contact) { contactSelectRef.current?.focus(); return }
    if (errors.disposition) { dispositionSelectRef.current?.focus(); return }
    if (errors.duration) { durationInputRef.current?.focus(); return }

    setLoggingCall(true)
    fetch(`/api/leads/${encodeURIComponent(leadId)}/activity?brand=${encodeURIComponent(brand)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactKey: callContactKey,
        disposition: callDisposition,
        durationMinutes: callDuration === '' ? undefined : callDuration,
        notes: callNotes || undefined,
      }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data.error || `Failed to log call (${res.status})`)
        }
        return res.json()
      })
      .then(() => {
        showNotification({ message: 'Call logged.', color: 'teal' })
        setCallFormOpen(false)
        setCallContactKey(null)
        setCallDisposition(null)
        setCallDuration('')
        setCallNotes('')
        setCallFieldErrors({})
        loadActivity()
      })
      .catch((err) => {
        // Entered values are deliberately preserved (not cleared) on
        // failure — the rep shouldn't have to retype after a transient
        // network/server error.
        showNotification({ message: err?.message || 'Failed to log call', color: 'red', autoClose: 5000 })
      })
      .finally(() => setLoggingCall(false))
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
      <Group justify="space-between" align="center" mb={4}>
        <Text size="xs" c="dimmed" fw={600}>ACTIVITY</Text>
        {/* Issue #200 — disabled with a reason (not hidden) when the lead
            has zero contacts, per CLAUDE.md Rule 7: no live-looking control
            that would just open a form with an unusable, empty picker. */}
        <Tooltip label="Add a contact to this lead first" disabled={contactOptions.length > 0}>
          <Button
            size="xs"
            variant="light"
            disabled={contactOptions.length === 0}
            onClick={() => setCallFormOpen((v) => !v)}
          >
            Log a call
          </Button>
        </Tooltip>
      </Group>

      {callFormOpen && (
        <Box mb="sm" p="xs" style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6 }}>
          <Stack gap="xs">
            <Select
              ref={contactSelectRef}
              label="Contact"
              placeholder="Who did you call?"
              data={contactOptions}
              value={callContactKey}
              onChange={(v) => { setCallContactKey(v); setCallFieldErrors((e) => ({ ...e, contact: undefined })) }}
              error={callFieldErrors.contact}
              aria-label="Contact called"
              required
            />
            <Select
              ref={dispositionSelectRef}
              label="Outcome"
              placeholder="Select an outcome"
              data={CALL_DISPOSITIONS.map((d) => ({ value: d, label: DISPOSITION_LABEL[d] }))}
              value={callDisposition}
              onChange={(v) => { setCallDisposition(v as CallDisposition | null); setCallFieldErrors((e) => ({ ...e, disposition: undefined })) }}
              error={callFieldErrors.disposition}
              aria-label="Call outcome"
              required
            />
            <NumberInput
              ref={durationInputRef}
              label="Duration (minutes)"
              placeholder="Optional"
              min={1}
              value={callDuration}
              onChange={(v) => { setCallDuration(typeof v === 'number' ? v : ''); setCallFieldErrors((e) => ({ ...e, duration: undefined })) }}
              error={callFieldErrors.duration}
              aria-label="Call duration in minutes"
            />
            <Textarea
              label="Notes"
              placeholder="Optional"
              value={callNotes}
              onChange={(e) => setCallNotes(e.currentTarget.value)}
              aria-label="Call notes"
              autosize
              minRows={2}
            />
            <Group gap="xs">
              <Button size="xs" color="teal" loading={loggingCall} onClick={handleLogCall}>Save call</Button>
              <Button size="xs" variant="subtle" color="gray" disabled={loggingCall} onClick={() => setCallFormOpen(false)}>Cancel</Button>
            </Group>
          </Stack>
        </Box>
      )}

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
                <Group gap={4}>
                  <Badge size="xs" variant="light" color={entry.type === 'call' ? 'grape' : entry.direction === 'inbound' ? 'teal' : 'blue'}>
                    {TYPE_LABEL[entry.type]}
                  </Badge>
                  {entry.source === 'gmail-sync' && (
                    <Badge size="xs" variant="outline" color="gray">Gmail</Badge>
                  )}
                  {entry.callDisposition && (
                    <Badge size="xs" variant="outline" color="gray">{DISPOSITION_LABEL[entry.callDisposition]}</Badge>
                  )}
                </Group>
                <Text size="xs" c="dimmed">{new Date(entry.createdAt).toLocaleString()}</Text>
              </Group>
              {entry.subject && <Text size="sm" fw={500} mt={2}>{entry.subject}</Text>}
              {entry.bodyExcerpt && <Text size="xs" c="dimmed" mt={2} lineClamp={2}>{entry.bodyExcerpt}</Text>}
              {entry.type === 'call' && (
                <Text size="xs" c="dimmed" mt={2}>
                  {entry.callDurationMinutes ? `${entry.callDurationMinutes} min` : null}
                  {entry.callDurationMinutes && entry.loggedBy ? ' · ' : null}
                  {entry.loggedBy ? `Logged by ${entry.loggedBy}` : null}
                </Text>
              )}
            </Box>
          ))}
        </Stack>
      )}
    </Box>
  )
}
