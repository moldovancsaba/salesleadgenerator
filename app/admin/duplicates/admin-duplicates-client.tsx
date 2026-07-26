'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Stack, Group, Select, Button, Badge, Paper } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState } from '@sovereignsquad/gds-admin/client'
import { showNotification } from '@mantine/notifications'
import { BRAND_CONFIG } from '@/app/lib/brand'

type DuplicateReview = {
  id: string
  leadA: { id: string; entity_name: string; url?: string; kanbanColumn?: string }
  leadB: { id: string; entity_name: string; url?: string; kanbanColumn?: string }
  score: number
  matchedOn: 'name' | 'domain' | 'both'
  status: 'pending' | 'dismissed' | 'confirmed'
  createdAt: string
}

const BRAND_OPTIONS = Object.entries(BRAND_CONFIG).map(([value, config]) => ({ value, label: config.label }))

export function AdminDuplicatesClient() {
  const [brand, setBrand] = useState<string>(BRAND_OPTIONS[0]?.value || 'cogmap')
  const [reviews, setReviews] = useState<DuplicateReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const loadReviews = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/duplicate-reviews?brand=${encodeURIComponent(brand)}&status=pending`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load duplicate reviews (${res.status})`)
      }
      const data = await res.json()
      setReviews(data.reviews || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load duplicate reviews')
    } finally {
      setLoading(false)
    }
  }, [brand])

  useEffect(() => {
    loadReviews()
  }, [loadReviews])

  const runScan = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/duplicate-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Scan failed (${res.status})`)
      }
      const data = await res.json()
      showNotification({
        message: `Scanned ${data.scanned} leads — ${data.newPairs} new candidate pair${data.newPairs === 1 ? '' : 's'} found.`,
        color: 'teal',
      })
      await loadReviews()
    } catch (err: any) {
      setError(err?.message || 'Scan failed')
    } finally {
      setScanning(false)
    }
  }, [brand, loadReviews])

  const decide = useCallback(async (reviewId: string, status: 'dismissed' | 'confirmed') => {
    setSavingId(reviewId)
    setError(null)
    try {
      const res = await fetch('/api/duplicate-reviews', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId, status }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to update review (${res.status})`)
      }
      await loadReviews()
    } catch (err: any) {
      setError(err?.message || 'Failed to update review')
    } finally {
      setSavingId(null)
    }
  }, [loadReviews])

  return (
    <Container size="lg" py="xl">
      <Stack gap="md">
        <div>
          <Title order={2}>Admin — Near-Duplicate Review</Title>
          <Text size="sm" c="dimmed">
            Candidate duplicate leads flagged by name/domain similarity. Dismiss or confirm only — this never merges lead
            records; a merge action is a separate, future feature.
          </Text>
        </div>

        <Group justify="space-between">
          <Select
            label="Brand"
            data={BRAND_OPTIONS}
            value={brand}
            onChange={(v) => setBrand(v || BRAND_OPTIONS[0]?.value)}
            style={{ width: 200 }}
          />
          <Button onClick={runScan} loading={scanning} mt={22}>
            Scan for duplicates
          </Button>
        </Group>

        {error && <AdminFormStatus state="error" title="Something went wrong" description={error} />}

        {loading ? (
          <AdminFormStatus state="loading" title="Loading duplicate reviews" />
        ) : reviews.length === 0 ? (
          <AdminResourceEmptyState
            title="No pending duplicate reviews"
            description="Run a scan to look for candidate duplicate leads."
          />
        ) : (
          <AdminDataTable<DuplicateReview>
            rows={reviews}
            caption="Candidate duplicate lead pairs"
            columns={[
              {
                key: 'pair',
                header: 'Candidate pair',
                rowHeader: true,
                accessor: (row) => (
                  <Paper withBorder p="xs" radius="sm">
                    <Stack gap={2}>
                      <Text size="sm" fw={600}>{row.leadA.entity_name}</Text>
                      <Text size="xs" c="dimmed">{row.leadA.url || 'no url'} · {row.leadA.kanbanColumn || '—'}</Text>
                      <Text size="xs" c="dimmed" ta="center">vs.</Text>
                      <Text size="sm" fw={600}>{row.leadB.entity_name}</Text>
                      <Text size="xs" c="dimmed">{row.leadB.url || 'no url'} · {row.leadB.kanbanColumn || '—'}</Text>
                    </Stack>
                  </Paper>
                ),
              },
              {
                key: 'matchedOn',
                header: 'Matched on',
                accessor: (row) => <Badge variant="light" color="gray">{row.matchedOn}</Badge>,
              },
              {
                key: 'score',
                header: 'Score',
                numeric: true,
                accessor: (row) => row.score.toFixed(2),
              },
              {
                key: 'actions',
                header: 'Actions',
                accessor: (row) => (
                  <Group gap="xs">
                    <Button
                      size="xs"
                      variant="light"
                      onClick={() => decide(row.id, 'dismissed')}
                      loading={savingId === row.id}
                      disabled={savingId !== null && savingId !== row.id}
                    >
                      Not a duplicate
                    </Button>
                    <Button
                      size="xs"
                      color="orange"
                      variant="light"
                      onClick={() => decide(row.id, 'confirmed')}
                      loading={savingId === row.id}
                      disabled={savingId !== null && savingId !== row.id}
                    >
                      Confirm duplicate
                    </Button>
                  </Group>
                ),
              },
            ]}
            getRowKey={(row) => row.id}
          />
        )}
      </Stack>
    </Container>
  )
}
