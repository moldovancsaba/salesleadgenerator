'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Container, Title, Text, Stack, Group, Button, TextInput, MultiSelect, Select, Paper } from '@mantine/core'
import { AdminDataTable, AdminFormStatus, AdminResourceEmptyState } from '@sovereignsquad/gds-admin/client'
import { IconPlus, IconTrash } from '@tabler/icons-react'
import { useAuth } from '@/app/components/AuthProvider'

type TeamRow = {
  _id: string
  brand: string
  name: string
  memberIds: string[]
  managerIds: string[]
  createdAt: string
  updatedAt: string
}

type UserOption = {
  ssoUserId: string
  email: string
  name?: string
  accessibleBrands: string[]
}

// Team visibility (issue: CRM Team visibility) — mirrors admin-users-client.tsx's
// established structure (load/error/loading/empty states, per-cell saving key
// scoped so editing one row never disables controls on another) rather than
// inventing a new admin-page pattern.
export function AdminTeamsClient() {
  const { brandLabels } = useAuth()
  const brandKeys = Object.keys(brandLabels)
  const [brand, setBrand] = useState<string>('')
  const [teams, setTeams] = useState<TeamRow[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [newTeamName, setNewTeamName] = useState('')
  const [creating, setCreating] = useState(false)
  // `${teamId}:${field}` of the one cell currently saving — same convention
  // as admin-users-client.tsx's savingKey.
  const [savingKey, setSavingKey] = useState<string | null>(null)

  useEffect(() => {
    if (!brand && brandKeys.length > 0) setBrand(brandKeys[0])
  }, [brand, brandKeys])

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/users')
      if (!res.ok) return
      const data = await res.json()
      setUsers(data.users || [])
    } catch {
      // Non-fatal — the member/manager pickers just show no options; the
      // team list itself still loads and renders.
    }
  }, [])

  const loadTeams = useCallback(async (forBrand: string) => {
    if (!forBrand) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/teams?brand=${encodeURIComponent(forBrand)}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to load teams (${res.status})`)
      }
      const data = await res.json()
      setTeams(data.teams || [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load teams')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])
  useEffect(() => { if (brand) loadTeams(brand) }, [brand, loadTeams])

  const userOptions = useMemo(
    () => users
      .filter((u) => u.accessibleBrands?.includes(brand))
      .map((u) => ({ value: u.ssoUserId, label: u.name ? `${u.name} (${u.email})` : u.email })),
    [users, brand]
  )

  async function createTeam() {
    const name = newTeamName.trim()
    if (!name || !brand) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand, name }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to create team (${res.status})`)
      }
      setNewTeamName('')
      await loadTeams(brand)
    } catch (err: any) {
      setError(err?.message || 'Failed to create team')
    } finally {
      setCreating(false)
    }
  }

  async function updateTeamField(teamId: string, field: 'memberIds' | 'managerIds', value: string[]) {
    const key = `${teamId}:${field}`
    setSavingKey(key)
    setError(null)
    try {
      const res = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to update team (${res.status})`)
      }
      await loadTeams(brand)
    } catch (err: any) {
      setError(err?.message || 'Failed to update team')
    } finally {
      setSavingKey(null)
    }
  }

  async function deleteTeam(teamId: string, name: string) {
    // Deleting a team instantly narrows its managers' "My Team" visibility
    // back to just their own leads — an explicit confirm step, matching this
    // codebase's established window.confirm convention for every other
    // destructive action (see issue: CRM Lead ownership's handleAssign in
    // app/detail.tsx, CadencePanel.tsx, battlecards/templates/cadences).
    const confirmed = window.confirm(`Delete team "${name}"? Its managers will lose visibility into its members' leads immediately.`)
    if (!confirmed) return
    const key = `${teamId}:delete`
    setSavingKey(key)
    setError(null)
    try {
      const res = await fetch(`/api/admin/teams/${encodeURIComponent(teamId)}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 204) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Failed to delete team (${res.status})`)
      }
      await loadTeams(brand)
    } catch (err: any) {
      setError(err?.message || 'Failed to delete team')
    } finally {
      setSavingKey(null)
    }
  }

  return (
    <Container size="lg" py="xl">
      <Stack gap="md">
        <div>
          <Title order={2}>Admin — Teams</Title>
          <Text size="sm" c="dimmed">
            Group users within a brand and designate managers — a manager sees, via the &quot;My Team&quot; pipeline
            scope, the leads assigned to themselves and to every current member of a team they manage.
            Team membership is separate from brand access (Users &amp; Access); a team never spans brands.
          </Text>
        </div>

        <Select
          label="Brand"
          data={brandKeys.map((k) => ({ value: k, label: brandLabels[k] }))}
          value={brand || null}
          onChange={(v) => v && setBrand(v)}
          aria-label="Select brand to manage teams for"
          style={{ maxWidth: 280 }}
        />

        {error && <AdminFormStatus state="error" title="Something went wrong" description={error} />}

        <Paper withBorder p="md">
          <Group align="flex-end" gap="xs">
            <TextInput
              label="New team name"
              placeholder="e.g. EMEA Sales"
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.currentTarget.value)}
              aria-label="New team name"
              style={{ flex: 1 }}
            />
            <Button leftSection={<IconPlus size={14} />} onClick={createTeam} loading={creating} disabled={!newTeamName.trim()}>
              Add team
            </Button>
          </Group>
        </Paper>

        {loading ? (
          <AdminFormStatus state="loading" title="Loading teams" />
        ) : teams.length === 0 ? (
          <AdminResourceEmptyState
            title="No teams yet for this brand"
            description="Create a team above, then add members and a manager."
          />
        ) : (
          <AdminDataTable<TeamRow>
            rows={teams}
            caption={`Teams for ${brandLabels[brand] || brand}`}
            columns={[
              { key: 'name', header: 'Team', rowHeader: true, accessor: (row) => <Text fw={600} size="sm">{row.name}</Text> },
              {
                key: 'members',
                header: 'Members',
                accessor: (row) => (
                  <MultiSelect
                    size="xs"
                    data={userOptions}
                    value={row.memberIds}
                    onChange={(value) => updateTeamField(row._id, 'memberIds', value)}
                    disabled={savingKey === `${row._id}:memberIds`}
                    placeholder="Add members"
                    aria-label={`${row.name}'s members`}
                    searchable
                  />
                ),
              },
              {
                key: 'managers',
                header: 'Managers',
                accessor: (row) => (
                  <MultiSelect
                    size="xs"
                    data={userOptions}
                    value={row.managerIds}
                    onChange={(value) => updateTeamField(row._id, 'managerIds', value)}
                    disabled={savingKey === `${row._id}:managerIds`}
                    placeholder="Add managers"
                    aria-label={`${row.name}'s managers`}
                    searchable
                  />
                ),
              },
              {
                key: 'actions',
                header: '',
                accessor: (row) => (
                  <Button
                    size="xs"
                    color="red"
                    variant="light"
                    leftSection={<IconTrash size={14} />}
                    onClick={() => deleteTeam(row._id, row.name)}
                    loading={savingKey === `${row._id}:delete`}
                    aria-label={`Delete team ${row.name}`}
                  >
                    Delete
                  </Button>
                ),
              },
            ]}
            getRowKey={(row) => row._id}
          />
        )}
      </Stack>
    </Container>
  )
}
