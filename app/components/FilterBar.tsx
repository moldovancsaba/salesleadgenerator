'use client'

import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Drawer, Group, TextInput, TagsInput, Button, Pill, UnstyledButton, Indicator, Stack, Text, Switch, Checkbox, Loader } from '@mantine/core'
import { IconFilter, IconDeviceFloppy } from '@tabler/icons-react'
import { showNotification } from '@mantine/notifications'
import type { LeadFilter, SavedFilter } from '@/lib/saved-filters'
import { isEmptyFilter } from '@/lib/saved-filters'
import { loadSavedFilters, persistSavedFilters } from '@/app/lib/saved-filters-storage'
import type { SavedFilterListItem } from '@/lib/saved-filters-store'

type Props = {
  brand: string
  value: LeadFilter
  onChange: (filter: LeadFilter) => void
}

function migrationMarkerKey(brand: string): string {
  return `slg-saved-filters-migrated-${brand}`
}

// Issue #71 — applies identically to kanban and table view (both mount this
// same component). A single quiet icon button + slide-out Drawer (owner
// feedback, same session): the region filter, industry input, and
// saved-filter pills were originally a permanently-visible row — one more
// stacked toolbar row on top of the kanban board's own column-visibility
// chips and Select toggle. Collapsing behind one trigger, mirroring the
// Drawer pattern app/components/AppNav.tsx already established for the
// hamburger menu, keeps the board/table visible immediately below the
// search bar instead of buried under permanent chrome.
//
// Issue #214 — saved filters moved from per-browser localStorage to a
// server-persisted, per-user, per-brand saved_filters collection
// (lib/saved-filters-store.ts, app/api/saved-filters*), so a rep's saved
// views now follow them across devices, and a brand admin can publish one
// read-only to the whole team. app/lib/saved-filters-storage.ts's
// localStorage helpers survive narrowly as the source for a one-time,
// explicit "import your local saved filters" migration action — never
// written to as part of the normal save flow anymore.
export function FilterBar({ brand, value, onChange }: Props) {
  const [opened, setOpened] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilterListItem[]>([])
  const [canShare, setCanShare] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [shareOnSave, setShareOnSave] = useState(false)

  // One-time local-migration state (issue #214 §8/§13/§15) — offered only
  // when this browser has pre-#214 localStorage data AND hasn't already
  // been shown/handled the offer for this brand.
  const [localCandidates, setLocalCandidates] = useState<SavedFilter[]>([])
  const [importBannerVisible, setImportBannerVisible] = useState(false)
  const [importing, setImporting] = useState(false)

  // Team visibility (issue: CRM Team visibility) — drives whether "My Team"
  // is even offered: a non-manager should never see a control that would
  // just re-show "My Leads" indistinguishably (the issue's own UX
  // requirement). Piggybacks on the same brand-scoped endpoint
  // app/detail.tsx already uses for its assignee picker.
  const [callerManagesTeam, setCallerManagesTeam] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/leads/assignable-users?brand=${encodeURIComponent(brand)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => { if (!cancelled) setCallerManagesTeam(Boolean(data?.callerManagesTeam)) })
      .catch(() => { if (!cancelled) setCallerManagesTeam(false) })
    return () => { cancelled = true }
  }, [brand])

  const reload = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    fetch(`/api/saved-filters?brand=${encodeURIComponent(brand)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Failed to load saved filters (${res.status})`))))
      .then((data) => {
        setSavedFilters(Array.isArray(data.savedFilters) ? data.savedFilters : [])
        setCanShare(Boolean(data.canShare))
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load saved filters')
      })
      .finally(() => setLoading(false))
  }, [brand])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    const local = loadSavedFilters(brand)
    let alreadyHandled = true
    try { alreadyHandled = window.localStorage.getItem(migrationMarkerKey(brand)) === '1' } catch { alreadyHandled = true }
    if (local.length > 0 && !alreadyHandled) {
      setLocalCandidates(local)
      setImportBannerVisible(true)
    } else {
      setLocalCandidates([])
      setImportBannerVisible(false)
    }
  }, [brand])

  const setMigrationMarker = useCallback(() => {
    try { window.localStorage.setItem(migrationMarkerKey(brand), '1') } catch { /* best-effort, non-critical */ }
  }, [brand])

  // Dismissing never deletes the local data (issue #214 §15's explicit "do
  // not silently discard" requirement) — only sets the per-browser marker
  // so the banner doesn't reappear every session.
  const dismissImportBanner = useCallback(() => {
    setImportBannerVisible(false)
    setMigrationMarker()
  }, [setMigrationMarker])

  const importLocal = useCallback(async () => {
    setImporting(true)
    try {
      const res = await fetch('/api/saved-filters/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, filters: localCandidates.map((f) => ({ name: f.name, filter: f.filter })) }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Import failed: ${res.status}`)
      }
      const data = await res.json()
      showNotification({
        message: `Imported ${data.imported} saved filter${data.imported === 1 ? '' : 's'}${data.skipped > 0 ? ` (${data.skipped} skipped)` : ''}.`,
        color: 'teal',
      })
      // Local data is cleared only after a confirmed successful server
      // import — never before.
      persistSavedFilters(brand, [])
      setMigrationMarker()
      setImportBannerVisible(false)
      setLocalCandidates([])
      reload()
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Import failed', color: 'red' })
    } finally {
      setImporting(false)
    }
  }, [brand, localCandidates, setMigrationMarker, reload])

  const saveCurrent = useCallback(async () => {
    if (isEmptyFilter(value)) {
      showNotification({ message: 'Set a region, industry, or tag before saving a filter.', color: 'yellow' })
      return
    }
    const name = window.prompt('Save this filter as:')
    if (!name || !name.trim()) return
    setSaving(true)
    try {
      const res = await fetch(`/api/saved-filters?brand=${encodeURIComponent(brand)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, filter: value, sharedWithBrand: shareOnSave }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Save failed: ${res.status}`)
      }
      const data = await res.json()
      setSavedFilters((prev) => [...prev.filter((f) => f._id !== data.savedFilter._id), { ...data.savedFilter, isMine: true }])
      setShareOnSave(false)
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Failed to save filter', color: 'red' })
    } finally {
      setSaving(false)
    }
  }, [brand, value, shareOnSave])

  const applySaved = useCallback((id: string) => {
    const found = savedFilters.find((f) => f._id === id)
    if (found) onChange(found.filter)
  }, [savedFilters, onChange])

  const deleteSaved = useCallback(async (id: string) => {
    try {
      const res = await fetch(`/api/saved-filters/${id}?brand=${encodeURIComponent(brand)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Delete failed: ${res.status}`)
      }
      setSavedFilters((prev) => prev.filter((f) => f._id !== id))
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Failed to delete saved filter', color: 'red' })
    }
  }, [brand])

  const toggleShare = useCallback(async (id: string, nextShared: boolean) => {
    try {
      const res = await fetch(`/api/saved-filters/${id}?brand=${encodeURIComponent(brand)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sharedWithBrand: nextShared }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Update failed: ${res.status}`)
      }
      const data = await res.json()
      setSavedFilters((prev) => prev.map((f) => (f._id === id ? { ...data.savedFilter, isMine: true } : f)))
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Failed to update sharing', color: 'red' })
    }
  }, [brand])

  const hasActiveFilter = Boolean(value.region || (value.industry && value.industry.trim()) || (value.tags && value.tags.length > 0) || value.assignedTo)

  return (
    <>
      <Indicator disabled={!hasActiveFilter} size={9} color="indigo" offset={3} withBorder>
        <ActionIcon
          variant="subtle"
          size="lg"
          aria-label="Open filters"
          onClick={() => setOpened(true)}
        >
          <IconFilter size={18} />
        </ActionIcon>
      </Indicator>

      <Drawer opened={opened} onClose={() => setOpened(false)} title="Filters" position="right" size="xs" padding="md">
        <Stack gap="md">
          {/* Lead ownership (issue: CRM Lead ownership) — a single,
              discoverable toggle rather than a hidden query param, per the
              issue's own UX goal. 'me' is resolved server-side from the
              caller's own session; this never sends a literal user id. */}
          <Switch
            label="My Leads"
            description="Show only leads assigned to me"
            aria-label="Filter to leads assigned to me"
            checked={value.assignedTo === 'me'}
            onChange={(e) => onChange({ ...value, assignedTo: e.currentTarget.checked ? 'me' : undefined })}
          />
          {/* Team visibility (issue: CRM Team visibility) — only rendered
              for a user who actually manages at least one team in this
              brand; mutually exclusive with "My Leads" above via the same
              single-valued LeadFilter.assignedTo field (turning this on
              always overwrites it to 'team', which naturally turns "My
              Leads" off on the next render, and vice versa). */}
          {callerManagesTeam && (
            <Switch
              label="My Team"
              description="Show leads assigned to me or a member of a team I manage"
              aria-label="Filter to leads assigned to me or a team member I manage"
              checked={value.assignedTo === 'team'}
              onChange={(e) => onChange({ ...value, assignedTo: e.currentTarget.checked ? 'team' : undefined })}
            />
          )}
          <TextInput
            label="Region"
            aria-label="Filter by region"
            placeholder="e.g. US (blank = all regions)"
            value={value.region || ''}
            onChange={(e) => { const v = e.currentTarget.value.toUpperCase(); onChange({ ...value, region: v || undefined }) }}
          />
          <TextInput
            label="Industry"
            aria-label="Filter by industry"
            placeholder="e.g. Academy"
            value={value.industry || ''}
            onChange={(e) => onChange({ ...value, industry: e.currentTarget.value || undefined })}
          />
          <TagsInput
            label="Tags"
            aria-label="Filter by tags"
            placeholder="Type a tag and press Enter"
            description="Matches leads with any of these tags"
            value={value.tags || []}
            onChange={(tags) => onChange({ ...value, tags: tags.length > 0 ? tags : undefined })}
          />

          <Group gap="xs">
            {/* GDS's theme puts a gradient on every non-"default" Button
                variant, "subtle" included — "default" is the only variant
                that renders as quiet/bordered, needed here so this reads
                as lower-priority than "Save filter" right next to it. */}
            <Button size="xs" variant="default" onClick={() => onChange({})} disabled={!hasActiveFilter}>
              Clear filters
            </Button>
            <Button
              size="xs"
              variant="light"
              leftSection={<IconDeviceFloppy size={14} />}
              onClick={saveCurrent}
              disabled={!hasActiveFilter}
              loading={saving}
            >
              Save filter
            </Button>
          </Group>
          {/* Issue #214 — rendered only for a brand admin/super admin, never
              shown-but-disabled for a plain user (CLAUDE.md Rule 7: a
              control implying a capability the viewer doesn't have). Not a
              second hidden step — it sits right above the Save button it
              applies to on the very next save. */}
          {canShare && (
            <Checkbox
              size="xs"
              label="Share with team"
              aria-label="Share this saved filter with everyone on this brand"
              checked={shareOnSave}
              onChange={(e) => setShareOnSave(e.currentTarget.checked)}
            />
          )}

          {importBannerVisible && (
            <Stack
              gap={4}
              role="region"
              aria-label="Import local saved filters"
              style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6, padding: 8 }}
            >
              <Text size="xs">
                {localCandidates.length} saved filter{localCandidates.length === 1 ? '' : 's'} found on this device — import {localCandidates.length === 1 ? 'it' : 'them'} to your account so {localCandidates.length === 1 ? 'it follows' : 'they follow'} you everywhere?
              </Text>
              <Group gap="xs">
                <Button size="xs" variant="light" onClick={importLocal} loading={importing}>
                  Import
                </Button>
                <Button size="xs" variant="subtle" color="gray" onClick={dismissImportBanner} disabled={importing}>
                  Dismiss
                </Button>
              </Group>
            </Stack>
          )}

          <Stack gap={4} aria-live="polite">
            {loading && (
              <Group gap="xs">
                <Loader size="xs" />
                <Text size="xs" c="dimmed">Loading saved filters…</Text>
              </Group>
            )}
            {loadError && !loading && (
              <Group gap="xs" role="alert">
                <Text size="xs" c="red">{loadError}</Text>
                <Button size="xs" variant="subtle" onClick={reload}>Retry</Button>
              </Group>
            )}
          </Stack>

          {!loading && !loadError && savedFilters.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">Saved filters</Text>
              <Stack gap={4}>
                {savedFilters.map((f) => (
                  <Group key={f._id} gap={6} wrap="nowrap">
                    <Pill
                      withRemoveButton={f.isMine}
                      onRemove={f.isMine ? () => deleteSaved(f._id) : undefined}
                      removeButtonProps={f.isMine ? { 'aria-label': `Delete saved filter ${f.name}` } : undefined}
                    >
                      <UnstyledButton onClick={() => applySaved(f._id)} aria-label={`Apply saved filter ${f.name}`}>
                        {f.name}
                      </UnstyledButton>
                    </Pill>
                    {/* Attribution conveyed in text, never color/icon alone
                        (issue #214 §14) — a shared-by-someone-else filter
                        never carries a delete/share-toggle control, since
                        the viewer genuinely cannot perform either (Rule 7). */}
                    {!f.isMine && (
                      <Text size="9px" c="dimmed">Shared by {f.ownerEmail || 'a teammate'}</Text>
                    )}
                    {f.isMine && canShare && (
                      <Switch
                        size="xs"
                        aria-label={`Share '${f.name}' with the team`}
                        checked={f.sharedWithBrand}
                        onChange={(e) => toggleShare(f._id, e.currentTarget.checked)}
                      />
                    )}
                  </Group>
                ))}
              </Stack>
            </Stack>
          )}
        </Stack>
      </Drawer>
    </>
  )
}
