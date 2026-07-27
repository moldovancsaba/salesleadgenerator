'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Stack, Group, Select, Button, Badge, Paper, SegmentedControl } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState } from '@sovereignsquad/gds-admin/client'
import { showNotification } from '@mantine/notifications'
import { BRAND_CONFIG } from '@/app/lib/brand'
import { MergeConflictModal } from '@/app/components/MergeConflictModal'

type ReviewStatus = 'pending' | 'dismissed' | 'confirmed' | 'merged'

type DuplicateReview = {
  id: string
  leadA: { id: string; entity_name: string; url?: string; kanbanColumn?: string }
  leadB: { id: string; entity_name: string; url?: string; kanbanColumn?: string }
  score: number
  matchedOn: 'name' | 'domain' | 'both'
  status: ReviewStatus
  createdAt: string
}

const BRAND_OPTIONS = Object.entries(BRAND_CONFIG).map(([value, config]) => ({ value, label: config.label }))

// Issue #129/#130 — 'confirmed' rows previously had nowhere to be seen once
// confirmed: this list always fetched status=pending, so a pair vanished
// the moment "Confirm duplicate" was clicked, with no way back to it. A
// status filter is required for the new Merge action to even be reachable
// — otherwise a confirmed pair can never be looked at again to merge it.
const STATUS_OPTIONS: { value: ReviewStatus; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'dismissed', label: 'Dismissed' },
  { value: 'merged', label: 'Merged' },
]

export function AdminDuplicatesClient() {
  const [brand, setBrand] = useState<string>(BRAND_OPTIONS[0]?.value || 'cogmap')
  const [statusFilter, setStatusFilter] = useState<ReviewStatus>('pending')
  const [reviews, setReviews] = useState<DuplicateReview[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [mergeReviewId, setMergeReviewId] = useState<string | null>(null)

  const loadReviews = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/duplicate-reviews?brand=${encodeURIComponent(brand)}&status=${statusFilter}`)
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
  }, [brand, statusFilter])

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
      // Issue #107: the scan is capped (2000 leads) for perf reasons — when
      // truncated, say so explicitly rather than silently reporting a scan
      // that looks complete but wasn't.
      const truncationNote = data.truncated
        ? ` (capped — ${data.totalAvailable} leads exist, only the ${data.scanned} most recent were scanned)`
        : ''
      showNotification({
        message: `Scanned ${data.scanned} leads${truncationNote} — ${data.newPairs} new candidate pair${data.newPairs === 1 ? '' : 's'} found.`,
        color: data.truncated ? 'yellow' : 'teal',
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
            Candidate duplicate leads flagged by name/domain similarity. Confirm a pair, then merge it — merging
            combines contacts/tags/deals/checklist automatically and asks you to pick a value for any field that
            genuinely conflicts. Merging permanently deletes the losing lead; it cannot be undone.
          </Text>
        </div>

        <Group justify="space-between" align="flex-end" wrap="wrap">
          <Group align="flex-end">
            <Select
              label="Brand"
              data={BRAND_OPTIONS}
              value={brand}
              onChange={(v) => setBrand(v || BRAND_OPTIONS[0]?.value)}
              style={{ width: 200 }}
            />
            <div>
              <Text size="sm" fw={500} mb={4}>Status</Text>
              <SegmentedControl
                value={statusFilter}
                onChange={(v) => setStatusFilter(v as ReviewStatus)}
                data={STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
          </Group>
          <Button onClick={runScan} loading={scanning}>
            Scan for duplicates
          </Button>
        </Group>

        {error && <AdminFormStatus state="error" title="Something went wrong" description={error} />}

        {loading ? (
          <AdminFormStatus state="loading" title="Loading duplicate reviews" />
        ) : reviews.length === 0 ? (
          <AdminResourceEmptyState
            title={`No ${statusFilter} duplicate reviews`}
            description={statusFilter === 'pending' ? 'Run a scan to look for candidate duplicate leads.' : 'Nothing here yet.'}
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
                    {row.status === 'pending' && (
                      <>
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
                      </>
                    )}
                    {row.status === 'confirmed' && (
                      <Button size="xs" color="orange" onClick={() => setMergeReviewId(row.id)}>
                        Merge
                      </Button>
                    )}
                    {(row.status === 'dismissed' || row.status === 'merged') && (
                      <Text size="xs" c="dimmed">No further action</Text>
                    )}
                  </Group>
                ),
              },
            ]}
            getRowKey={(row) => row.id}
          />
        )}
      </Stack>

      <MergeConflictModal
        reviewId={mergeReviewId}
        opened={mergeReviewId !== null}
        onClose={() => setMergeReviewId(null)}
        onMerged={loadReviews}
      />
    </Container>
  )
}
