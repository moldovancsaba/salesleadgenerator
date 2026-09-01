'use client'

import { useEffect, useState } from 'react'
import {
  Container, Title, Text, Button, Group, Stack, Textarea,
  Paper, Loader, Divider, Tabs, Alert, TextInput, Switch,
} from '@mantine/core'
import { IconCheck } from '@tabler/icons-react'
import type { Brand } from '@/app/lib/brand'

export function PromptEditorClient({ brand, label }: { brand: Brand; label: string }) {
  const [tenantId, setTenantId] = useState<string>(brand)
  const [activeTab, setActiveTab] = useState<string | null>('discovery')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [discEnabled, setDiscEnabled] = useState(true)
  const [enrEnabled, setEnrEnabled] = useState(true)
  const [discoveryContent, setDiscoveryContent] = useState('')
  const [enrichmentContent, setEnrichmentContent] = useState('')
  const [discoverySource, setDiscoverySource] = useState('')
  const [enrichmentSource, setEnrichmentSource] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [discRes, enrRes] = await Promise.all([
          fetch(`/api/prompts?brand=${brand}&tenantId=${encodeURIComponent(tenantId)}&type=discovery`),
          fetch(`/api/prompts?brand=${brand}&tenantId=${encodeURIComponent(tenantId)}&type=enrichment`),
        ])

        if (discRes.ok) {
          const discData = await discRes.json()
          if (!cancelled) {
            setDiscoveryContent(discData.prompt?.content || '')
            setDiscoverySource(discData.source || 'unknown')
          }
        }
        if (enrRes.ok) {
          const enrData = await enrRes.json()
          if (!cancelled) {
            setEnrichmentContent(enrData.prompt?.content || '')
            setEnrichmentSource(enrData.source || 'unknown')
          }
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Failed to load prompts')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [brand, tenantId])

  async function savePrompt(type: 'discovery' | 'enrichment', content: string) {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const res = await fetch('/api/prompts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, tenantId, type, content }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to save prompt')
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err: any) {
      setError(err?.message || 'Failed to save prompt')
    } finally {
      setSaving(false)
    }
  }

  async function toggleOperation(type: 'discovery' | 'enrichment', enabled: boolean) {
    try {
      const res = await fetch('/api/admin/toggle', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, tenantId, operation: type, enabled }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || 'Failed to update toggle')
      }
    } catch (err: any) {
      setError(err?.message || 'Failed to update toggle')
      // Revert the switch on error
      if (type === 'discovery') setDiscEnabled(!enabled)
      else setEnrEnabled(!enabled)
    }
  }

  if (loading) {
    return (
      <Container size="lg" py="xl">
        <Loader />
      </Container>
    )
  }

  return (
    <Container size="lg" py="xl">
      <Stack gap="md">
        <Title order={2}>Prompt Editor — {label}</Title>

        <Group gap="sm">
          <Text size="sm" c="dimmed">Tenant ID:</Text>
          <TextInput
            size="sm"
            value={tenantId}
            onChange={(e) => setTenantId(e.currentTarget.value)}
            style={{ maxWidth: 200 }}
          />
        </Group>

        {error && (
          <Alert color="red" title="Error">{error}</Alert>
        )}

        {saved && (
          <Alert color="green" title="Saved">Prompt saved.</Alert>
        )}

        <Tabs value={activeTab} onChange={setActiveTab}>
          <Tabs.List>
            <Tabs.Tab value="discovery">Discovery</Tabs.Tab>
            <Tabs.Tab value="enrichment">Enrichment</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="discovery" pt="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text size="sm" c="dimmed">Source: {discoverySource}</Text>
                <Group gap="xs">
                  <Switch
                    checked={discEnabled}
                    onChange={(e) => {
                      const val = e.currentTarget.checked
                      setDiscEnabled(val)
                      toggleOperation('discovery', val)
                    }}
                    size="sm"
                    label="Enabled"
                  />
                  <Button
                    size="sm"
                    onClick={() => savePrompt('discovery', discoveryContent)}
                    loading={saving}
                  >
                    Save Discovery
                  </Button>
                </Group>
              </Group>
              <Textarea
                value={discoveryContent}
                onChange={(e) => setDiscoveryContent(e.currentTarget.value)}
                minRows={20}
                maxRows={60}
                placeholder="Discovery prompt for this tenant..."
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
            </Stack>
          </Tabs.Panel>

          <Tabs.Panel value="enrichment" pt="md">
            <Stack gap="sm">
              <Group justify="space-between" align="center">
                <Text size="sm" c="dimmed">Source: {enrichmentSource}</Text>
                <Group gap="xs">
                  <Switch
                    checked={enrEnabled}
                    onChange={(e) => {
                      const val = e.currentTarget.checked
                      setEnrEnabled(val)
                      toggleOperation('enrichment', val)
                    }}
                    size="sm"
                    label="Enabled"
                  />
                  <Button
                    size="sm"
                    onClick={() => savePrompt('enrichment', enrichmentContent)}
                    loading={saving}
                  >
                    Save Enrichment
                  </Button>
                </Group>
              </Group>
              <Textarea
                value={enrichmentContent}
                onChange={(e) => setEnrichmentContent(e.currentTarget.value)}
                minRows={20}
                maxRows={60}
                placeholder="Enrichment prompt for this tenant..."
                style={{ fontFamily: 'monospace', fontSize: 13 }}
              />
            </Stack>
          </Tabs.Panel>
        </Tabs>
      </Stack>
    </Container>
  )
}
