'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import {
  Box, Title, Text, Button, Group, Stack, Textarea, TextInput, NumberInput,
  Select, Checkbox, Paper, Loader, Divider, Tabs, Card, SimpleGrid,
  Tooltip, ActionIcon, Switch, ThemeIcon,
} from '@mantine/core'
import { StatusBadge, LabelTag, CountBadge, InlineAlert } from '@sovereignsquad/gds-core/client'
import {
  IconPlus, IconTrash, IconPlug, IconBuilding, IconUsers, IconShoppingCart,
  IconPackage, IconCoins, IconTimeline, IconTarget,
  IconRefresh, IconCheck, IconExternalLink, IconDeviceFloppy, IconInfoCircle,
  IconUserCheck,
} from '@tabler/icons-react'
import { showNotification } from '@mantine/notifications'
import { CURRENCY_SYMBOLS } from '@/app/lib/brand-constants'
import type { Brand, CurrencyCode, BrandSalesVocabulary } from '@/app/lib/brand-constants'
import type { Product } from '@/app/lib/products'
import {
  type SalesSettings, type ProductLine, type PricingModel,
  emptySalesSettings, emptyProductLine, catalogProductToProductLine,
  getCustomerTypeOptions, getBuyerRoleOptions, CUSTOMER_SIZE_OPTIONS, PRICING_MODEL_OPTIONS,
  PURCHASE_FREQUENCY_OPTIONS, SALES_CYCLE_OPTIONS, REVENUE_PREDICTABILITY_OPTIONS, QUARTER_OPTIONS,
  REVENUE_TARGET_CURRENCY_OPTIONS, REVENUE_TARGET_PERIOD_OPTIONS,
} from '@/app/lib/sales-settings'

const PRICING_FIELD_MAP: Record<PricingModel, { key: keyof ProductLine['pricing']; label: string; isMoney?: boolean }[]> = {
  one_time: [{ key: 'oneTimePrice', label: 'One-time price', isMoney: true }],
  monthly_subscription: [{ key: 'monthlyPrice', label: 'Monthly price', isMoney: true }],
  annual_subscription: [{ key: 'annualPrice', label: 'Annual price', isMoney: true }],
  framework_agreement: [{ key: 'frameworkAnnualValue', label: 'Framework annual value', isMoney: true }],
  campaign_based: [
    { key: 'campaignPrice', label: 'Campaign price', isMoney: true },
    { key: 'campaignDurationMonths', label: 'Typical campaign duration (months)' },
  ],
  per_user: [
    { key: 'perUserPrice', label: 'Price per user', isMoney: true },
    { key: 'perUserMinimum', label: 'Minimum users' },
    { key: 'perUserTypical', label: 'Typical users' },
  ],
  per_product: [{ key: 'perProductPrice', label: 'Price per product sold', isMoney: true }],
  per_event: [{ key: 'perEventPrice', label: 'Price per event', isMoney: true }],
  custom_quotation: [{ key: 'customQuotationTypicalValue', label: 'Typical quotation value', isMoney: true }],
}

function pricingFieldLabel(field: { label: string; isMoney?: boolean }, currencySymbol: string): string {
  return field.isMoney ? `${field.label} (${currencySymbol})` : field.label
}

type RegionMultiplierRow = { id: string; region: string; multiplier: number | undefined }

function rowsFromRegionMultipliers(record: Record<string, number> | undefined): RegionMultiplierRow[] {
  return Object.entries(record || {}).map(([region, multiplier], i) => ({
    id: `region-${i}-${Math.random().toString(36).slice(2, 8)}`,
    region,
    multiplier,
  }))
}

type AssignableUser = {
  ssoUserId: string
  email: string
  name: string
}

type SalesSettingsClientProps = {
  brand: Brand
  label: string
  currency?: CurrencyCode
  salesVocabulary?: BrandSalesVocabulary
}

export function SalesSettingsClient({ brand, label, currency, salesVocabulary }: SalesSettingsClientProps) {
  const currencySymbol = CURRENCY_SYMBOLS[currency ?? 'USD'] ?? '$'
  const [tenantId, setTenantId] = useState('default')
  const [settings, setSettings] = useState<SalesSettings>(emptySalesSettings(brand, 'default', currency))
  const [regionRows, setRegionRows] = useState<RegionMultiplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string | null>('overview')

  // Product Catalog integration state
  const [catalogProducts, setCatalogProducts] = useState<Product[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)

  // Assignable users state for sales team contact management
  const [assignableUsers, setAssignableUsers] = useState<AssignableUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)

  // Dirty tracking
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState<string>('')

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tenantId')) setTenantId(params.get('tenantId') || 'default')
    } catch {}
  }, [])

  // Load Sales Settings
  const loadSettings = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/sales-settings/${brand}?tenantId=${encodeURIComponent(tenantId)}`)
      if (!res.ok) throw new Error('Failed to load sales settings')
      const data = await res.json()
      const loaded = data.settings || emptySalesSettings(brand, tenantId, currency)
      setSettings(loaded)
      const rows = rowsFromRegionMultipliers(loaded.regionMultipliers)
      setRegionRows(rows)
      setLastSavedSnapshot(JSON.stringify({ ...loaded, regionMultipliers: loaded.regionMultipliers }))
    } catch (err: any) {
      setError(err?.message || 'Failed to load sales settings')
    } finally {
      setLoading(false)
    }
  }, [brand, tenantId, currency])

  // Load Catalog Products from /api/products/[brand]
  const loadCatalogProducts = useCallback(async () => {
    setCatalogLoading(true)
    try {
      const res = await fetch(`/api/products/${brand}?tenantId=${encodeURIComponent(tenantId)}`)
      if (res.ok) {
        const data = await res.json()
        setCatalogProducts(Array.isArray(data.products) ? data.products : [])
      }
    } catch {
      // Catalog loading error is non-blocking
    } finally {
      setCatalogLoading(false)
    }
  }, [brand, tenantId])

  // Load Assignable Users from /api/leads/assignable-users
  const loadAssignableUsers = useCallback(async () => {
    setUsersLoading(true)
    try {
      const res = await fetch(`/api/leads/assignable-users?brand=${encodeURIComponent(brand)}`)
      if (res.ok) {
        const data = await res.json()
        setAssignableUsers(Array.isArray(data.users) ? data.users : [])
      }
    } catch {
      // User loading error is non-blocking
    } finally {
      setUsersLoading(false)
    }
  }, [brand])

  useEffect(() => {
    loadSettings()
    loadCatalogProducts()
    loadAssignableUsers()
  }, [loadSettings, loadCatalogProducts, loadAssignableUsers])

  // Compute current snapshot to check dirty state
  const isDirty = useMemo(() => {
    if (!lastSavedSnapshot) return false
    const regionMultipliers: Record<string, number> = {}
    for (const row of regionRows) {
      const key = row.region.trim().toUpperCase()
      if (key && typeof row.multiplier === 'number' && row.multiplier > 0) regionMultipliers[key] = row.multiplier
    }
    const current = JSON.stringify({ ...settings, regionMultipliers })
    return current !== lastSavedSnapshot
  }, [settings, regionRows, lastSavedSnapshot])

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const regionMultipliers: Record<string, number> = {}
      for (const row of regionRows) {
        const key = row.region.trim().toUpperCase()
        if (key && typeof row.multiplier === 'number' && row.multiplier > 0) regionMultipliers[key] = row.multiplier
      }
      const payload = { ...settings, regionMultipliers }
      const res = await fetch(`/api/sales-settings/${brand}?tenantId=${encodeURIComponent(tenantId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to save sales settings')
      }
      const data = await res.json()
      setSettings(data.settings)
      setRegionRows(rowsFromRegionMultipliers(data.settings.regionMultipliers))
      setLastSavedSnapshot(JSON.stringify({ ...data.settings, regionMultipliers: data.settings.regionMultipliers }))
      showNotification({
        title: 'Settings Saved',
        message: 'Company configuration and sales settings have been updated.',
        color: 'teal',
        icon: <IconCheck size={16} />,
      })
    } catch (err: any) {
      setError(err?.message || 'Failed to save sales settings')
      showNotification({
        title: 'Save Failed',
        message: err?.message || 'Failed to save sales settings',
        color: 'red',
      })
    } finally {
      setSaving(false)
    }
  }

  // Keyboard shortcut: Cmd+S / Ctrl+S to save
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  // Synchronize products from central Catalog into sales settings
  function syncFromCatalog() {
    if (!catalogProducts.length) {
      showNotification({
        title: 'No Catalog Products',
        message: 'No products were found in the Product Catalog for this brand.',
        color: 'orange',
      })
      return
    }

    setSettings((prev) => {
      const existing = [...(prev.products || [])]
      let added = 0
      let updated = 0

      for (const catProd of catalogProducts) {
        const matchIdx = existing.findIndex(
          (p) => p.id === catProd.id || p.name.trim().toLowerCase() === catProd.name.trim().toLowerCase()
        )

        if (matchIdx >= 0) {
          const current = existing[matchIdx]
          const updatedPricing = { ...current.pricing }
          if (catProd.pricingModel === 'one_time') updatedPricing.oneTimePrice = catProd.unitPrice
          else if (catProd.pricingModel === 'monthly_subscription') updatedPricing.monthlyPrice = catProd.unitPrice
          else if (catProd.pricingModel === 'annual_subscription') updatedPricing.annualPrice = catProd.unitPrice
          else if (catProd.pricingModel === 'campaign_based') updatedPricing.campaignPrice = catProd.unitPrice
          else if (catProd.pricingModel === 'per_user') {
            updatedPricing.perUserPrice = catProd.unitPrice
            updatedPricing.perUserTypical = catProd.unitPrice
          }

          const pricingModels = current.pricingModels.includes(catProd.pricingModel)
            ? current.pricingModels
            : [...current.pricingModels, catProd.pricingModel]

          existing[matchIdx] = {
            ...current,
            name: catProd.name,
            description: current.description || catProd.description || '',
            pricing: updatedPricing,
            pricingModels,
          }
          updated++
        } else {
          existing.push(catalogProductToProductLine(catProd))
          added++
        }
      }

      showNotification({
        title: 'Catalog Synced',
        message: `Synchronized ${added} new and updated ${updated} existing product offering(s) from the Product Catalog.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      })

      return { ...prev, products: existing }
    })
  }

  function addRegionRow() {
    setRegionRows((rows) => [...rows, { id: `region-${rows.length}-${Math.random().toString(36).slice(2, 8)}`, region: '', multiplier: undefined }])
  }

  function removeRegionRow(id: string) {
    setRegionRows((rows) => rows.filter((r) => r.id !== id))
  }

  function updateRegionRow(id: string, patch: Partial<RegionMultiplierRow>) {
    setRegionRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  }

  function addProduct() {
    setSettings((s) => ({
      ...s,
      products: [...s.products, emptyProductLine(`product-${s.products.length}-${Math.random().toString(36).slice(2, 8)}`)],
    }))
  }

  function removeProduct(id: string) {
    setSettings((s) => ({ ...s, products: s.products.filter((p) => p.id !== id) }))
  }

  function updateProduct(id: string, patch: Partial<ProductLine>) {
    setSettings((s) => ({
      ...s,
      products: s.products.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  }

  function updateProductPricing(id: string, field: keyof ProductLine['pricing'], value: number | undefined) {
    setSettings((s) => ({
      ...s,
      products: s.products.map((p) => (p.id === id ? { ...p, pricing: { ...p.pricing, [field]: value } } : p)),
    }))
  }

  function toggleAssignedUser(ssoUserId: string) {
    setSettings((s) => {
      const current = s.assignedUserIds || []
      const next = current.includes(ssoUserId)
        ? current.filter((id) => id !== ssoUserId)
        : [...current, ssoUserId]
      return { ...s, assignedUserIds: next }
    })
  }

  if (loading) {
    return (
      <Box px={{ base: 'sm', sm: 'md', md: 'lg' }} py="md" w="100%">
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      </Box>
    )
  }

  const assignedCount = settings.assignedUserIds?.length || 0
  const productCount = settings.products?.length || 0

  return (
    <Box px={{ base: 'sm', sm: 'md', md: 'lg' }} py="md" w="100%" style={{ flex: 1, minWidth: 0 }}>
      <Stack gap="md">
        {/* Modern Application Header */}
        <Group justify="space-between" align="flex-start" wrap="wrap" gap="sm">
          <div>
            <Group gap="xs" align="center">
              <Title order={2} style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
                {label} — Sales & Company Settings
              </Title>
              <LabelTag tone="info" size="xs" label={settings.companyName || label} />
              {isDirty && (
                <StatusBadge status="warning" size="xs">
                  Unsaved changes
                </StatusBadge>
              )}
            </Group>
            <Text size="xs" c="dimmed" mt={3}>
              Configure commercial parameters, product offerings, assigned sales team members, and pipeline targets.
            </Text>
          </div>

          <Group gap="xs" wrap="wrap">
            <Button
              component={Link}
              href={`/admin/products/${brand}`}
              variant="default"
              size="xs"
              leftSection={<IconShoppingCart size={14} />}
              rightSection={<IconExternalLink size={12} />}
            >
              Product Catalog ({catalogProducts.length})
            </Button>
            <Button
              component={Link}
              href={`/salessettings/${brand}/integrations`}
              variant="default"
              size="xs"
              leftSection={<IconPlug size={14} />}
            >
              Integrations
            </Button>
            <Button
              onClick={save}
              loading={saving}
              size="xs"
              color={isDirty ? 'indigo' : 'gray'}
              variant={isDirty ? 'filled' : 'light'}
              leftSection={<IconDeviceFloppy size={14} />}
            >
              Save settings
            </Button>
          </Group>
        </Group>

        {error && (
          <InlineAlert severity="error" title="Settings Error" message={error} />
        )}

        {/* Modern Tabs Navigation */}
        <Tabs value={activeTab} onChange={setActiveTab} variant="outline" radius="md">
          <Tabs.List mb="md">
            <Tabs.Tab value="overview" leftSection={<IconBuilding size={16} />}>
              Company & Team
              {assignedCount > 0 && <CountBadge value={assignedCount} size="xs" ml={6} />}
            </Tabs.Tab>
            <Tabs.Tab value="products" leftSection={<IconPackage size={16} />}>
              Products & Pricing
              {productCount > 0 && <CountBadge value={productCount} size="xs" ml={6} />}
            </Tabs.Tab>
            <Tabs.Tab value="deals" leftSection={<IconCoins size={16} />}>
              Deal Sizing & Regions
            </Tabs.Tab>
            <Tabs.Tab value="process" leftSection={<IconTimeline size={16} />}>
              Sales Process
            </Tabs.Tab>
            <Tabs.Tab value="targets" leftSection={<IconTarget size={16} />}>
              Targets & Seasonality
            </Tabs.Tab>
          </Tabs.List>

          {/* TAB 1: Company & Team */}
          <Tabs.Panel value="overview">
            <Stack gap="md">
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <div>
                      <Title order={4}>Company Identity</Title>
                      <Text size="xs" c="dimmed">Basic organizational profile and industry classifications.</Text>
                    </div>
                  </Group>

                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    <TextInput
                      label="Company name"
                      value={settings.companyName}
                      onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, companyName: v })); }}
                    />
                    <TextInput
                      label="Website URL"
                      placeholder="https://example.com"
                      value={settings.website}
                      onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, website: v })); }}
                    />
                    <TextInput
                      label="Main industry"
                      placeholder="e.g. Sports Tech, Fan Engagement"
                      value={settings.mainIndustry}
                      onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, mainIndustry: v })); }}
                    />
                    <TextInput
                      label="Primary contact person / Title"
                      placeholder="e.g. Sales Director"
                      value={settings.contactPerson}
                      onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, contactPerson: v })); }}
                    />
                  </SimpleGrid>

                  <Divider my="xs" />

                  <Checkbox.Group
                    label="Main customer types"
                    description="Organizations and buyer entities your business sells to."
                    value={settings.customerTypes}
                    onChange={(value) => setSettings((s) => ({ ...s, customerTypes: value as SalesSettings['customerTypes'] }))}
                  >
                    <Group gap="sm" mt="xs">
                      {getCustomerTypeOptions(salesVocabulary).map((opt) => (
                        <Checkbox key={opt.value} value={opt.value} label={opt.label} />
                      ))}
                    </Group>
                  </Checkbox.Group>
                  {settings.customerTypes?.includes('other') && (
                    <TextInput
                      label="Other customer type"
                      value={settings.customerTypesOther}
                      onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, customerTypesOther: v })); }}
                      placeholder="Specify other customer type"
                    />
                  )}
                </Stack>
              </Paper>

              {/* Assigned Sales Team & Deal Ownership */}
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <div>
                      <Title order={4}>Assigned Sales Team & Deal Ownership</Title>
                      <Text size="xs" c="dimmed">
                        Assign team members who manage pipeline leads for this brand and designate the default deal owner.
                      </Text>
                    </div>
                  <Group gap="xs">
                    <Button
                      component={Link}
                      href={`/forms/${brand}`}
                      target="_blank"
                      variant="light"
                      color="indigo"
                      size="xs"
                      leftSection={<IconExternalLink size={14} />}
                    >
                      Public Lead Form
                    </Button>
                    <Button
                      component={Link}
                      href="/admin/users"
                      variant="subtle"
                      size="xs"
                      leftSection={<IconUsers size={14} />}
                    >
                      Manage Users
                    </Button>
                  </Group>
                  </Group>

                  {/* Default Deal Owner */}
                  <Select
                    label="Default deal owner for inbound leads"
                    description="Automatically assigned to newly discovered, imported, or converted leads without an explicit owner."
                    placeholder="Select default owner"
                    value={settings.defaultDealOwnerEmail || null}
                    onChange={(val) => {
                      const email = val || ''
                      setSettings((s) => {
                        const matchedUser = assignableUsers.find((u) => u.email.toLowerCase() === email.toLowerCase())
                        return {
                          ...s,
                          defaultDealOwnerEmail: email,
                          contactPerson: s.contactPerson ? s.contactPerson : (matchedUser?.name || ''),
                        }
                      })
                    }}
                    data={assignableUsers.map((u) => ({
                      value: u.email,
                      label: `${u.name || u.email} (${u.email})`,
                    }))}
                    clearable
                    searchable
                  />

                  <Divider my="xs" label="Active Brand Sales Representatives" labelPosition="left" />

                  {usersLoading ? (
                    <Group justify="center" py="md"><Loader size="sm" /></Group>
                  ) : assignableUsers.length === 0 ? (
                    <Text size="sm" c="dimmed">
                      No users have explicit access to this brand yet. Configure user access in Admin &gt; Users.
                    </Text>
                  ) : (
                    <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                      {assignableUsers.map((user) => {
                        const isAssigned = (settings.assignedUserIds || []).includes(user.ssoUserId)
                        const isDefaultOwner = settings.defaultDealOwnerEmail?.toLowerCase() === user.email.toLowerCase()
                        return (
                          <Card
                            key={user.ssoUserId}
                            withBorder
                            p="xs"
                            radius="sm"
                            style={{
                              borderColor: isAssigned ? 'var(--mantine-color-indigo-4)' : undefined,
                              backgroundColor: isAssigned ? 'var(--mantine-color-indigo-0)' : undefined,
                            }}
                          >
                            <Group justify="space-between" align="center" wrap="nowrap">
                              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                                <Switch
                                  checked={isAssigned}
                                  onChange={() => toggleAssignedUser(user.ssoUserId)}
                                  size="sm"
                                  aria-label={`Assign ${user.name || user.email}`}
                                />
                                <div style={{ minWidth: 0 }}>
                                  <Group gap={6} wrap="nowrap">
                                    <Text size="sm" fw={600} truncate>
                                      {user.name || 'Unnamed User'}
                                    </Text>
                                    {isDefaultOwner && (
                                      <StatusBadge status="success" size="xs">Default Owner</StatusBadge>
                                    )}
                                  </Group>
                                  <Text size="xs" c="dimmed" truncate>
                                    {user.email}
                                  </Text>
                                </div>
                              </Group>
                              {isAssigned && (
                                <ThemeIcon size="xs" color="indigo" variant="light" radius="xl">
                                  <IconUserCheck size={12} />
                                </ThemeIcon>
                              )}
                            </Group>
                          </Card>
                        )
                      })}
                    </SimpleGrid>
                  )}
                </Stack>
              </Paper>

              {/* Issue #284: Inbound Web Lead Capture Form (Share & Embed) */}
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="center" wrap="wrap">
                    <div>
                      <Group gap="xs" align="center">
                        <Title order={4}>Inbound Web Lead Capture Form (Share &amp; Embed)</Title>
                        <StatusBadge status="success" size="xs">Live</StatusBadge>
                      </Group>
                      <Text size="xs" c="dimmed">
                        Public and embeddable web form that creates DISCOVERED leads with source=&apos;inbound&apos;, deduplicates contacts, and triggers lead.created automations.
                      </Text>
                    </div>
                    <Group gap="xs">
                      <Button
                        size="xs"
                        variant="light"
                        onClick={() => {
                          const url = `${window.location.origin}/forms/${brand}`;
                          navigator.clipboard?.writeText(url);
                          showNotification({ title: 'Copied', message: 'Public form URL copied to clipboard.', color: 'teal' });
                        }}
                      >
                        Copy Public URL
                      </Button>
                      <Button
                        size="xs"
                        variant="default"
                        onClick={() => {
                          const snippet = `<iframe src="${window.location.origin}/forms/${brand}?embed=1" width="100%" height="680" style="border:0;border-radius:8px;" loading="lazy"></iframe>`;
                          navigator.clipboard?.writeText(snippet);
                          showNotification({ title: 'Copied', message: 'HTML iframe embed snippet copied to clipboard.', color: 'teal' });
                        }}
                      >
                        Copy Embed &lt;iframe&gt;
                      </Button>
                    </Group>
                  </Group>
                  <TextInput
                    label="Direct Public URL"
                    readOnly
                    value={`/forms/${brand}`}
                    description="Share on social bio links, event QR codes, or partner portals."
                  />
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>

          {/* TAB 2: Products & Pricing */}
          <Tabs.Panel value="products">
            <Stack gap="md">
              {/* Product Catalog Status Banner */}
              <Paper withBorder p="md" radius="md" style={{ backgroundColor: 'var(--gds-bg-surface, var(--mantine-color-gray-0))' }}>
                <Group justify="space-between" align="center" wrap="wrap" gap="sm">
                  <div>
                    <Group gap="xs" align="center">
                      <Title order={4}>Product Catalog Synchronization</Title>
                      <StatusBadge status="success" size="xs">2-Way Live Sync</StatusBadge>
                      <CountBadge
                        value={catalogProducts.length}
                        size="md"
                        srLabel="Active catalog products"
                      />
                    </Group>
                    <Text size="xs" c="dimmed" mt={2}>
                      Bidirectional live synchronization: updates saved here automatically propagate to the central Product Catalog, and changes made in the Catalog immediately update sales offerings.
                    </Text>
                  </div>

                  <Group gap="xs">
                    <Button
                      onClick={syncFromCatalog}
                      variant="light"
                      color="indigo"
                      size="xs"
                      leftSection={<IconRefresh size={14} />}
                      loading={catalogLoading}
                    >
                      Sync from Product Catalog
                    </Button>
                    <Button
                      component={Link}
                      href={`/admin/products/${brand}`}
                      variant="default"
                      size="xs"
                      leftSection={<IconExternalLink size={14} />}
                    >
                      Open Catalog
                    </Button>
                  </Group>
                </Group>

                {catalogProducts.length > 0 && (
                  <Group gap="xs" mt="sm">
                    {catalogProducts.map((cp) => (
                      <LabelTag
                        key={cp.id}
                        tone="info"
                        size="xs"
                        label={`${cp.name} (${cp.unitPrice} ${cp.currency} / ${cp.pricingModel.replace('_', ' ')})`}
                      />
                    ))}
                  </Group>
                )}
              </Paper>

              {/* Product Lines Editor */}
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    <div>
                      <Title order={4}>Sales Offerings & Pitch Configuration</Title>
                      <Text size="xs" c="dimmed">
                        Detail what you sell, target customer tiers, pricing models, and value propositions used by AI lead research.
                      </Text>
                    </div>
                    <Button size="xs" leftSection={<IconPlus size={14} />} onClick={addProduct} variant="light">
                      Add product offering
                    </Button>
                  </Group>

                  {!settings.products?.length ? (
                    <Text size="sm" c="dimmed" py="md" ta="center">
                      No products configured yet. Click &quot;Sync from Product Catalog&quot; or &quot;Add product offering&quot; above.
                    </Text>
                  ) : (
                    settings.products.map((product, idx) => {
                      const matchesCatalog = catalogProducts.some(
                        (cp) => cp.id === product.id || cp.name.trim().toLowerCase() === product.name.trim().toLowerCase()
                      )
                      return (
                        <Card key={product.id} withBorder p="sm" radius="md">
                          <Stack gap="sm">
                            <Group justify="space-between">
                              <Group gap="xs">
                                <LabelTag tone="neutral" size="xs" label={`Offering ${idx + 1}`} />
                                {matchesCatalog ? (
                                  <StatusBadge status="success" size="xs">In Catalog</StatusBadge>
                                ) : (
                                  <LabelTag tone="neutral" size="xs" label="Custom" />
                                )}
                              </Group>
                              <ActionIcon color="red" variant="subtle" size="sm" onClick={() => removeProduct(product.id)} aria-label="Remove offering">
                                <IconTrash size={14} />
                              </ActionIcon>
                            </Group>

                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xs">
                              <TextInput
                                label="Product / service name"
                                value={product.name}
                                onChange={(e) => updateProduct(product.id, { name: e.currentTarget.value })}
                              />
                              <Select
                                label="Revenue predictability"
                                placeholder="How predictable is this revenue?"
                                value={product.revenuePredictability || null}
                                onChange={(value) => updateProduct(product.id, { revenuePredictability: (value as ProductLine['revenuePredictability']) || '' })}
                                data={REVENUE_PREDICTABILITY_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                                clearable
                              />
                            </SimpleGrid>

                            <Textarea
                              label="Short description"
                              value={product.description}
                              onChange={(e) => updateProduct(product.id, { description: e.currentTarget.value })}
                              minRows={2}
                            />
                            <Textarea
                              label="Why customer buys this"
                              placeholder="Value proposition, pain point solved, or revenue potential"
                              value={product.whyTheyBuy}
                              onChange={(e) => updateProduct(product.id, { whyTheyBuy: e.currentTarget.value })}
                              minRows={2}
                            />

                            <Divider label="Target Buyers & Sizing" labelPosition="left" />
                            <Checkbox.Group
                              label="Typical buyer role"
                              value={product.typicalBuyer}
                              onChange={(value) => updateProduct(product.id, { typicalBuyer: value as ProductLine['typicalBuyer'] })}
                            >
                              <Group gap="sm" mt="xs">
                                {getBuyerRoleOptions(salesVocabulary).map((opt) => (
                                  <Checkbox key={opt.value} value={opt.value} label={opt.label} />
                                ))}
                              </Group>
                            </Checkbox.Group>

                            {product.typicalBuyer.includes('other') && (
                              <TextInput
                                label="Other buyer role"
                                value={product.typicalBuyerOther}
                                onChange={(e) => updateProduct(product.id, { typicalBuyerOther: e.currentTarget.value })}
                              />
                            )}

                            <Checkbox.Group
                              label="Target customer size"
                              value={product.customerSize}
                              onChange={(value) => updateProduct(product.id, { customerSize: value as ProductLine['customerSize'] })}
                            >
                              <Group gap="sm" mt="xs">
                                {CUSTOMER_SIZE_OPTIONS.map((opt) => (
                                  <Checkbox key={opt.value} value={opt.value} label={opt.label} />
                                ))}
                              </Group>
                            </Checkbox.Group>

                            <Divider label="Pricing Models & Structure" labelPosition="left" />
                            <Checkbox.Group
                              value={product.pricingModels}
                              onChange={(value) => updateProduct(product.id, { pricingModels: value as ProductLine['pricingModels'] })}
                            >
                              <Group gap="sm" mt="xs">
                                {PRICING_MODEL_OPTIONS.map((opt) => (
                                  <Checkbox key={opt.value} value={opt.value} label={opt.label} />
                                ))}
                              </Group>
                            </Checkbox.Group>

                            {product.pricingModels.map((model) => (
                              <Group grow key={model}>
                                {PRICING_FIELD_MAP[model].map((field) => (
                                  <NumberInput
                                    key={String(field.key)}
                                    label={pricingFieldLabel(field, currencySymbol)}
                                    value={product.pricing[field.key] ?? ''}
                                    onChange={(value) => updateProductPricing(product.id, field.key, typeof value === 'number' ? value : undefined)}
                                    min={0}
                                  />
                                ))}
                              </Group>
                            ))}
                          </Stack>
                        </Card>
                      )
                    })
                  )}
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>

          {/* TAB 3: Deal Sizing & Regions */}
          <Tabs.Panel value="deals">
            <Stack gap="md">
              {/* Typical Deal Size */}
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Title order={4}>Typical Deal Size Calibration</Title>
                  <Text size="xs" c="dimmed">
                    Benchmark contract sizes across customer tiers. This feeds the ICE scoring model and ticket size estimation.
                  </Text>
                  <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }} spacing="sm">
                    <NumberInput
                      label={`Small customer (${currencySymbol})`}
                      value={settings.dealSize.small ?? ''}
                      onChange={(value) => setSettings((s) => ({ ...s, dealSize: { ...s.dealSize, small: typeof value === 'number' ? value : undefined } }))}
                      min={0}
                    />
                    <NumberInput
                      label={`Medium customer (${currencySymbol})`}
                      value={settings.dealSize.medium ?? ''}
                      onChange={(value) => setSettings((s) => ({ ...s, dealSize: { ...s.dealSize, medium: typeof value === 'number' ? value : undefined } }))}
                      min={0}
                    />
                    <NumberInput
                      label={`Large customer (${currencySymbol})`}
                      value={settings.dealSize.large ?? ''}
                      onChange={(value) => setSettings((s) => ({ ...s, dealSize: { ...s.dealSize, large: typeof value === 'number' ? value : undefined } }))}
                      min={0}
                    />
                    <NumberInput
                      label={`Enterprise customer (${currencySymbol})`}
                      value={settings.dealSize.enterprise ?? ''}
                      onChange={(value) => setSettings((s) => ({ ...s, dealSize: { ...s.dealSize, enterprise: typeof value === 'number' ? value : undefined } }))}
                      min={0}
                    />
                  </SimpleGrid>

                  <NumberInput
                    label={`Largest contract won so far (${currencySymbol})`}
                    description="Historic upper benchmark used for ceiling estimation."
                    value={settings.dealSize.largestWon ?? ''}
                    onChange={(value) => setSettings((s) => ({ ...s, dealSize: { ...s.dealSize, largestWon: typeof value === 'number' ? value : undefined } }))}
                    min={0}
                  />
                </Stack>
              </Paper>

              {/* Region Multipliers */}
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <div>
                      <Title order={4}>Geographic Region Multipliers</Title>
                      <Text size="xs" c="dimmed">
                        Adjust ticket sizes for specific regions (e.g. CEE deals may trend smaller than US deals).
                      </Text>
                    </div>
                    <Button size="xs" leftSection={<IconPlus size={14} />} onClick={addRegionRow} variant="light">
                      Add region
                    </Button>
                  </Group>

                  {!regionRows.length ? (
                    <Text size="sm" c="dimmed">No region multipliers configured. All regions will use the neutral 1.0 base multiplier.</Text>
                  ) : (
                    regionRows.map((row) => (
                      <Group key={row.id} align="flex-end">
                        <TextInput
                          label="Region Code / Name"
                          placeholder="e.g. CEE, DACH, US"
                          value={row.region}
                          onChange={(e) => { const v = e.currentTarget.value; updateRegionRow(row.id, { region: v }) }}
                          style={{ flex: 1 }}
                        />
                        <NumberInput
                          label="Multiplier (e.g. 0.8 = -20%, 1.2 = +20%)"
                          placeholder="1.0"
                          value={row.multiplier ?? ''}
                          onChange={(value) => updateRegionRow(row.id, { multiplier: typeof value === 'number' ? value : undefined })}
                          min={0}
                          step={0.05}
                          decimalScale={2}
                          style={{ flex: 1 }}
                        />
                        <ActionIcon color="red" variant="subtle" size="lg" onClick={() => removeRegionRow(row.id)} aria-label="Delete region row">
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Group>
                    ))
                  )}
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>

          {/* TAB 4: Sales Process */}
          <Tabs.Panel value="process">
            <Stack gap="md">
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Title order={4}>Sales Cycle & Purchase Behavior</Title>
                  <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                    <Select
                      label="Typical sales cycle duration"
                      value={settings.salesCycle || null}
                      onChange={(value) => setSettings((s) => ({ ...s, salesCycle: (value as SalesSettings['salesCycle']) || '' }))}
                      data={SALES_CYCLE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                      clearable
                    />
                    <TextInput
                      label="Key approval authority / Decision Maker title"
                      placeholder="e.g. CEO, Marketing Director, Board"
                      value={settings.approver}
                      onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, approver: v })); }}
                    />
                  </SimpleGrid>

                  <Checkbox.Group
                    label="Purchase frequency"
                    value={settings.purchaseFrequency}
                    onChange={(value) => setSettings((s) => ({ ...s, purchaseFrequency: value as SalesSettings['purchaseFrequency'] }))}
                  >
                    <Group gap="sm" mt="xs">
                      {PURCHASE_FREQUENCY_OPTIONS.map((opt) => (
                        <Checkbox key={opt.value} value={opt.value} label={opt.label} />
                      ))}
                    </Group>
                  </Checkbox.Group>
                  <Textarea
                    label="Purchase frequency nuances & renewal notes"
                    value={settings.purchaseFrequencyComments}
                    onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, purchaseFrequencyComments: v })); }}
                    minRows={2}
                  />
                </Stack>
              </Paper>

              {/* Upsell and Example Customer */}
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Title order={4}>Upsell Potential & Customer Benchmark</Title>
                  <Group grow align="flex-start">
                    <Textarea
                      label="Common expansion products / upsell paths"
                      value={settings.upsell.commonAdditionalProducts}
                      onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, upsell: { ...s.upsell, commonAdditionalProducts: v } })); }}
                      minRows={2}
                      style={{ flex: 2 }}
                    />
                    <NumberInput
                      label={`Typical upsell value (${currencySymbol})`}
                      value={settings.upsell.typicalValue ?? ''}
                      onChange={(value) => setSettings((s) => ({ ...s, upsell: { ...s.upsell, typicalValue: typeof value === 'number' ? value : undefined } }))}
                      min={0}
                      style={{ flex: 1 }}
                    />
                  </Group>

                  <Divider my="xs" label="Representative Customer Example" labelPosition="left" />
                  <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                    <TextInput
                      label="Example customer name"
                      placeholder="e.g. AS Roma"
                      value={settings.exampleCustomer.name}
                      onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, exampleCustomer: { ...s.exampleCustomer, name: v } })); }}
                    />
                    <TextInput
                      label="Contract length"
                      placeholder="e.g. 1 season, 12 months"
                      value={settings.exampleCustomer.contractLength}
                      onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, exampleCustomer: { ...s.exampleCustomer, contractLength: v } })); }}
                    />
                    <NumberInput
                      label={`Total contract value (${currencySymbol})`}
                      value={settings.exampleCustomer.totalContractValue ?? ''}
                      onChange={(value) => setSettings((s) => ({ ...s, exampleCustomer: { ...s.exampleCustomer, totalContractValue: typeof value === 'number' ? value : undefined } }))}
                      min={0}
                    />
                  </SimpleGrid>
                  <Textarea
                    label="Products purchased by example customer"
                    value={settings.exampleCustomer.productsPurchased}
                    onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, exampleCustomer: { ...s.exampleCustomer, productsPurchased: v } })); }}
                    minRows={2}
                  />
                </Stack>
              </Paper>

              {/* Issue 271: Communication Center & Inbox Scoping Policy */}
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Title order={4}>Communication Center &amp; Inbox Scoping Policy</Title>
                  <Text size="xs" c="dimmed">
                    Configure mailbox isolation and thread visibility rules for the Unified Inbox.
                  </Text>
                  <Group justify="space-between" align="center">
                    <Box style={{ flex: 1 }}>
                      <Text size="sm" fw={500}>Include Team Correspondence on Assigned Leads</Text>
                      <Text size="xs" c="dimmed">
                        {settings.inboxSettings?.includeAssignedLeadThreads
                          ? 'Active: Sales reps will see correspondence on leads assigned to them, including emails sent or received by other colleagues.'
                          : 'Strict Mailbox Only (Recommended): Sales reps strictly only see emails where their own linked mailboxes are an active participant (From, To). Other reps\' emails on assigned leads will not appear in their inbox.'}
                      </Text>
                    </Box>
                    <Switch
                      checked={Boolean(settings.inboxSettings?.includeAssignedLeadThreads)}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setSettings((s) => ({
                          ...s,
                          inboxSettings: {
                            ...s.inboxSettings,
                            includeAssignedLeadThreads: checked,
                          },
                        }));
                      }}
                      aria-label="Toggle include team correspondence on assigned leads"
                    />
                  </Group>
                  <Divider />
                  <Group justify="space-between" align="center">
                    <Box style={{ flex: 1 }}>
                      <Text size="sm" fw={500}>Include CC&apos;d Threads in My Inbox</Text>
                      <Text size="xs" c="dimmed">
                        {settings.inboxSettings?.includeCcThreads
                          ? 'Active: Threads where a user is on CC will appear in their personal Inbox alongside direct correspondence.'
                          : 'Strict Direct Participation (Recommended): Threads where a user is only on CC are excluded from their personal Inbox. Prevents management oversight CCs from cluttering sales inboxes.'}
                      </Text>
                    </Box>
                    <Switch
                      checked={Boolean(settings.inboxSettings?.includeCcThreads)}
                      onChange={(e) => {
                        const checked = e.currentTarget.checked;
                        setSettings((s) => ({
                          ...s,
                          inboxSettings: {
                            ...s.inboxSettings,
                            includeCcThreads: checked,
                          },
                        }));
                      }}
                      aria-label="Toggle include CC threads in inbox"
                    />
                  </Group>
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>

          {/* TAB 5: Targets & Seasonality */}
          <Tabs.Panel value="targets">
            <Stack gap="md">
              {/* Revenue Target */}
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Title order={4}>Pipeline Revenue Target</Title>
                  <Text size="xs" c="dimmed">
                    Powers the Pipeline Coverage Ratio and goal tracking on the Forecast workspace (/forecast/{brand}).
                  </Text>
                  <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
                    <NumberInput
                      label="Target amount"
                      value={settings.revenueTarget.amount ?? ''}
                      onChange={(value) => setSettings((s) => ({ ...s, revenueTarget: { ...s.revenueTarget, amount: typeof value === 'number' ? value : undefined } }))}
                      min={0}
                    />
                    <Select
                      label="Currency"
                      value={settings.revenueTarget.currency}
                      onChange={(value) => value && setSettings((s) => ({ ...s, revenueTarget: { ...s.revenueTarget, currency: value as SalesSettings['revenueTarget']['currency'] } }))}
                      data={REVENUE_TARGET_CURRENCY_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                    />
                    <Select
                      label="Period"
                      value={settings.revenueTarget.period}
                      onChange={(value) => value && setSettings((s) => ({ ...s, revenueTarget: { ...s.revenueTarget, period: value as SalesSettings['revenueTarget']['period'] } }))}
                      data={REVENUE_TARGET_PERIOD_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                    />
                  </SimpleGrid>
                </Stack>
              </Paper>

              {/* Seasonality */}
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Title order={4}>Seasonality & Peak Trading</Title>
                  <Checkbox.Group
                    label="Busiest quarters"
                    value={settings.seasonality.quarters}
                    onChange={(value) => setSettings((s) => ({ ...s, seasonality: { ...s.seasonality, quarters: value as SalesSettings['seasonality']['quarters'] } }))}
                  >
                    <Group gap="sm" mt="xs">
                      {QUARTER_OPTIONS.map((opt) => (
                        <Checkbox key={opt.value} value={opt.value} label={opt.label} />
                      ))}
                    </Group>
                  </Checkbox.Group>
                  <TextInput
                    label="Specific peak months (optional)"
                    placeholder="e.g. August, September (Season start)"
                    value={settings.seasonality.specificMonths}
                    onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, seasonality: { ...s.seasonality, specificMonths: v } })); }}
                  />
                </Stack>
              </Paper>

              {/* Commercial Notes */}
              <Paper withBorder p="md" radius="md">
                <Stack gap="sm">
                  <Title order={4}>Commercial Notes & Guidelines</Title>
                  <Textarea
                    label="Pricing policies, standard discounts, renewal terms, and exception handling"
                    placeholder="Document multi-year discounts, pilot pricing criteria, or special billing exceptions..."
                    value={settings.notes}
                    onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, notes: v })); }}
                    minRows={4}
                  />
                </Stack>
              </Paper>
            </Stack>
          </Tabs.Panel>
        </Tabs>

        {/* Bottom Save Bar */}
        <Group justify="space-between" align="center" pt="xs">
          <Text size="xs" c="dimmed">
            Tip: Press <kbd>Cmd+S</kbd> / <kbd>Ctrl+S</kbd> to save changes anytime.
          </Text>
          <Button onClick={save} loading={saving} color={isDirty ? 'indigo' : 'gray'}>
            Save settings
          </Button>
        </Group>
      </Stack>
    </Box>
  )
}
