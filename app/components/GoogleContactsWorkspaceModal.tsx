'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Modal,
  Stack,
  Group,
  Text,
  TextInput,
  Button,
  Badge,
  Paper,
  Loader,
  Select,
  ActionIcon,
  Tooltip,
  Box,
  Divider,
} from '@mantine/core';
import {
  IconSearch,
  IconUserPlus,
  IconCheck,
  IconX,
  IconBuilding,
  IconMail,
  IconPhone,
  IconRefresh,
} from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';

export type GoogleContact = {
  resourceName: string;
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
};

type LeadOption = {
  id: string;
  name: string;
};

type ImportState = {
  loading: boolean;
  status?: 'added' | 'created' | 'already-exists';
  leadName?: string;
  error?: string;
};

type Props = {
  opened: boolean;
  onClose: () => void;
  brand: string;
  tenantId?: string;
  onImported?: () => void;
};

export function GoogleContactsWorkspaceModal({
  opened,
  onClose,
  brand,
  tenantId = 'default',
  onImported,
}: Props) {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingLeads, setLoadingLeads] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<Record<string, string>>({});
  const [importStates, setImportStates] = useState<Record<string, ImportState>>({});
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Load available leads for target dropdown
  const loadLeads = useCallback(async () => {
    setLoadingLeads(true);
    try {
      const res = await fetch(`/api/leads?brand=${encodeURIComponent(brand)}&tenantId=${encodeURIComponent(tenantId)}&limit=200`);
      if (res.ok) {
        const data = await res.json();
        const items: LeadOption[] = (data.leads || [])
          .filter((l: any) => l._id && l.entity_name)
          .map((l: any) => ({ id: String(l._id), name: String(l.entity_name) }));
        items.sort((a, b) => a.name.localeCompare(b.name));
        setLeads(items);
      }
    } catch {
      // non-fatal
    } finally {
      setLoadingLeads(false);
    }
  }, [brand, tenantId]);

  // Search or fetch recent Google Contacts
  const loadGoogleContacts = useCallback(async (q: string) => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL('/api/integrations/google-contacts/search', window.location.origin);
      url.searchParams.set('brand', brand);
      if (q.trim()) url.searchParams.set('q', q.trim());
      const res = await fetch(url.toString());
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to fetch Google Contacts');
      }
      const data = await res.json();
      const results: GoogleContact[] = data.results || [];
      setContacts(results);
    } catch (err: any) {
      setError(err?.message || 'Failed to fetch Google Contacts');
      setContacts([]);
    } finally {
      setLoading(false);
    }
  }, [brand]);

  // Initial fetch on open
  useEffect(() => {
    if (opened) {
      setQuery('');
      setError(null);
      void loadGoogleContacts('');
      void loadLeads();
    }
  }, [opened, loadGoogleContacts, loadLeads]);

  // Debounced search
  const handleQueryChange = (val: string) => {
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void loadGoogleContacts(val);
    }, 300);
  };

  // Pre-match organization with existing lead when contacts or leads arrive
  useEffect(() => {
    if (contacts.length === 0 || leads.length === 0) return;
    setSelectedLead((prev) => {
      const next = { ...prev };
      for (const c of contacts) {
        if (!next[c.resourceName]) {
          if (c.organization) {
            const orgLower = c.organization.trim().toLowerCase();
            const matched = leads.find((l) => l.name.trim().toLowerCase() === orgLower);
            if (matched) {
              next[c.resourceName] = matched.id;
              continue;
            }
          }
          next[c.resourceName] = '__new__';
        }
      }
      return next;
    });
  }, [contacts, leads]);

  // Import single contact
  const handleImport = async (contact: GoogleContact) => {
    const choice = selectedLead[contact.resourceName] || '__new__';
    const isNew = choice === '__new__';
    const leadId = isNew ? undefined : choice;
    const targetEntityName = isNew ? (contact.organization || contact.name) : undefined;

    setImportStates((prev) => ({
      ...prev,
      [contact.resourceName]: { loading: true },
    }));

    try {
      const res = await fetch(`/api/contacts/import-google?brand=${encodeURIComponent(brand)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resourceName: contact.resourceName,
          leadId,
          entityName: targetEntityName,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Failed to import contact');
      }

      const status = data.status as 'added' | 'created' | 'already-exists';
      const leadName = data.leadName || (isNew ? targetEntityName : 'lead');

      setImportStates((prev) => ({
        ...prev,
        [contact.resourceName]: {
          loading: false,
          status,
          leadName,
        },
      }));

      const message =
        status === 'created'
          ? `Created new lead "${leadName}" with contact ${contact.name}`
          : status === 'already-exists'
          ? `${contact.name} already exists on "${leadName}"`
          : `Added ${contact.name} to "${leadName}"`;

      showNotification({
        title: status === 'already-exists' ? 'Contact Already Exists' : 'Contact Imported',
        message,
        color: status === 'already-exists' ? 'gray' : 'green',
        autoClose: 4000,
      });

      onImported?.();
    } catch (err: any) {
      setImportStates((prev) => ({
        ...prev,
        [contact.resourceName]: {
          loading: false,
          error: err?.message || 'Failed to import contact',
        },
      }));
      showNotification({
        title: 'Import Failed',
        message: err?.message || 'Could not import contact',
        color: 'red',
        autoClose: 5000,
      });
    }
  };

  const leadSelectData = [
    { value: '__new__', label: '+ Create as New Lead in DISCOVERED' },
    ...leads.map((l) => ({ value: l.id, label: l.name })),
  ];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          <Text fw={600} size="md">Import from Google Contacts</Text>
          <Badge variant="light" color="indigo" size="sm">Workspace Sync</Badge>
        </Group>
      }
      size="lg"
      radius="md"
    >
      <Stack gap="md">
        <Text size="xs" c="dimmed">
          Browse or search your connected Google Contacts. Match each contact with an existing lead or create a new lead in DISCOVERED stage.
        </Text>

        <Group gap="xs">
          <TextInput
            style={{ flex: 1 }}
            size="xs"
            placeholder="Search by contact name or email…"
            value={query}
            onChange={(e) => handleQueryChange(e.currentTarget.value)}
            leftSection={<IconSearch size={14} />}
            rightSection={
              query ? (
                <ActionIcon size="xs" variant="subtle" color="gray" onClick={() => handleQueryChange('')} aria-label="Clear search">
                  <IconX size={12} />
                </ActionIcon>
              ) : null
            }
          />
          <Tooltip label="Refresh contacts">
            <ActionIcon
              size="input-xs"
              variant="default"
              onClick={() => void loadGoogleContacts(query)}
              loading={loading}
              aria-label="Refresh contacts"
            >
              <IconRefresh size={14} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {error && (
          <Paper withBorder p="xs" radius="sm" style={{ borderColor: 'var(--mantine-color-red-6)' }}>
            <Text size="xs" c="red">{error}</Text>
          </Paper>
        )}

        {loading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : contacts.length === 0 ? (
          <Paper withBorder p="lg" radius="md" ta="center">
            <Text fw={500} size="sm">No Google Contacts found</Text>
            <Text size="xs" c="dimmed" mt={4}>
              {query.trim()
                ? 'Try a different search query or clear the filter to see recent contacts.'
                : 'No contacts found in your connected Google account.'}
            </Text>
          </Paper>
        ) : (
          <Stack gap="xs" style={{ maxHeight: 420, overflowY: 'auto' }} pr={4}>
            {contacts.map((contact) => {
              const state = importStates[contact.resourceName];
              const choice = selectedLead[contact.resourceName] || '__new__';

              return (
                <Paper key={contact.resourceName} withBorder p="xs" radius="sm">
                  <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Group gap={6} align="center">
                        <Text fw={600} size="sm" truncate>{contact.name}</Text>
                        {contact.organization && (
                          <Badge variant="outline" color="gray" size="xs" leftSection={<IconBuilding size={10} />}>
                            {contact.organization}
                          </Badge>
                        )}
                      </Group>
                      <Group gap="xs" mt={2} wrap="wrap">
                        {contact.email && (
                          <Group gap={4} align="center">
                            <IconMail size={12} style={{ color: 'var(--mantine-color-dimmed)' }} />
                            <Text size="xs" c="dimmed">{contact.email}</Text>
                          </Group>
                        )}
                        {contact.phone && (
                          <Group gap={4} align="center">
                            <IconPhone size={12} style={{ color: 'var(--mantine-color-dimmed)' }} />
                            <Text size="xs" c="dimmed">{contact.phone}</Text>
                          </Group>
                        )}
                      </Group>
                    </Box>

                    <Group gap="xs" align="center" wrap="nowrap">
                      {state?.status ? (
                        <Badge
                          variant="light"
                          color={state.status === 'already-exists' ? 'gray' : 'green'}
                          size="sm"
                          leftSection={<IconCheck size={12} />}
                        >
                          {state.status === 'created'
                            ? 'Lead Created'
                            : state.status === 'already-exists'
                            ? 'Already on Lead'
                            : 'Imported'}
                        </Badge>
                      ) : (
                        <>
                          <Select
                            size="xs"
                            w={180}
                            data={leadSelectData}
                            value={choice}
                            onChange={(val) => {
                              setSelectedLead((prev) => ({
                                ...prev,
                                [contact.resourceName]: val || '__new__',
                              }));
                            }}
                            disabled={loadingLeads || state?.loading}
                            searchable
                            aria-label={`Target lead for ${contact.name}`}
                          />
                          <Button
                            size="xs"
                            variant="light"
                            color="indigo"
                            loading={state?.loading}
                            leftSection={<IconUserPlus size={13} />}
                            onClick={() => void handleImport(contact)}
                          >
                            Import
                          </Button>
                        </>
                      )}
                    </Group>
                  </Group>
                </Paper>
              );
            })}
          </Stack>
        )}

        <Divider />

        <Group justify="space-between">
          <Text size="xs" c="dimmed">
            {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'} loaded from Google
          </Text>
          <Button variant="default" size="xs" onClick={onClose}>
            Done
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
