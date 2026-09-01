'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Container, Title, Text, Button, Group, Stack, Paper, TextInput, Select, MultiSelect,
  TagsInput, Pill, Loader, Alert,
} from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState } from '@sovereignsquad/gds-admin/client'
import { IconPlus, IconAlertTriangle } from '@tabler/icons-react'
import { CURRENCY_CODE_OPTIONS } from '@/app/lib/brand-constants'
import { CUSTOMER_TYPE_OPTIONS, BUYER_ROLE_OPTIONS } from '@/app/lib/sales-settings'

type BrandRow = {
  slug: string
  label: string
  dbCollection: string
  currency: string
  aliases: string[]
  ownNameTerms: string[]
  forecastModel: 'dealSizeBand' | 'custom'
  fromEmail?: string
  createdAt: string
  createdBy: string
}

const FORECAST_MODEL_OPTIONS = [
  { value: 'dealSizeBand', label: 'Standard (deal-size bands)' },
  { value: 'custom', label: 'Custom — requires engineering' },
]

const EMPTY_FORM = {
  slug: '',
  label: '',
  currency: 'USD',
  aliases: [] as string[],
  ownNameTerms: [] as string[],
  forecastModel: 'dealSizeBand' as 'dealSizeBand' | 'custom',
  customerTypes: [] as string[],
  buyerRoles: [] as string[],
  fromEmail: '',
}

export function AdminClientsClient() {
  const [brands, setBrands] = useState<BrandRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [form, setForm] = useState(EMPTY_FORM)
  const [aliasesTouched, setAliasesTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadBrands = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/clients')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load clients (${res.status})`)
      }
      const data = await res.json()
      setBrands(data.brands || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load clients')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadBrands()
  }, [loadBrands])

  function resetForm() {
    setForm(EMPTY_FORM)
    setAliasesTouched(false)
    setSaveError(null)
  }

  // Suggests the conventional `<slug>`/`<slug>sales` aliases as the admin
  // types a slug, same convention every existing brand already follows
  // (app/lib/brand.ts's FALLBACK_BRAND_CONFIG) — still freely editable, and
  // stops auto-updating the moment the admin touches the Aliases field
  // directly, so it never fights a deliberate edit.
  function updateSlug(value: string) {
    const slug = value.trim().toLowerCase()
    setForm((f) => ({
      ...f,
      slug: value,
      aliases: aliasesTouched ? f.aliases : (slug ? [slug, `${slug}sales`] : []),
    }))
  }

  async function createBrand() {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = {
        slug: form.slug.trim().toLowerCase(),
        label: form.label.trim(),
        currency: form.currency,
        aliases: form.aliases,
        ownNameTerms: form.ownNameTerms,
        forecastModel: form.forecastModel,
        salesVocabulary: { customerTypes: form.customerTypes, buyerRoles: form.buyerRoles },
        fromEmail: form.fromEmail.trim() || undefined,
      }
      const res = await fetch('/api/admin/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Failed to create client (${res.status})`)
      }
      resetForm()
      await loadBrands()
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to create client')
    } finally {
      setSaving(false)
    }
  }

  const canSave = /^[a-z][a-z0-9-]{1,31}$/.test(form.slug.trim().toLowerCase()) && form.label.trim().length > 0

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <div>
          <Title order={2}>Admin — Clients</Title>
          <Text size="sm" c="dimmed">
            Add a new client/brand — it appears everywhere in the app (navigation, Sales Settings, Forecast, lead
            creation, access grants) immediately, with no code deploy. Transcribe a client&apos;s onboarding
            questionnaire answers directly into the fields below.
          </Text>
        </div>

        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group grow align="flex-start">
              <TextInput
                label="Slug"
                description="Lowercase letters, numbers, hyphens only — used in URLs and the database"
                value={form.slug}
                onChange={(e) => updateSlug(e.currentTarget.value)}
                placeholder="rmbd"
              />
              <TextInput
                label="Display name"
                value={form.label}
                onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, label: v })) }}
                placeholder="RMBD"
              />
            </Group>

            <Select
              label="Reporting currency"
              data={CURRENCY_CODE_OPTIONS}
              value={form.currency}
              onChange={(v) => setForm((f) => ({ ...f, currency: v || 'USD' }))}
            />

            <TagsInput
              label="Aliases"
              description="Alternate slugs this brand is also reachable under (e.g. a legacy SSO org name)"
              value={form.aliases}
              onChange={(value) => { setAliasesTouched(true); setForm((f) => ({ ...f, aliases: value })) }}
              clearable
              renderPill={({ option, onRemove, disabled }) => (
                <Pill withRemoveButton onRemove={onRemove} disabled={disabled} removeButtonProps={{ 'aria-label': `Remove alias ${option.value}` }}>
                  {option.value}
                </Pill>
              )}
            />

            <TagsInput
              label="Own name / competitor-adjacent terms"
              description="This brand's own name, spellings, and distinctive product vocabulary — automatically forbidden in every other brand's leads and battlecards, and vice versa"
              value={form.ownNameTerms}
              onChange={(value) => setForm((f) => ({ ...f, ownNameTerms: value }))}
              placeholder={form.slug || 'brandname'}
              clearable
              renderPill={({ option, onRemove, disabled }) => (
                <Pill withRemoveButton onRemove={onRemove} disabled={disabled} removeButtonProps={{ 'aria-label': `Remove term ${option.value}` }}>
                  {option.value}
                </Pill>
              )}
            />

            <Select
              label="Forecast model"
              data={FORECAST_MODEL_OPTIONS}
              value={form.forecastModel}
              onChange={(v) => setForm((f) => ({ ...f, forecastModel: (v as 'dealSizeBand' | 'custom') || 'dealSizeBand' }))}
            />
            {form.forecastModel === 'custom' && (
              <Alert icon={<IconAlertTriangle size={16} />} color="yellow" variant="light">
                This brand&apos;s Forecast page will show no data until a developer implements a matching custom
                model in <Text span ff="monospace" size="sm">app/lib/forecast.ts</Text> — &quot;Custom&quot; only
                flags the need, it doesn&apos;t build one.
              </Alert>
            )}

            <Group grow align="flex-start">
              <MultiSelect
                label="Additional customer types (optional)"
                description="Beyond the universal set every brand already gets"
                data={CUSTOMER_TYPE_OPTIONS}
                value={form.customerTypes}
                onChange={(value) => setForm((f) => ({ ...f, customerTypes: value }))}
                clearable
              />
              <MultiSelect
                label="Additional buyer roles (optional)"
                description="Beyond the universal set every brand already gets"
                data={BUYER_ROLE_OPTIONS}
                value={form.buyerRoles}
                onChange={(value) => setForm((f) => ({ ...f, buyerRoles: value }))}
                clearable
              />
            </Group>

            <TextInput
              label="Outreach from-address (optional)"
              description="Leave blank to use the default domain-based address"
              value={form.fromEmail}
              onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, fromEmail: v })) }}
              placeholder="Sales <sales@rmbd.example.com>"
            />

            <Group justify="space-between">
              <div />
              <Group gap="xs">
                <Button variant="light" onClick={resetForm} disabled={saving}>
                  Reset
                </Button>
                <Button leftSection={<IconPlus size={16} />} onClick={createBrand} loading={saving} disabled={!canSave}>
                  Create Client
                </Button>
              </Group>
            </Group>

            {saveError && <Text c="red" size="sm">{saveError}</Text>}
          </Stack>
        </Paper>

        {loading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : error ? (
          <AdminFormStatus state="error" title="Something went wrong" description={error} />
        ) : brands.length === 0 ? (
          <AdminResourceEmptyState
            title="No clients configured"
            description="Create the first one above."
          />
        ) : (
          <AdminDataTable<BrandRow>
            rows={brands}
            caption="Configured clients"
            columns={[
              {
                key: 'label',
                header: 'Client',
                rowHeader: true,
                accessor: (row) => (
                  <Stack gap={0}>
                    <Text fw={600} size="sm">{row.label}</Text>
                    <Text size="xs" c="dimmed">{row.slug}</Text>
                  </Stack>
                ),
              },
              { key: 'currency', header: 'Currency', accessor: (row) => row.currency },
              {
                key: 'forecastModel',
                header: 'Forecast model',
                accessor: (row) => (row.forecastModel === 'dealSizeBand' ? 'Standard' : 'Custom'),
              },
              { key: 'dbCollection', header: 'Collection', accessor: (row) => row.dbCollection },
              { key: 'createdAt', header: 'Created', accessor: (row) => new Date(row.createdAt).toLocaleDateString() },
            ]}
            getRowKey={(row) => row.slug}
          />
        )}
      </Stack>
    </Container>
  )
}
