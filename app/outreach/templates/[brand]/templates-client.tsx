'use client'

import { useCallback, useEffect, useState } from 'react'
import { Container, Title, Text, Button, Group, Stack, Textarea, Select, Loader, Paper, TextInput, TagsInput, Badge, Pill } from '@mantine/core'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { BRAND_CONFIG, type Brand } from '@/app/lib/brand'

type Template = {
  id: string
  name: string
  channel: 'email' | 'linkedin'
  industry: string
  subject?: string
  body: string
  variables: string[]
  tags?: string[]
}

const EMPTY_TEMPLATE: Omit<Template, 'id'> = {
  name: '',
  channel: 'email',
  industry: '',
  subject: '',
  body: '',
  variables: [],
  tags: [],
}

type Props = {
  brand: Brand;
};

export function OutreachTemplatesClient({ brand }: Props) {
  // tenantId is a separate multi-tenancy axis from brand (issue #100 only
  // concerns brand/client mixing) — still override-able via ?tenantId=,
  // unlike brand, which now comes exclusively from the URL path segment.
  const [tenantId, setTenantId] = useState('default')

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get('tenantId')) setTenantId(params.get('tenantId') || 'default')
    } catch {}
  }, [])

  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState<Omit<Template, 'id'>>(EMPTY_TEMPLATE)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loadTemplates = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/outreach-templates?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}`)
      if (!res.ok) throw new Error('Failed to load templates')
      const data = await res.json()
      setTemplates(data.templates || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load templates')
    } finally {
      setLoading(false)
    }
  }, [brand, tenantId])

  useEffect(() => {
    loadTemplates()
  }, [loadTemplates])

  function resetForm() {
    setForm(EMPTY_TEMPLATE)
    setEditingId(null)
  }

  async function saveTemplate() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        ...form,
        brand,
        tenantId,
        variables: (form.variables || []).filter(Boolean),
        tags: (form.tags || []).filter(Boolean),
      }

      const res = await fetch('/api/outreach-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to save template')
      }

      resetForm()
      await loadTemplates()
    } catch (err: any) {
      setError(err?.message || 'Failed to save template')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(template: Template) {
    setEditingId(template.id)
    setForm({
      name: template.name,
      channel: template.channel,
      industry: template.industry,
      subject: template.subject || '',
      body: template.body,
      variables: template.variables || [],
      tags: template.tags || [],
    })
  }

  async function deleteTemplate(template: Template) {
    const confirmed = window.confirm(`Delete template "${template.name}"?`)
    if (!confirmed) return

    // Note: backend currently lacks DELETE for templates; leaving a soft-disable
    // placeholder here until that endpoint exists.
    setError('Template deletion is not implemented yet.')
  }

  return (
    <Container size="md" py="xl">
      <Stack gap="md">
        <Group justify="space-between">
          <div>
            <Title order={2}>Outreach Templates</Title>
            <Text size="sm" c="dimmed">
              Manage brand-specific templates for <Text span fw={700}>{BRAND_CONFIG[brand].label}</Text>.
              Templates are filtered by county and channel.
            </Text>
          </div>
          <Button leftSection={<IconPlus size={16} />} onClick={resetForm} variant="light">
            New Template
          </Button>
        </Group>

        <Paper withBorder p="md" radius="md">
          <Stack gap="sm">
            <Group grow>
              <TextInput
                label="Template name"
                value={form.name}
                onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, name: v })); }}
                placeholder="Academy intro email"
              />
              <Select
                label="Channel"
                value={form.channel}
                onChange={(v) => setForm((f) => ({ ...f, channel: (v as Template['channel']) || 'email' }))}
                data={[
                  { value: 'email', label: 'Email' },
                  { value: 'linkedin', label: 'LinkedIn' },
                ]}
              />
            </Group>

            <TextInput
              label="Industry"
              value={form.industry}
              onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, industry: v })); }}
              placeholder="Academy, Federation, Club"
            />

            {/* No native GDS tag/chip input primitive exists (issue #64) — Mantine
                TagsInput, already a transitive dependency, used directly as the
                underlying building block, matching this repo's established
                Mantine-composed-under-GDS pattern. */}
            <TagsInput
              label="Tags"
              placeholder="persona, deal-stage, competitor-mention"
              value={form.tags || []}
              onChange={(value) => setForm((f) => ({ ...f, tags: value }))}
              description="Press Enter or comma to add a tag"
              clearable
              renderPill={({ option, onRemove, disabled }) => (
                <Pill
                  withRemoveButton
                  onRemove={onRemove}
                  disabled={disabled}
                  removeButtonProps={{ 'aria-label': `Remove tag ${option.value}` }}
                >
                  {option.value}
                </Pill>
              )}
            />

            {form.channel === 'email' && (
              <TextInput
                label="Subject"
                value={form.subject}
                onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, subject: v })); }}
                placeholder="Cognitive performance for {entity_name}"
              />
            )}

            <Textarea
              label="Body"
              value={form.body}
              onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, body: v })); }}
              minRows={5}
              placeholder="Hi {contact_name}, ..."
            />

            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                Variables: {form.variables?.length ? form.variables.join(', ') : 'none'}
              </Text>
              <Group gap="xs">
                <Button variant="light" onClick={resetForm} disabled={saving}>
                  Reset
                </Button>
                <Button onClick={saveTemplate} loading={saving} disabled={!form.name || !form.body}>
                  {editingId ? 'Update' : 'Create'} Template
                </Button>
              </Group>
            </Group>

            {error && <Text c="red" size="sm">{error}</Text>}
          </Stack>
        </Paper>

        {loading ? (
          <Group justify="center" py="xl">
            <Loader />
          </Group>
        ) : (
          <Stack gap="sm">
            {templates.map((template) => (
              <Paper key={template.id} withBorder p="md" radius="md">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Group gap="xs">
                      <Text fw={600}>{template.name}</Text>
                      <Text size="xs" c="dimmed">
                        {template.channel} · {template.industry || 'General'}
                      </Text>
                    </Group>
                    {template.subject && (
                      <Text size="sm" c="dimmed">Subject: {template.subject}</Text>
                    )}
                    {template.tags && template.tags.length > 0 && (
                      <Group gap={4}>
                        {template.tags.map((tag) => (
                          <Badge key={tag} variant="light" size="xs" color="gray">{tag}</Badge>
                        ))}
                      </Group>
                    )}
                    <Text size="sm" lineClamp={3}>
                      {template.body}
                    </Text>
                  </Stack>
                  <Group gap="xs">
                    <Button size="xs" variant="light" onClick={() => startEdit(template)}>
                      Edit
                    </Button>
                    <Button size="xs" color="red" variant="light" onClick={() => deleteTemplate(template)}>
                      <IconTrash size={14} />
                    </Button>
                  </Group>
                </Group>
              </Paper>
            ))}

            {!templates.length && (
              <Text c="dimmed" size="sm">
                No templates yet. Create your first brand-specific template above.
              </Text>
            )}
          </Stack>
        )}
      </Stack>
    </Container>
  )
}
