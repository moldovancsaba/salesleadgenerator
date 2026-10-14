'use client'

import { useCallback, useEffect, useState } from 'react'
import { Box, Title, Text, Stack, Group, Badge, Select } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState } from '@sovereignsquad/gds-admin/client'
import { useAuth } from '@/app/components/AuthProvider'

type UserRow = {
  ssoUserId: string
  email: string
  name?: string
  orgAccess: Record<string, 'admin' | 'user'>
  isSuperAdmin: boolean
  accessibleBrands: string[]
  createdAt: string
  updatedAt: string
}

const ROLE_OPTIONS = [
  { value: '', label: 'No access' },
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
]

export function AdminUsersClient() {
  // Issue #195 — every configured brand's key/label, sourced from the
  // Mongo-backed brand registry via the same auth-session fetch AppNav
  // already relies on, instead of a module-scope BRAND_CONFIG import that
  // would go stale the instant a brand is added through /admin/clients
  // (issue #196) without a page reload.
  const { brandLabels } = useAuth()
  const brandKeys = Object.keys(brandLabels)
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // `${userId}:${brand}` of the one cell currently saving — scoped per cell
  // so editing one user's access doesn't disable every Select on the page.
  const [savingKey, setSavingKey] = useState<string | null>(null)

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

  return (
    <Box px={{ base: 'sm', sm: 'md', md: 'lg' }} py="md" w="100%" style={{ flex: 1, minWidth: 0 }}>
      <Stack gap="md">
        {/* Compact Application Header matching Contacts reference */}
        <Group justify="space-between" align="center" wrap="wrap" gap="sm">
          <div>
            <Group gap="xs" align="center">
              <Title order={2} style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>Admin — Users &amp; Organization Access</Title>
              <Badge variant="light" color="indigo" size="md">
                {users.length} {users.length === 1 ? 'user' : 'users'}
              </Badge>
            </Group>
            <Text size="xs" c="dimmed" mt={2}>
              Every person who has signed in via SSO and their organization access grants.
            </Text>
          </div>
        </Group>

        {error && <AdminFormStatus state="error" title="Something went wrong" description={error} />}

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
            caption="Users and their organization access"
            columns={[
              {
                key: 'user',
                header: 'User',
                rowHeader: true,
                width: 280,
                accessor: (row) => (
                  <Stack gap={0}>
                    <Text fw={600} size="sm">{row.name || row.email}</Text>
                    <Text size="xs" c="dimmed">{row.email}</Text>
                  </Stack>
                ),
              },
              {
                key: 'superAdmin',
                header: 'Super Admin',
                width: 140,
                accessor: (row) => (row.isSuperAdmin ? <Badge color="grape" variant="light">Super Admin</Badge> : '—'),
              },
              ...brandKeys.map((brandKey) => ({
                key: brandKey,
                header: brandLabels[brandKey],
                width: 180,
                accessor: (row: UserRow) => (
                  <Select
                    size="xs"
                    data={ROLE_OPTIONS}
                    value={row.isSuperAdmin ? 'admin' : (row.orgAccess?.[brandKey] || '')}
                    onChange={(value) => updateAccess(row.ssoUserId, brandKey, value || '')}
                    disabled={row.isSuperAdmin || savingKey === `${row.ssoUserId}:${brandKey}`}
                    style={{ width: 140 }}
                    aria-label={`${row.email}'s access to ${brandLabels[brandKey]}`}
                  />
                ),
              })),
            ]}
            getRowKey={(row) => row.ssoUserId}
          />
        )}
      </Stack>
    </Box>
  )
}
