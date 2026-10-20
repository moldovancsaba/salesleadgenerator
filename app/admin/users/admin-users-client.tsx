'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Box, Title, Text, Stack, Group, Select, Button, Modal, TextInput,
  Paper, Switch, Divider, ActionIcon,
} from '@mantine/core'
import { CountBadge, LabelTag, StatusBadge, InlineAlert } from '@sovereignsquad/gds-core/client'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState } from '@sovereignsquad/gds-admin/client'
import { IconMail, IconPlus, IconTrash, IconShieldCheck, IconSettings } from '@tabler/icons-react'
import { useAuth } from '@/app/components/AuthProvider'

type UserRow = {
  ssoUserId: string
  email: string
  name?: string
  orgAccess: Record<string, 'admin' | 'user'>
  isSuperAdmin: boolean
  accessibleBrands: string[]
  aliases?: string[]
  createdAt: string
  updatedAt: string
}

const ROLE_OPTIONS = [
  { value: '', label: 'No access' },
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
]

export function AdminUsersClient() {
  const { brandLabels } = useAuth()
  const brandKeys = Object.keys(brandLabels)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)

  // Alias modal state
  const [selectedUserForAliases, setSelectedUserForAliases] = useState<UserRow | null>(null)
  const [aliasModalOpened, setAliasModalOpened] = useState(false)
  const [aliasesEditing, setAliasesEditing] = useState<string[]>([])
  const [newAliasInput, setNewAliasInput] = useState('')
  const [savingAliases, setSavingAliases] = useState(false)
  const [aliasError, setAliasError] = useState<string | null>(null)

  // Inbox Scoping Policy state
  const [policyBrand, setPolicyBrand] = useState<string>(brandKeys[0] || 'seyu')
  const [includeAssignedLeadThreads, setIncludeAssignedLeadThreads] = useState(false)
  const [loadingPolicy, setLoadingPolicy] = useState(false)
  const [savingPolicy, setSavingPolicy] = useState(false)
  const [policyNotice, setPolicyNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/users')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load users (${res.status})`)
      }
      const data = await res.json()
      setUsers(data.users || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Load Inbox Policy for selected brand
  const loadPolicy = useCallback(async (brand: string) => {
    if (!brand) return
    setLoadingPolicy(true)
    setPolicyNotice(null)
    try {
      const res = await fetch(`/api/admin/inbox-settings?brand=${encodeURIComponent(brand)}`)
      if (res.ok) {
        const data = await res.json()
        setIncludeAssignedLeadThreads(Boolean(data.includeAssignedLeadThreads))
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingPolicy(false)
    }
  }, [])

  useEffect(() => {
    if (policyBrand) {
      loadPolicy(policyBrand)
    }
  }, [policyBrand, loadPolicy])

  const handleTogglePolicy = async (checked: boolean) => {
    setSavingPolicy(true)
    setPolicyNotice(null)
    try {
      const res = await fetch('/api/admin/inbox-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: policyBrand, includeAssignedLeadThreads: checked }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to update policy')
      }
      setIncludeAssignedLeadThreads(checked)
      setPolicyNotice(
        checked
          ? 'Policy updated: Reps will also see team correspondence on leads assigned to them.'
          : 'Policy updated: Strict mailbox isolation active. Reps only see emails sent or received by their own mailboxes.'
      )
    } catch (err: any) {
      setError(err?.message || 'Failed to save policy')
    } finally {
      setSavingPolicy(false)
    }
  }

  const updateAccess = useCallback(async (userId: string, brand: string, role: string) => {
    const key = `${userId}:${brand}`
    setSavingKey(key)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, role: role || null }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to update access (${res.status})`)
      }
      await load()
    } catch (err: any) {
      setError(err?.message || 'Failed to update access')
    } finally {
      setSavingKey(null)
    }
  }, [load])

  const handleOpenAliases = (user: UserRow) => {
    setSelectedUserForAliases(user)
    setAliasesEditing(user.aliases || [])
    setNewAliasInput('')
    setAliasError(null)
    setAliasModalOpened(true)
  }

  const handleAddAlias = () => {
    const trimmed = newAliasInput.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      setAliasError('Please enter a valid email address')
      return
    }
    if (trimmed === selectedUserForAliases?.email?.toLowerCase()) {
      setAliasError('This is already the primary login email')
      return
    }
    if (aliasesEditing.includes(trimmed)) {
      setAliasError('This alias is already added')
      return
    }
    setAliasesEditing([...aliasesEditing, trimmed])
    setNewAliasInput('')
    setAliasError(null)
  }

  const handleRemoveAlias = (aliasToRemove: string) => {
    setAliasesEditing(aliasesEditing.filter((a) => a !== aliasToRemove))
  }

  const handleSaveAliases = async () => {
    if (!selectedUserForAliases) return
    setSavingAliases(true)
    setAliasError(null)
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(selectedUserForAliases.ssoUserId)}/aliases`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aliases: aliasesEditing }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to save aliases')
      }
      setAliasModalOpened(false)
      await load()
    } catch (err: any) {
      setAliasError(err?.message || 'Failed to save aliases')
    } finally {
      setSavingAliases(false)
    }
  }

  return (
    <Box px={{ base: 'sm', sm: 'md', md: 'lg' }} py="md" w="100%" style={{ flex: 1, minWidth: 0 }}>
      <Stack gap="md">
        {/* Compact Application Header matching Contacts reference */}
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <div>
            <Group gap="xs" align="center">
              <Title order={2} style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Admin — Users &amp; Organization Access</Title>
              <CountBadge value={users.length} size="md" srLabel="User accounts count" />
            </Group>
            <Text size="xs" c="dimmed" mt={2}>
              Every person who has signed in via SSO, their linked mailboxes, and their organization access grants.
            </Text>
          </div>
        </Group>

        {error && <AdminFormStatus state="error" title="Something went wrong" description={error} />}

        {/* Issue 271: Communication Center Privacy & Scoping Policy */}
        <Paper withBorder p="md" radius="sm" style={{ backgroundColor: 'var(--gds-bg-card)' }}>
          <Stack gap="xs">
            <Group justify="space-between" align="center" wrap="wrap">
              <Group gap="xs">
                <IconSettings size={18} style={{ color: 'var(--mantine-color-indigo-6)' }} />
                <Text fw={600} size="sm">Communication Center &amp; Inbox Scoping Policy</Text>
              </Group>
              <Group gap="xs">
                <StatusBadge status="success" size="sm" withIcon>
                  Fail-Closed Guard: Active
                </StatusBadge>
                <Select
                  size="xs"
                  data={brandKeys.map((k) => ({ value: k, label: brandLabels[k] || k }))}
                  value={policyBrand}
                  onChange={(v) => v && setPolicyBrand(v)}
                  style={{ width: 160 }}
                  aria-label="Select brand for inbox scoping policy"
                />
              </Group>
            </Group>
            <Divider />
            <Group justify="space-between" align="flex-start" wrap="nowrap">
              <Box style={{ flex: 1 }}>
                <Text size="xs" fw={500}>Include Team Correspondence on Assigned Leads</Text>
                <Text size="xs" c="dimmed" mt={2}>
                  {includeAssignedLeadThreads
                    ? 'Active: Sales reps will see correspondence on leads assigned to them, including emails sent or received by other colleagues.'
                    : 'Strict Mailbox Only (Recommended): Sales reps strictly only see emails where their own linked mailboxes are an active participant (From, To, Cc). Other reps\' emails on assigned leads will not appear in their inbox.'}
                </Text>
              </Box>
              <Switch
                size="sm"
                checked={includeAssignedLeadThreads}
                disabled={loadingPolicy || savingPolicy}
                onChange={(e) => handleTogglePolicy(e.currentTarget.checked)}
                aria-label="Toggle include team correspondence on assigned leads"
              />
            </Group>
            {policyNotice && (
              <InlineAlert
                severity="info"
                title="Policy Updated"
                message={policyNotice}
              />
            )}
          </Stack>
        </Paper>

        {loading ? (
          <AdminFormStatus state="loading" title="Loading users" />
        ) : users.length === 0 ? (
          <AdminResourceEmptyState
            title="No users yet"
            description="Nobody has signed in via SSO yet. Once someone logs in, they'll appear here."
          />
        ) : (
          <AdminDataTable<UserRow>
            rows={users}
            caption="Users, linked mailboxes, and their organization access"
            columns={[
              {
                key: 'user',
                header: 'User',
                rowHeader: true,
                width: 250,
                accessor: (row) => (
                  <Stack gap={0}>
                    <Text fw={600} size="sm">{row.name || row.email}</Text>
                    <Text size="xs" c="dimmed">{row.email}</Text>
                  </Stack>
                ),
              },
              {
                key: 'aliases',
                header: 'Linked Mailboxes (Aliases)',
                width: 240,
                accessor: (row) => (
                  <Group gap={6} align="center">
                    {row.aliases && row.aliases.length > 0 ? (
                      <Group gap={4}>
                        {row.aliases.map((a) => (
                          <LabelTag key={a} label={a} size="xs" tone="neutral" />
                        ))}
                      </Group>
                    ) : (
                      <Text size="xs" c="dimmed">No linked aliases</Text>
                    )}
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<IconMail size={12} />}
                      onClick={() => handleOpenAliases(row)}
                    >
                      Manage
                    </Button>
                  </Group>
                ),
              },
              {
                key: 'superAdmin',
                header: 'Super Admin',
                width: 120,
                accessor: (row) => (row.isSuperAdmin ? <LabelTag tone="info" size="xs" label="Super Admin" /> : '—'),
              },
              ...brandKeys.map((brandKey) => ({
                key: brandKey,
                header: brandLabels[brandKey],
                width: 150,
                accessor: (row: UserRow) => (
                  <Select
                    size="xs"
                    data={ROLE_OPTIONS}
                    value={row.isSuperAdmin ? 'admin' : (row.orgAccess?.[brandKey] || '')}
                    onChange={(value) => updateAccess(row.ssoUserId, brandKey, value || '')}
                    disabled={row.isSuperAdmin || savingKey === `${row.ssoUserId}:${brandKey}`}
                    style={{ width: 130 }}
                    aria-label={`${row.email}'s access to ${brandLabels[brandKey]}`}
                  />
                ),
              })),
            ]}
            getRowKey={(row) => row.ssoUserId}
          />
        )}
      </Stack>

      {/* Issue 271: Manage Aliases Modal */}
      <Modal
        opened={aliasModalOpened}
        onClose={() => !savingAliases && setAliasModalOpened(false)}
        title={
          <Group gap="xs">
            <IconShieldCheck size={18} style={{ color: 'var(--mantine-color-teal-6)' }} />
            <Text fw={600} size="sm">Manage Linked Mailboxes for {selectedUserForAliases?.name || selectedUserForAliases?.email}</Text>
          </Group>
        }
        size="md"
      >
        <Stack gap="md">
          <Text size="xs" c="dimmed">
            Linked mailboxes allow this user to access synced Gmail correspondence from work accounts (e.g. Google Workspace) when logged in under their personal SSO account or vice-versa.
          </Text>

          <Paper withBorder p="xs" radius="sm">
            <Text size="xs" fw={500} c="dimmed">Primary Login Email:</Text>
            <Text size="sm" fw={600}>{selectedUserForAliases?.email}</Text>
          </Paper>

          <Stack gap="xs">
            <Text size="xs" fw={600}>Linked Email Aliases ({aliasesEditing.length}):</Text>
            {aliasesEditing.length === 0 ? (
              <Text size="xs" c="dimmed" fs="italic">No linked aliases configured.</Text>
            ) : (
              <Stack gap={6}>
                {aliasesEditing.map((alias) => (
                  <Group key={alias} justify="space-between" p="xs" style={{ border: '1px solid var(--gds-border-card)', borderRadius: 4 }}>
                    <Group gap="xs">
                      <IconMail size={16} style={{ color: 'var(--mantine-color-gray-6)' }} />
                      <Text size="xs" fw={500}>{alias}</Text>
                    </Group>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      size="sm"
                      onClick={() => handleRemoveAlias(alias)}
                      aria-label={`Remove alias ${alias}`}
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                ))}
              </Stack>
            )}
          </Stack>

          <Group align="flex-end" gap="xs">
            <TextInput
              size="xs"
              placeholder="e.g. office@seyuselfies.com"
              label="Add New Alias Email"
              value={newAliasInput}
              onChange={(e) => setNewAliasInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddAlias()
                }
              }}
              style={{ flex: 1 }}
              error={aliasError}
            />
            <Button
              size="xs"
              leftSection={<IconPlus size={14} />}
              onClick={handleAddAlias}
            >
              Add
            </Button>
          </Group>

          <Divider />

          <Group justify="flex-end" gap="xs">
            <Button
              variant="default"
              size="xs"
              onClick={() => setAliasModalOpened(false)}
              disabled={savingAliases}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              color="indigo"
              onClick={handleSaveAliases}
              loading={savingAliases}
            >
              Save Aliases
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Box>
  )
}
