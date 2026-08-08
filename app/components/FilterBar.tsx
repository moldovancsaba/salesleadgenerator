'use client'

import { useCallback, useEffect, useState } from 'react'
import { ActionIcon, Drawer, Group, TextInput, TagsInput, Button, Pill, UnstyledButton, Indicator, Stack, Text } from '@mantine/core'
import { IconFilter, IconDeviceFloppy } from '@tabler/icons-react'
import { showNotification } from '@mantine/notifications'
import type { LeadFilter, SavedFilter } from '@/lib/saved-filters'
import { addSavedFilter, removeSavedFilter } from '@/lib/saved-filters'
import { loadSavedFilters, persistSavedFilters } from '@/app/lib/saved-filters-storage'

type Props = {
  brand: string
  value: LeadFilter
  onChange: (filter: LeadFilter) => void
}

// Issue #71 — applies identically to kanban and table view (both mount this
// same component). Saved filters are per-browser (localStorage, scoped by
// brand), not server-persisted, per owner-confirmed scope.
//
// A single quiet icon button + slide-out Drawer (owner feedback, same
// session): the region filter, industry input, and saved-filter pills were
// originally a permanently-visible row — one more stacked toolbar row on
// top of the kanban board's own column-visibility chips and Select toggle.
// Collapsing behind one trigger, mirroring the Drawer pattern
// app/components/AppNav.tsx already established for the hamburger menu,
// keeps the board/table visible immediately below the search bar instead
// of buried under permanent chrome.
export function FilterBar({ brand, value, onChange }: Props) {
  const [opened, setOpened] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])

  useEffect(() => {
    setSavedFilters(loadSavedFilters(brand))
  }, [brand])

  const saveCurrent = useCallback(() => {
    const name = window.prompt('Save this filter as:')
    if (!name) return
    const next = addSavedFilter(savedFilters, name, value, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    if (next === savedFilters) {
      showNotification({ message: 'Set a region or industry before saving a filter.', color: 'yellow' })
      return
    }
    setSavedFilters(next)
    persistSavedFilters(brand, next)
  }, [brand, savedFilters, value])

  const applySaved = useCallback((id: string) => {
    const found = savedFilters.find((f) => f.id === id)
    if (found) onChange(found.filter)
  }, [savedFilters, onChange])

  const deleteSaved = useCallback((id: string) => {
    const next = removeSavedFilter(savedFilters, id)
    setSavedFilters(next)
    persistSavedFilters(brand, next)
  }, [brand, savedFilters])

  const hasActiveFilter = Boolean(value.region || (value.industry && value.industry.trim()) || (value.tags && value.tags.length > 0))

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
            >
              Save filter
            </Button>
          </Group>

          {savedFilters.length > 0 && (
            <Stack gap={4}>
              <Text size="xs" fw={600} c="dimmed" tt="uppercase">Saved filters</Text>
              <Group gap={4}>
                {savedFilters.map((f) => (
                  <Pill
                    key={f.id}
                    withRemoveButton
                    onRemove={() => deleteSaved(f.id)}
                    removeButtonProps={{ 'aria-label': `Delete saved filter ${f.name}` }}
                  >
                    <UnstyledButton onClick={() => applySaved(f.id)} aria-label={`Apply saved filter ${f.name}`}>
                      {f.name}
                    </UnstyledButton>
                  </Pill>
                ))}
              </Group>
            </Stack>
          )}
        </Stack>
      </Drawer>
    </>
  )
}
