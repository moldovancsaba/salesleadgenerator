'use client'

import { useCallback, useEffect, useState } from 'react'
import { Group, Select, TextInput, Button, ActionIcon, Pill, UnstyledButton } from '@mantine/core'
import { IconDeviceFloppy, IconX } from '@tabler/icons-react'
import { showNotification } from '@mantine/notifications'
import type { LeadFilter, SavedFilter } from '@/lib/saved-filters'
import { addSavedFilter, removeSavedFilter } from '@/lib/saved-filters'
import { loadSavedFilters, persistSavedFilters } from '@/app/lib/saved-filters-storage'

const REGION_OPTIONS = [
  { value: '', label: 'All regions' },
  { value: 'US', label: 'US' },
  { value: 'CEE', label: 'CEE' },
  { value: 'MENA', label: 'MENA' },
]

type Props = {
  brand: string
  value: LeadFilter
  onChange: (filter: LeadFilter) => void
}

// Issue #71 — applies identically to kanban and table view (both mount this
// same component); saved filters are per-browser (localStorage, scoped by
// brand), not server-persisted, per owner-confirmed scope.
export function FilterBar({ brand, value, onChange }: Props) {
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

  const hasActiveFilter = Boolean(value.region || (value.industry && value.industry.trim()))

  return (
    <Group gap="xs" wrap="wrap" mb="sm" role="group" aria-label="Filter leads">
      <Select
        size="xs"
        aria-label="Filter by region"
        data={REGION_OPTIONS}
        value={value.region || ''}
        onChange={(v) => onChange({ ...value, region: v || undefined })}
        style={{ width: 140 }}
      />
      <TextInput
        size="xs"
        aria-label="Filter by industry"
        placeholder="Filter by industry"
        value={value.industry || ''}
        onChange={(e) => onChange({ ...value, industry: e.currentTarget.value || undefined })}
        style={{ width: 180 }}
      />
      {hasActiveFilter && (
        <ActionIcon size="sm" variant="light" aria-label="Clear filters" onClick={() => onChange({})}>
          <IconX size={14} />
        </ActionIcon>
      )}
      <Button
        size="xs"
        variant="light"
        leftSection={<IconDeviceFloppy size={14} />}
        onClick={saveCurrent}
        disabled={!hasActiveFilter}
      >
        Save filter
      </Button>
      {savedFilters.length > 0 && (
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
      )}
    </Group>
  )
}
