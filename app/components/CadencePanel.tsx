'use client'

import { useEffect, useState } from 'react'
import { Box, Text, Stack, Group, Button, Select } from '@mantine/core'
import Link from 'next/link'

type ActiveCadence = {
  cadenceId: string
  currentStepIndex: number
  stepDueAt: string
  enrolledAt: string
} | null | undefined

type CadenceSummary = {
  id: string
  name: string
  enabled: boolean
  steps: Array<{ channel: 'email' | 'linkedin' | 'call' }>
}

type Props = {
  leadId: string
  brand: string
  activeCadence: ActiveCadence
}

const CHANNEL_LABEL: Record<'email' | 'linkedin' | 'call', string> = {
  email: 'Email',
  linkedin: 'LinkedIn touch',
  call: 'Call',
}

// Issue #124/#152 — self-fetching, matching ActivityPanel's own established
// pattern (LeadDetailModal itself makes no direct fetch() calls; a child
// component that needs its own read/write is the correct place for that,
// not the modal itself). Enroll/cancel go straight to POST/DELETE
// /api/leads/[id]/cadence rather than through the modal's onAction prop —
// that prop only ever speaks PATCH /api/leads' MODIFY protocol, a genuinely
// different endpoint/method than this feature's own REST routes.
export function CadencePanel({ leadId, brand, activeCadence: initialActiveCadence }: Props) {
  const [activeCadence, setActiveCadence] = useState<ActiveCadence>(initialActiveCadence ?? null)
  const [allCadences, setAllCadences] = useState<CadenceSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedCadenceId, setSelectedCadenceId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setActiveCadence(initialActiveCadence ?? null)
  }, [initialActiveCadence, leadId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`/api/cadences?brand=${encodeURIComponent(brand)}`)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) setAllCadences(data.cadences || [])
      })
      .catch(() => {
        if (!cancelled) setAllCadences([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [brand, leadId])

  const enabledCadences = allCadences.filter((c) => c.enabled)
  const currentCadence = activeCadence ? allCadences.find((c) => c.id === activeCadence.cadenceId) : null
  const currentStep = currentCadence && activeCadence ? currentCadence.steps[activeCadence.currentStepIndex] : null

  async function handleEnroll() {
    if (!selectedCadenceId) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/cadence?brand=${encodeURIComponent(brand)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cadenceId: selectedCadenceId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to enroll lead in cadence')
      setActiveCadence(data.activeCadence)
      setSelectedCadenceId(null)
    } catch (err: any) {
      setError(err?.message || 'Failed to enroll lead in cadence')
    } finally {
      setBusy(false)
    }
  }

  // A real, slightly destructive action (stops future automated sends for
  // this lead) — confirmed before firing, same risk-tiering as this app's
  // other destructive confirms (delete battlecard, delete cadence).
  async function handleCancel() {
    const confirmed = window.confirm('Cancel this lead’s cadence enrollment? No further automated steps will fire for it.')
    if (!confirmed) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/leads/${encodeURIComponent(leadId)}/cadence?brand=${encodeURIComponent(brand)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to cancel cadence')
      }
      setActiveCadence(null)
    } catch (err: any) {
      setError(err?.message || 'Failed to cancel cadence')
    } finally {
      setBusy(false)
    }
  }

  // Same red/orange/dimmed due-vs-overdue logic app/card.tsx already uses
  // for nextActionDueAt — copied inline rather than imported since that
  // logic isn't extracted to a shared lib/ helper anywhere in this codebase.
  const now = new Date()
  const dueAt = activeCadence ? new Date(activeCadence.stepDueAt) : null
  const dueValid = dueAt && !Number.isNaN(dueAt.getTime())
  const dueDays = dueValid ? Math.floor((dueAt!.getTime() - now.getTime()) / 86_400_000) : null
  const dueColor = dueDays !== null && dueDays < 0 ? 'red' : dueDays === 0 ? 'orange' : 'dimmed'
  const dueLabel = dueDays === null
    ? ''
    : dueDays < 0
      ? `${Math.abs(dueDays)}d overdue`
      : dueDays === 0
        ? 'Due today'
        : `Due in ${dueDays}d`

  return (
    <Box>
      <Text size="xs" c="dimmed" fw={600} mb={4}>CADENCE</Text>
      {loading ? (
        <Text size="xs" c="dimmed">Loading…</Text>
      ) : activeCadence ? (
        <Stack gap={4}>
          <Text size="sm" fw={500}>{currentCadence?.name || 'Cadence details unavailable'}</Text>
          {currentCadence && (
            <Text size="xs" c="dimmed">
              Step {activeCadence.currentStepIndex + 1} of {currentCadence.steps.length}
              {currentStep ? ` · ${CHANNEL_LABEL[currentStep.channel]}` : ''}
            </Text>
          )}
          {dueValid && <Text size="xs" c={dueColor}>{dueLabel}</Text>}
          <Group gap="xs" mt={4}>
            <Button size="xs" variant="subtle" color="gray" onClick={handleCancel} loading={busy}>
              Cancel cadence
            </Button>
          </Group>
        </Stack>
      ) : enabledCadences.length === 0 ? (
        <Text size="xs" c="dimmed">
          No enabled cadences for this brand yet. <Link href={`/outreach/cadences/${brand}`}>Build one</Link> to enroll leads.
        </Text>
      ) : (
        <Group align="flex-end" gap="xs">
          <Select
            size="xs"
            placeholder="Select a cadence"
            data={enabledCadences.map((c) => ({ value: c.id, label: c.name }))}
            value={selectedCadenceId}
            onChange={setSelectedCadenceId}
            style={{ flex: 1 }}
          />
          <Button size="xs" variant="light" onClick={handleEnroll} loading={busy} disabled={!selectedCadenceId}>
            Enroll
          </Button>
        </Group>
      )}
      {error && <Text size="xs" c="red" mt={4}>{error}</Text>}
    </Box>
  )
}
