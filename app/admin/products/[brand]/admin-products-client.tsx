'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Button, Group, Stack, TextInput, NumberInput, Textarea, Select, Switch, Loader, Badge } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState, AdminModal } from '@sovereignsquad/gds-admin/client'
import { IconPlus } from '@tabler/icons-react'
import { CURRENCY_CODE_OPTIONS, type CurrencyCode } from '@/app/lib/brand-constants'
import { PRICING_MODEL_OPTIONS } from '@/app/lib/sales-settings'
import type { PricingModel } from '@/app/lib/sales-settings'
import type { Brand } from '@/app/lib/brand'

type ProductRow = {
  id: string
  name: string
  description: string
  unitPrice: number
  currency: CurrencyCode
  pricingModel: PricingModel
  active: boolean
  createdAt: string
}

type FormState = {
  id: string | null
  name: string
  description: string
  unitPrice: number | ''
  currency: CurrencyCode
  pricingModel: PricingModel | ''
  active: boolean
}

function emptyForm(defaultCurrency: CurrencyCode): FormState {
  return { id: null, name: '', description: '', unitPrice: '', currency: defaultCurrency, pricingModel: '', active: true }
}

type Props = {
  brand: Brand;
  label: string;
  defaultCurrency: CurrencyCode;
};

// Issue #215 — catalog CRUD, matching /admin/clients's AdminDataTable
// pattern but with a real edit/delete AdminModal (this app's first genuine
// AdminModal-based create/edit form, per the issue's own §13/§7 mandate).
export function AdminProductsClient({ brand, label, defaultCurrency }: Props) {
  const [tenantId, setTenantId] = useState('default')

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tenantId')) setTenantId(params.get('tenantId') || 'default')
    } catch {}
  }, [])

  const [products, setProducts] = useState<ProductRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm(defaultCurrency))
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleteBlockedMessage, setDeleteBlockedMessage] = useState<string | null>(null)

  const loadProducts = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const url = new URL(`/api/products/${brand}`, window.location.origin)
      url.searchParams.set('tenantId', tenantId)
      const res = await fetch(url.toString())
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load products (${res.status})`)
      }
      const data = await res.json()
      setProducts(data.products || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load products')
    } finally {
      setLoading(false)
    }
  }, [brand, tenantId])

  useEffect(() => { loadProducts() }, [loadProducts])

  function openCreate() {
    setForm(emptyForm(defaultCurrency))
    setSaveError(null)
    setModalOpen(true)
  }

  function openEdit(row: ProductRow) {
    setForm({ id: row.id, name: row.name, description: row.description, unitPrice: row.unitPrice, currency: row.currency, pricingModel: row.pricingModel, active: row.active })
    setSaveError(null)
    setModalOpen(true)
  }

  const canSave = form.name.trim().length > 0 && typeof form.unitPrice === 'number' && form.unitPrice > 0 && !!form.pricingModel

  async function saveProduct() {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = { name: form.name.trim(), description: form.description.trim(), unitPrice: form.unitPrice, currency: form.currency, pricingModel: form.pricingModel, active: form.active }
      const url = new URL(form.id ? `/api/products/${brand}/${encodeURIComponent(form.id)}` : `/api/products/${brand}`, window.location.origin)
      url.searchParams.set('tenantId', tenantId)
      const res = await fetch(url.toString(), {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Failed to save product (${res.status})`)
      }
      setModalOpen(false)
      await loadProducts()
    } catch (err: any) {
      setSaveError(err?.message || 'Failed to save product')
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(row: ProductRow) {
    setDeleteBlockedMessage(null)
    try {
      const url = new URL(`/api/products/${brand}/${encodeURIComponent(row.id)}`, window.location.origin)
      url.searchParams.set('tenantId', tenantId)
      const res = await fetch(url.toString(), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !row.active }),
      })
      if (!res.ok) throw new Error('Failed to update product')
      await loadProducts()
    } catch (err: any) {
      setError(err?.message || 'Failed to update product')
    }
  }

  async function deleteProduct(row: ProductRow) {
    setDeleteBlockedMessage(null)
    try {
      const url = new URL(`/api/products/${brand}/${encodeURIComponent(row.id)}`, window.location.origin)
      url.searchParams.set('tenantId', tenantId)
      const res = await fetch(url.toString(), { method: 'DELETE' })
      if (res.status === 409) {
        const data = await res.json().catch(() => ({}))
        setDeleteBlockedMessage(data.error || 'Product is referenced by existing deals — deactivate it instead.')
        return
      }
      if (!res.ok && res.status !== 204) throw new Error('Failed to delete product')
      await loadProducts()
    } catch (err: any) {
      setError(err?.message || 'Failed to delete product')
    }
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Title order={2}>Product Catalog</Title>
            <Text size="sm" c="dimmed">
              Priced, reusable line items for <Text span fw={700}>{label}</Text> deals — reps pick from these instead of typing a bare deal value.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={openCreate}>Add product</Button>
        </Group>

        {error && <AdminFormStatus state="error" title="Something went wrong" description={error} />}
        {deleteBlockedMessage && <AdminFormStatus state="error" title="Can't delete this product" description={`${deleteBlockedMessage} Use the active/inactive toggle instead.`} />}

        {loading ? (
          <Group justify="center" py="xl"><Loader /></Group>
        ) : products.length === 0 ? (
          <AdminResourceEmptyState title="No products yet" description="Add the first one above." />
        ) : (
          <AdminDataTable<ProductRow>
            rows={products}
            caption="Catalog products"
            columns={[
              {
                key: 'name',
                header: 'Product',
                rowHeader: true,
                accessor: (row) => (
                  <Group gap={6} wrap="nowrap">
                    <Text fw={600} c="indigo" style={{ cursor: 'pointer' }} onClick={() => openEdit(row)}>{row.name}</Text>
                    {!row.active && <Badge size="xs" color="gray" variant="light">Inactive</Badge>}
                  </Group>
                ),
              },
              { key: 'pricingModel', header: 'Pricing model', accessor: (row) => PRICING_MODEL_OPTIONS.find((o) => o.value === row.pricingModel)?.label ?? row.pricingModel },
              { key: 'unitPrice', header: 'Unit price', numeric: true, accessor: (row) => `${row.currency === 'EUR' ? '€' : '$'}${row.unitPrice.toLocaleString()}` },
              {
                key: 'status',
                header: 'Status',
                accessor: (row) => (
                  <Switch size="xs" checked={row.active} onChange={() => toggleActive(row)} label={row.active ? 'Active' : 'Inactive'} aria-label={`${row.active ? 'Deactivate' : 'Activate'} ${row.name}`} />
                ),
              },
              {
                key: 'actions',
                header: 'Actions',
                accessor: (row) => (
                  <Group gap="xs">
                    <Button size="xs" variant="light" onClick={() => openEdit(row)}>Edit</Button>
                    <Button size="xs" variant="light" color="red" onClick={() => deleteProduct(row)}>Delete</Button>
                  </Group>
                ),
              },
            ]}
            empty={<Text c="dimmed" size="sm">No products.</Text>}
            getRowKey={(row) => row.id}
          />
        )}
      </Stack>

      <AdminModal opened={modalOpen} onClose={() => setModalOpen(false)} title={form.id ? 'Edit product' : 'Add product'} size="md">
        <Stack gap="sm">
          <TextInput label="Name" value={form.name} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, name: v })) }} required />
          <Textarea label="Description (optional)" value={form.description} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, description: v })) }} autosize minRows={2} />
          <Group grow align="flex-start">
            <NumberInput
              label="Unit price"
              prefix={form.currency === 'EUR' ? '€' : '$'}
              thousandSeparator=","
              value={form.unitPrice}
              onChange={(v) => setForm((f) => ({ ...f, unitPrice: typeof v === 'number' ? v : '' }))}
              min={0}
              required
            />
            <Select label="Currency" data={CURRENCY_CODE_OPTIONS} value={form.currency} onChange={(v) => setForm((f) => ({ ...f, currency: (v as CurrencyCode) || 'USD' }))} />
          </Group>
          <Select
            label="Pricing model"
            data={PRICING_MODEL_OPTIONS}
            value={form.pricingModel || null}
            onChange={(v) => setForm((f) => ({ ...f, pricingModel: (v as PricingModel) || '' }))}
            required
          />
          {form.pricingModel === 'custom_quotation' && (
            <Text size="xs" c="dimmed">
              Custom-quotation pricing is a suggested default only — the deal line-item picker requires a rep to confirm or override this price before saving, never using it as a firm rate automatically.
            </Text>
          )}
          <Switch label="Active — selectable for new deal line items" checked={form.active} onChange={(e) => { const v = e.currentTarget.checked; setForm((f) => ({ ...f, active: v })) }} />

          {saveError && <Text c="red" size="sm">{saveError}</Text>}

          <Group justify="flex-end" gap="xs">
            <Button variant="subtle" color="gray" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveProduct} loading={saving} disabled={!canSave}>Save</Button>
          </Group>
        </Stack>
      </AdminModal>
    </Container>
  )
}
