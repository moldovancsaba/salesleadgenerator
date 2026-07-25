'use client'

import { useEffect, useState } from 'react'
import {
  Container, Title, Text, Button, Group, Stack, Textarea, TextInput, NumberInput,
  Select, Checkbox, Paper, Loader, Divider, Badge,
} from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { BRAND_CONFIG, type Brand } from '@/app/lib/brand'
import {
  type SalesSettings, type ProductLine, type PricingModel,
  emptySalesSettings, emptyProductLine,
  CUSTOMER_TYPE_OPTIONS, BUYER_ROLE_OPTIONS, CUSTOMER_SIZE_OPTIONS, PRICING_MODEL_OPTIONS,
  PURCHASE_FREQUENCY_OPTIONS, SALES_CYCLE_OPTIONS, REVENUE_PREDICTABILITY_OPTIONS, QUARTER_OPTIONS,
  REVENUE_TARGET_CURRENCY_OPTIONS, REVENUE_TARGET_PERIOD_OPTIONS,
} from '@/app/lib/sales-settings'

const PRICING_FIELD_MAP: Record<PricingModel, { key: keyof ProductLine['pricing']; label: string }[]> = {
  one_time: [{ key: 'oneTimePrice', label: 'One-time price (€)' }],
  monthly_subscription: [{ key: 'monthlyPrice', label: 'Monthly price (€)' }],
  annual_subscription: [{ key: 'annualPrice', label: 'Annual price (€)' }],
  framework_agreement: [{ key: 'frameworkAnnualValue', label: 'Framework annual value (€)' }],
  campaign_based: [
    { key: 'campaignPrice', label: 'Campaign price (€)' },
    { key: 'campaignDurationMonths', label: 'Typical campaign duration (months)' },
  ],
  per_user: [
    { key: 'perUserPrice', label: 'Price per user (€)' },
    { key: 'perUserMinimum', label: 'Minimum users' },
    { key: 'perUserTypical', label: 'Typical users' },
  ],
  per_product: [{ key: 'perProductPrice', label: 'Price per product sold (€)' }],
  per_event: [{ key: 'perEventPrice', label: 'Price per event (€)' }],
  custom_quotation: [{ key: 'customQuotationTypicalValue', label: 'Typical quotation value (€)' }],
}

// Region is genuinely free text (Lead.region has no server-side enum — see
// app/lib/sales-settings.ts's RegionMultipliers comment), so this is edited
// as region/multiplier rows, not a fixed-field form like Typical Deal Size.
// Kept as separate component state (not directly in `settings.regionMultipliers`,
// a Record) because a Record's key order shifts on rename — editing a row's
// region text in place via delete+reinsert would make the row visually jump
// on every keystroke. Rows are the single source of truth while editing;
// settings.regionMultipliers is rebuilt from them only at save() time.
type RegionMultiplierRow = { id: string; region: string; multiplier: number | undefined }

function rowsFromRegionMultipliers(record: Record<string, number> | undefined): RegionMultiplierRow[] {
  return Object.entries(record || {}).map(([region, multiplier], i) => ({
    id: `region-${i}-${Math.random().toString(36).slice(2, 8)}`,
    region,
    multiplier,
  }))
}

export function SalesSettingsClient({ brand }: { brand: Brand }) {
  const [tenantId, setTenantId] = useState('default')
  const [settings, setSettings] = useState<SalesSettings>(emptySalesSettings(brand))
  const [regionRows, setRegionRows] = useState<RegionMultiplierRow[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tenantId')) setTenantId(params.get('tenantId') || 'default')
    } catch {}
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/sales-settings/${brand}?tenantId=${encodeURIComponent(tenantId)}`)
        if (!res.ok) throw new Error('Failed to load sales settings')
        const data = await res.json()
        const loaded = data.settings || emptySalesSettings(brand, tenantId)
        if (!cancelled) {
          setSettings(loaded)
          setRegionRows(rowsFromRegionMultipliers(loaded.regionMultipliers))
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load sales settings')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [brand, tenantId])

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      // regionMultipliers is rebuilt from regionRows here, not kept live-synced
      // in `settings` — see rowsFromRegionMultipliers()'s comment above. A row
      // with an empty region or no valid multiplier is simply omitted, not
      // an error (mirrors the same "drop, don't corrupt" contract
      // sanitizeRegionMultipliers() itself applies server-side).
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
      setSaved(true)
    } catch (err: any) {
      setError(err?.message || 'Failed to save sales settings')
    } finally {
      setSaving(false)
    }
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

  if (loading) {
    return (
      <Container size="md" py="xl">
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      </Container>
    )
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="lg">
        <div>
          <Title order={2}>{BRAND_CONFIG[brand].label} — Company Setup</Title>
          <Text size="sm" c="dimmed">
            Tell us what you sell and how customers buy it, in your own words. The research
            agent uses this to refine lead scoring and revenue forecasts — no accounting
            terminology required.
          </Text>
        </div>

        {/* 1. Basic Information */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Basic Information</Title>
            <Group grow>
              <TextInput
                label="Company name"
                value={settings.companyName}
                onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, companyName: v })); }}
              />
              <TextInput
                label="Contact person"
                value={settings.contactPerson}
                onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, contactPerson: v })); }}
              />
            </Group>
            <Group grow>
              <TextInput
                label="Website"
                value={settings.website}
                onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, website: v })); }}
              />
              <TextInput
                label="Main industry"
                value={settings.mainIndustry}
                onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, mainIndustry: v })); }}
              />
            </Group>
            <Checkbox.Group
              label="Main customer types"
              value={settings.customerTypes}
              onChange={(value) => setSettings((s) => ({ ...s, customerTypes: value as SalesSettings['customerTypes'] }))}
            >
              <Group gap="sm" mt="xs">
                {CUSTOMER_TYPE_OPTIONS.map((opt) => (
                  <Checkbox key={opt.value} value={opt.value} label={opt.label} />
                ))}
              </Group>
            </Checkbox.Group>
            {settings.customerTypes.includes('other') && (
              <TextInput
                label="Other customer type"
                value={settings.customerTypesOther}
                onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, customerTypesOther: v })); }}
              />
            )}
          </Stack>
        </Paper>

        {/* 2-4, 10. Products */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group justify="space-between">
              <Title order={4}>What do you sell?</Title>
              <Button size="xs" leftSection={<IconPlus size={14} />} onClick={addProduct} variant="light">
                Add product/service
              </Button>
            </Group>

            {!settings.products.length && (
              <Text size="sm" c="dimmed">No products yet. Add your first one above.</Text>
            )}

            {settings.products.map((product, idx) => (
              <Paper key={product.id} withBorder p="sm" radius="md">
                <Stack gap="sm">
                  <Group justify="space-between">
                    <Badge variant="light">Product {idx + 1}</Badge>
                    <Button size="xs" color="red" variant="light" onClick={() => removeProduct(product.id)}>
                      <IconTrash size={14} />
                    </Button>
                  </Group>

                  <TextInput
                    label="Name"
                    value={product.name}
                    onChange={(e) => updateProduct(product.id, { name: e.currentTarget.value })}
                  />
                  <Textarea
                    label="Short description"
                    value={product.description}
                    onChange={(e) => updateProduct(product.id, { description: e.currentTarget.value })}
                    minRows={2}
                  />
                  <Textarea
                    label="Customer buys this because…"
                    value={product.whyTheyBuy}
                    onChange={(e) => updateProduct(product.id, { whyTheyBuy: e.currentTarget.value })}
                    minRows={2}
                  />

                  <Divider label="Who usually buys it?" labelPosition="left" />
                  <Checkbox.Group
                    label="Typical buyer role"
                    value={product.typicalBuyer}
                    onChange={(value) => updateProduct(product.id, { typicalBuyer: value as ProductLine['typicalBuyer'] })}
                  >
                    <Group gap="sm" mt="xs">
                      {BUYER_ROLE_OPTIONS.map((opt) => (
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
                    label="Typical customer size"
                    value={product.customerSize}
                    onChange={(value) => updateProduct(product.id, { customerSize: value as ProductLine['customerSize'] })}
                  >
                    <Group gap="sm" mt="xs">
                      {CUSTOMER_SIZE_OPTIONS.map((opt) => (
                        <Checkbox key={opt.value} value={opt.value} label={opt.label} />
                      ))}
                    </Group>
                  </Checkbox.Group>

                  <Divider label="How is it priced?" labelPosition="left" />
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
                          label={field.label}
                          value={product.pricing[field.key] ?? ''}
                          onChange={(value) => updateProductPricing(product.id, field.key, typeof value === 'number' ? value : undefined)}
                          min={0}
                        />
                      ))}
                    </Group>
                  ))}

                  <Select
                    label="Revenue confidence for this product"
                    placeholder="How predictable is this revenue?"
                    value={product.revenuePredictability || null}
                    onChange={(value) => updateProduct(product.id, { revenuePredictability: (value as ProductLine['revenuePredictability']) || '' })}
                    data={REVENUE_PREDICTABILITY_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
                    clearable
                  />
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Paper>

        {/* 5. Typical Deal Size */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Typical Deal Size</Title>
            <Group grow>
              <NumberInput
                label="Small customer (€)"
                value={settings.dealSize.small ?? ''}
                onChange={(value) => setSettings((s) => ({ ...s, dealSize: { ...s.dealSize, small: typeof value === 'number' ? value : undefined } }))}
                min={0}
              />
              <NumberInput
                label="Medium customer (€)"
                value={settings.dealSize.medium ?? ''}
                onChange={(value) => setSettings((s) => ({ ...s, dealSize: { ...s.dealSize, medium: typeof value === 'number' ? value : undefined } }))}
                min={0}
              />
              <NumberInput
                label="Large customer (€)"
                value={settings.dealSize.large ?? ''}
                onChange={(value) => setSettings((s) => ({ ...s, dealSize: { ...s.dealSize, large: typeof value === 'number' ? value : undefined } }))}
                min={0}
              />
              <NumberInput
                label="Enterprise customer (€)"
                value={settings.dealSize.enterprise ?? ''}
                onChange={(value) => setSettings((s) => ({ ...s, dealSize: { ...s.dealSize, enterprise: typeof value === 'number' ? value : undefined } }))}
                min={0}
              />
            </Group>
            <NumberInput
              label="Largest customer won so far (€)"
              value={settings.dealSize.largestWon ?? ''}
              onChange={(value) => setSettings((s) => ({ ...s, dealSize: { ...s.dealSize, largestWon: typeof value === 'number' ? value : undefined } }))}
              min={0}
            />
          </Stack>
        </Paper>

        {/* 5b. Region Multipliers (issue #84) */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Region Multipliers</Title>
            <Text size="sm" c="dimmed">
              Optional. Adjusts the ticket-size estimate for leads in a specific region — e.g. a CEE or MENA
              deal may realistically run smaller than a US one at the same company-size tier. A region with
              no row below is left unadjusted (1.0). Region text must match a lead&apos;s own region field
              (not case-sensitive — always stored uppercase).
            </Text>
            {regionRows.map((row) => (
              <Group key={row.id} align="flex-end">
                <TextInput
                  label="Region"
                  placeholder="e.g. CEE"
                  value={row.region}
                  onChange={(e) => { const v = e.currentTarget.value; updateRegionRow(row.id, { region: v }) }}
                  style={{ flex: 1 }}
                />
                <NumberInput
                  label="Multiplier"
                  placeholder="1.0"
                  value={row.multiplier ?? ''}
                  onChange={(value) => updateRegionRow(row.id, { multiplier: typeof value === 'number' ? value : undefined })}
                  min={0}
                  step={0.05}
                  decimalScale={2}
                  style={{ flex: 1 }}
                />
                <Button size="xs" color="red" variant="light" onClick={() => removeRegionRow(row.id)}>
                  <IconTrash size={14} />
                </Button>
              </Group>
            ))}
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={addRegionRow} variant="light">
              Add region
            </Button>
          </Stack>
        </Paper>

        {/* 6. Purchase frequency */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>How often does a customer buy?</Title>
            <Checkbox.Group
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
              label="Comments"
              value={settings.purchaseFrequencyComments}
              onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, purchaseFrequencyComments: v })); }}
              minRows={2}
            />
          </Stack>
        </Paper>

        {/* 7. Upsell */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Does the customer usually buy anything else afterwards?</Title>
            <Textarea
              label="Additional products / services"
              value={settings.upsell.commonAdditionalProducts}
              onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, upsell: { ...s.upsell, commonAdditionalProducts: v } })); }}
              minRows={2}
            />
            <NumberInput
              label="Typical additional value (€)"
              value={settings.upsell.typicalValue ?? ''}
              onChange={(value) => setSettings((s) => ({ ...s, upsell: { ...s.upsell, typicalValue: typeof value === 'number' ? value : undefined } }))}
              min={0}
            />
          </Stack>
        </Paper>

        {/* 8. Sales Process */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Sales Process</Title>
            <Select
              label="How long does it usually take to close a deal?"
              value={settings.salesCycle || null}
              onChange={(value) => setSettings((s) => ({ ...s, salesCycle: (value as SalesSettings['salesCycle']) || '' }))}
              data={SALES_CYCLE_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
              clearable
            />
            <TextInput
              label="Who usually approves the purchase?"
              value={settings.approver}
              onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, approver: v })); }}
            />
          </Stack>
        </Paper>

        {/* 9. Typical Customer Example */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Typical Customer Example</Title>
            <Group grow>
              <TextInput
                label="Example customer name"
                value={settings.exampleCustomer.name}
                onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, exampleCustomer: { ...s.exampleCustomer, name: v } })); }}
              />
              <TextInput
                label="Contract length"
                value={settings.exampleCustomer.contractLength}
                onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, exampleCustomer: { ...s.exampleCustomer, contractLength: v } })); }}
              />
            </Group>
            <Textarea
              label="Products purchased"
              value={settings.exampleCustomer.productsPurchased}
              onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, exampleCustomer: { ...s.exampleCustomer, productsPurchased: v } })); }}
              minRows={2}
            />
            <NumberInput
              label="Total contract value (€)"
              value={settings.exampleCustomer.totalContractValue ?? ''}
              onChange={(value) => setSettings((s) => ({ ...s, exampleCustomer: { ...s.exampleCustomer, totalContractValue: typeof value === 'number' ? value : undefined } }))}
              min={0}
            />
          </Stack>
        </Paper>

        {/* 11. Seasonality */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Seasonality</Title>
            <Checkbox.Group
              label="Which quarters are busiest?"
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
              label="Specific months (optional)"
              value={settings.seasonality.specificMonths}
              onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, seasonality: { ...s.seasonality, specificMonths: v } })); }}
            />
          </Stack>
        </Paper>

        {/* Revenue Target — feeds the pipeline coverage ratio on /forecast */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Revenue Target</Title>
            <Text size="xs" c="dimmed">
              Used to show how well the weighted pipeline forecast covers your target on the Forecast page.
              Leave the amount blank to hide the coverage indicator.
            </Text>
            <Group grow>
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
            </Group>
          </Stack>
        </Paper>

        {/* 12. Notes */}
        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Title order={4}>Notes</Title>
            <Textarea
              label="Pricing, discounts, renewals, special cases"
              value={settings.notes}
              onChange={(e) => { const v = e.currentTarget.value; setSettings((s) => ({ ...s, notes: v })); }}
              minRows={3}
            />
          </Stack>
        </Paper>

        <Group justify="flex-end">
          {error && <Text c="red" size="sm">{error}</Text>}
          {saved && !error && <Text c="green" size="sm">Saved.</Text>}
          <Button onClick={save} loading={saving}>
            Save settings
          </Button>
        </Group>
      </Stack>
    </Container>
  )
}
