'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Modal,
  Stack,
  Group,
  Title,
  Text,
  Button,
  TextInput,
  Select,
  Paper,
  Table,
  Checkbox,
  Divider,
  Loader,
  ScrollArea,
} from '@mantine/core';
import { StatusBadge, LabelTag, CountBadge, InlineAlert } from '@sovereignsquad/gds-core/client';
import { IconSearch, IconPlugConnected, IconDownload, IconCheck, IconRefresh } from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';
import type { ApolloEntitlementCheck, MappedApolloCandidate } from '@/lib/apollo-import';

type Props = {
  opened: boolean;
  onClose: () => void;
  brand: string;
  tenantId?: string;
  onImported: () => void;
};

export function ApolloImportModal({
  opened,
  onClose,
  brand,
  tenantId = 'default',
  onImported,
}: Props) {
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [connected, setConnected] = useState(false);
  const [accountLabel, setAccountLabel] = useState<string>('');
  const [entitlements, setEntitlements] = useState<ApolloEntitlementCheck | null>(null);
  const [prerequisites, setPrerequisites] = useState<string[]>([]);

  const [apiKeyInput, setApiKeyInput] = useState('');
  const [connectingKey, setConnectingKey] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const [searchMode, setSearchMode] = useState<'saved_contacts' | 'global_search'>('saved_contacts');
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<MappedApolloCandidate[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dedupPolicy, setDedupPolicy] = useState<'update' | 'skip'>('update');
  const [importing, setImporting] = useState(false);

  const loadStatusAndEntitlements = useCallback(async (verifyLive = true) => {
    setLoadingStatus(true);
    try {
      const res = await fetch(
        `/api/integrations/apollo/status?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}${verifyLive ? '&verify=1' : ''}`
      );
      const data = await res.json().catch(() => ({}));
      if (Array.isArray(data.prerequisites)) {
        setPrerequisites(data.prerequisites);
      }
      if (res.ok && data.connected) {
        setConnected(true);
        setAccountLabel(data.providerAccountLabel || 'Apollo Workspace');
        if (data.entitlements) {
          setEntitlements(data.entitlements);
          if (data.entitlements.recommendedMode === 'global_search') {
            setSearchMode('global_search');
          } else {
            setSearchMode('saved_contacts');
          }
        }
      } else {
        setConnected(false);
        setEntitlements(null);
      }
    } catch {
      setConnected(false);
    } finally {
      setLoadingStatus(false);
    }
  }, [brand, tenantId]);

  useEffect(() => {
    if (opened) {
      void loadStatusAndEntitlements(true);
    }
  }, [opened, loadStatusAndEntitlements]);

  async function handleConnectKey() {
    if (!apiKeyInput.trim()) return;
    setConnectingKey(true);
    setConnectError(null);
    try {
      const res = await fetch('/api/integrations/apollo/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          tenantId,
          apiKey: apiKeyInput.trim(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to verify Apollo API key');
      }
      setApiKeyInput('');
      showNotification({
        title: 'Apollo Connected',
        message: 'Apollo API key verified and saved. Checking endpoint entitlements…',
        color: 'teal',
      });
      await loadStatusAndEntitlements(true);
    } catch (err: any) {
      setConnectError(err?.message || 'Failed to verify Apollo API key');
    } finally {
      setConnectingKey(false);
    }
  }

  async function handleSearch() {
    setSearching(true);
    setSearchError(null);
    try {
      const res = await fetch('/api/integrations/apollo/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          tenantId,
          mode: searchMode,
          query: query.trim(),
          page: 1,
          perPage: 25,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || `Apollo search failed (${res.status})`);
      }
      const list: MappedApolloCandidate[] = Array.isArray(data.candidates) ? data.candidates : [];
      setCandidates(list);
      setTotalEntries(typeof data.totalEntries === 'number' ? data.totalEntries : list.length);
      setSelectedIds(new Set(list.map((c) => c.apolloPersonId)));
    } catch (err: any) {
      setSearchError(err?.message || 'Apollo search failed');
      setCandidates([]);
    } finally {
      setSearching(false);
    }
  }

  async function handleImportSelected() {
    const chosen = candidates.filter((c) => selectedIds.has(c.apolloPersonId));
    if (chosen.length === 0) return;

    setImporting(true);
    try {
      const res = await fetch('/api/integrations/apollo/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brand,
          tenantId,
          candidates: chosen,
          deduplicationPolicy: dedupPolicy,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Apollo import failed');
      }
      showNotification({
        title: 'Apollo Capture Complete',
        message: `Processed ${data.total} selected contact(s): ${data.created} created, ${data.updated} enriched, ${data.skipped} skipped (deduplicated).`,
        color: 'teal',
        icon: <IconCheck size={16} />,
        autoClose: 6000,
      });
      onImported();
      onClose();
    } catch (err: any) {
      showNotification({
        title: 'Apollo Import Error',
        message: err?.message || 'Failed to import selected contacts',
        color: 'red',
      });
    } finally {
      setImporting(false);
    }
  }

  function toggleOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === candidates.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(candidates.map((c) => c.apolloPersonId)));
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs" align="center">
          <IconPlugConnected size={20} color="var(--mantine-color-indigo-6)" />
          <Title order={4}>Apollo.io Contact & Lead Capture</Title>
        </Group>
      }
      size="xl"
      centered
    >
      <Stack gap="md">
        {loadingStatus ? (
          <Group justify="center" py="lg">
            <Loader size="sm" />
            <Text size="sm" c="dimmed">Verifying Apollo connection and endpoint entitlements…</Text>
          </Group>
        ) : !connected ? (
          <Paper withBorder p="md" radius="md">
            <Stack gap="sm">
              <Text fw={600} size="sm">Connect Workspace Apollo API Key</Text>
              <Text size="xs" c="dimmed">
                Generate an API key in Apollo (Settings → Integrations → API → API Keys) and paste it below.
                Sales Haho verifies account health and endpoint entitlements before storing it encrypted.
              </Text>
              <Group align="flex-end" gap="xs">
                <TextInput
                  label="Apollo API Key (x-api-key)"
                  type="password"
                  placeholder="Paste Apollo API key…"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.currentTarget.value)}
                  style={{ flex: 1 }}
                />
                <Button
                  loading={connectingKey}
                  disabled={!apiKeyInput.trim()}
                  onClick={handleConnectKey}
                >
                  Verify & Connect
                </Button>
              </Group>
              {connectError && (
                <Text size="xs" c="red" role="alert">{connectError}</Text>
              )}
              {prerequisites.length > 0 && (
                <Stack gap={2} mt="xs">
                  <Text size="xs" fw={600} c="dimmed">Provider Prerequisites:</Text>
                  {prerequisites.map((p, idx) => (
                    <Text key={idx} size="xs" c="dimmed">• {p}</Text>
                  ))}
                </Stack>
              )}
            </Stack>
          </Paper>
        ) : (
          <>
            <Paper withBorder p="sm" radius="md">
              <Stack gap="xs">
                <Group justify="space-between" align="center" wrap="wrap">
                  <Group gap="xs">
                    <StatusBadge status="success" size="xs">Connected: {accountLabel}</StatusBadge>
                    {entitlements && (
                      <LabelTag
                        size="xs"
                        tone={
                          entitlements.goDecision === 'go_api'
                            ? 'success'
                            : entitlements.goDecision === 'go_saved_contacts_only'
                            ? 'info'
                            : 'warning'
                        }
                        label={
                          entitlements.goDecision === 'go_api'
                            ? 'Go: Full API Search'
                            : entitlements.goDecision === 'go_saved_contacts_only'
                            ? 'Go: Saved Contacts API'
                            : 'Plan Restricted: Use Apollo CSV'
                        }
                      />
                    )}
                  </Group>
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    leftSection={<IconRefresh size={12} />}
                    onClick={() => void loadStatusAndEntitlements(true)}
                  >
                    Re-check Entitlements
                  </Button>
                </Group>

                {entitlements && (
                  <>
                    <Group gap="xs" wrap="wrap">
                      <StatusBadge size="xs" status={entitlements.healthy && entitlements.isLoggedIn ? 'success' : 'danger'}>
                        Auth Health: {entitlements.healthy && entitlements.isLoggedIn ? 'OK' : 'Failed'}
                      </StatusBadge>
                      <StatusBadge size="xs" status={entitlements.savedContactsAllowed ? 'success' : 'warning'}>
                        Saved Contacts: {entitlements.savedContactsAllowed ? 'Permitted' : 'Restricted'}
                      </StatusBadge>
                      <StatusBadge size="xs" status={entitlements.globalSearchAllowed ? 'success' : 'neutral'}>
                        Global Prospect Search: {entitlements.globalSearchAllowed ? 'Permitted' : 'Master Key / Plan Required'}
                      </StatusBadge>
                    </Group>
                    <Text size="xs" c="dimmed">{entitlements.diagnosticSummary}</Text>
                  </>
                )}
              </Stack>
            </Paper>

            <Group align="flex-end" gap="xs" wrap="wrap">
              <Select
                size="xs"
                label="Apollo Endpoint"
                w={210}
                value={searchMode}
                onChange={(val) => setSearchMode(val === 'global_search' ? 'global_search' : 'saved_contacts')}
                data={[
                  { value: 'saved_contacts', label: 'Saved CRM Contacts' },
                  {
                    value: 'global_search',
                    label: entitlements?.globalSearchAllowed === false
                      ? 'Global Search (Restricted)'
                      : 'Global Prospect Search',
                  },
                ]}
              />
              <TextInput
                size="xs"
                label="Search Keywords"
                placeholder="Name, title, company, or industry (leave blank to list recent)…"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSearch();
                }}
                leftSection={<IconSearch size={14} />}
                style={{ flex: 1, minWidth: 220 }}
              />
              <Button
                size="xs"
                loading={searching}
                onClick={handleSearch}
                disabled={entitlements?.goDecision === 'no_go_api_use_csv'}
              >
                Search Apollo
              </Button>
            </Group>

            {searchError && (
              <InlineAlert severity="warning" title="Apollo Lookup Notice" message={searchError} />
            )}

            {candidates.length > 0 && (
              <Stack gap="xs">
                <Group justify="space-between" align="center" wrap="wrap">
                  <Group gap="xs">
                    <Text size="sm" fw={600}>Apollo Candidates</Text>
                    <CountBadge value={totalEntries} cap={Number.MAX_SAFE_INTEGER} size="sm" srLabel="Total Apollo results" />
                    <Text size="xs" c="dimmed">({selectedIds.size} selected)</Text>
                  </Group>
                  <Select
                    size="xs"
                    w={230}
                    aria-label="Deduplication mode"
                    value={dedupPolicy}
                    onChange={(val) => setDedupPolicy(val === 'skip' ? 'skip' : 'update')}
                    data={[
                      { value: 'update', label: 'Enrich existing & skip exact repeats' },
                      { value: 'skip', label: 'Skip any existing company/contact' },
                    ]}
                  />
                </Group>

                <ScrollArea.Autosize mah={280}>
                  <Table striped highlightOnHover withTableBorder withColumnBorders style={{ fontSize: '0.75rem' }}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th w={36}>
                          <Checkbox
                            size="xs"
                            aria-label="Select all Apollo candidates"
                            checked={candidates.length > 0 && selectedIds.size === candidates.length}
                            indeterminate={selectedIds.size > 0 && selectedIds.size < candidates.length}
                            onChange={toggleAll}
                          />
                        </Table.Th>
                        <Table.Th>Person</Table.Th>
                        <Table.Th>Company & Country</Table.Th>
                        <Table.Th>Title & Dept</Table.Th>
                        <Table.Th>Email & Phone</Table.Th>
                        <Table.Th>Field Coverage</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {candidates.map((c) => (
                        <Table.Tr key={c.apolloPersonId}>
                          <Table.Td>
                            <Checkbox
                              size="xs"
                              aria-label={`Select ${c.name || 'contact'}`}
                              checked={selectedIds.has(c.apolloPersonId)}
                              onChange={() => toggleOne(c.apolloPersonId)}
                            />
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" fw={600}>{c.name || '—'}</Text>
                            <Text size="10px" c="dimmed">
                              {c.firstName || '—'} · {c.lastName || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs" fw={500}>{c.companyName || '—'}</Text>
                            <Text size="10px" c="dimmed">
                              {c.country || '—'} · {c.industry || '—'}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs">{c.title || '—'}</Text>
                            <Text size="10px" c="dimmed">{c.department}</Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="xs">{c.email || '—'}</Text>
                            <Text size="10px" c="dimmed">{c.phone || '—'}</Text>
                          </Table.Td>
                          <Table.Td>
                            {c.missingFields.length === 0 ? (
                              <StatusBadge size="xs" status="success">Complete (13/13)</StatusBadge>
                            ) : (
                              <Text size="10px" c="dimmed">
                                Missing: {c.missingFields.slice(0, 4).join(', ')}
                                {c.missingFields.length > 4 ? ` +${c.missingFields.length - 4}` : ''}
                              </Text>
                            )}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ScrollArea.Autosize>
              </Stack>
            )}

            <Divider />

            <Group justify="space-between" align="center">
              <Text size="xs" c="dimmed">
                Imported records carry <code>source: apollo</code> and deduplicate on repeat.
              </Text>
              <Group gap="xs">
                <Button variant="subtle" color="gray" onClick={onClose} disabled={importing}>
                  Cancel
                </Button>
                <Button
                  leftSection={<IconDownload size={14} />}
                  loading={importing}
                  disabled={selectedIds.size === 0}
                  onClick={handleImportSelected}
                >
                  Import {selectedIds.size} Selected
                </Button>
              </Group>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
