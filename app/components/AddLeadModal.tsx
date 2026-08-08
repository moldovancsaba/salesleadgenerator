'use client';

import { useState } from 'react';
import { Modal, Stack, Group, TextInput, Select, Textarea, TagsInput, Button, Divider, Text } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { ContactsEditor, type ContactRow } from './ContactsEditor';
import { SIZE_FIELD_OPTIONS } from '../constants';
import { MANUAL_LEAD_DEFAULT_ICE } from '@/lib/create-lead-defaults';

// Issue #127 — a real, human-facing path to create a lead. Previously the
// only caller of POST /api/leads was the research agent; nothing in this
// app's own UI ever created a lead.

const EMPTY_FORM = {
  entity_name: '',
  url: '',
  country: '',
  region: '',
  address: '',
  general_contact: '',
  size: '',
  industry: '',
  sport_or_sector: '',
  level_league: '',
  value_proposition: '',
  notes: '',
  tags: [] as string[],
};

type Props = {
  brand: string;
  opened: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export function AddLeadModal({ brand, opened, onClose, onCreated }: Props) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [saving, setSaving] = useState(false);

  function reset() {
    setForm(EMPTY_FORM);
    setContacts([]);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!form.entity_name.trim() || !form.url.trim() || !form.country.trim()) {
      showNotification({ message: 'Entity name, URL, and country are required.', color: 'yellow' });
      return;
    }

    setSaving(true);
    try {
      const url = new URL('/api/leads', window.location.origin);
      url.searchParams.set('brand', brand);
      url.searchParams.set('tenantId', 'default');

      const res = await fetch(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entity_name: form.entity_name.trim(),
          url: form.url.trim(),
          country: form.country.trim().toUpperCase(),
          // Required by validateLeadPayload on create — a manually-added
          // lead always starts in Discovered, matching the neutral-ICE
          // default below rather than jumping straight to Qualified.
          kanbanColumn: 'DISCOVERED',
          region: form.region,
          address: form.address,
          general_contact: form.general_contact,
          size: form.size || undefined,
          industry: form.industry,
          sport_or_sector: form.sport_or_sector,
          level_league: form.level_league,
          value_proposition: form.value_proposition,
          notes: form.notes,
          tags: form.tags,
          contacts,
          ice: MANUAL_LEAD_DEFAULT_ICE,
          source: 'manual',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // 409 (duplicate fingerprint) and 422 (creation-time quality gate)
        // are both meaningful, actionable states — surfaced with the
        // server's real message, not a generic "Save failed."
        if (res.status === 409) {
          throw new Error(data?.error ? `${data.error}${data.existing?.entity_name ? ` (${data.existing.entity_name})` : ''}` : 'A lead for this entity/URL already exists.');
        }
        if (res.status === 422) {
          throw new Error(data?.error || 'This lead needs a stronger contact before it can be created.');
        }
        throw new Error(data?.error || `Create failed: ${res.status}`);
      }

      showNotification({ message: 'Lead created', color: 'green', autoClose: 4000 });
      reset();
      onCreated();
      onClose();
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Create failed', color: 'red', autoClose: 6000 });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal opened={opened} onClose={handleClose} title="Add Lead" size="lg" centered>
      <Stack gap="sm">
        <TextInput
          label="Entity name"
          required
          value={form.entity_name}
          onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, entity_name: v })); }}
        />
        <TextInput
          label="URL"
          required
          placeholder="https://example.com"
          value={form.url}
          onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, url: v })); }}
        />
        <Group grow>
          <TextInput
            label="Country"
            required
            placeholder="US"
            maxLength={2}
            value={form.country}
            onChange={(e) => { const v = e.currentTarget.value.toUpperCase(); setForm((f) => ({ ...f, country: v })); }}
          />
          <TextInput
            label="Region"
            placeholder="US"
            value={form.region}
            onChange={(e) => { const v = e.currentTarget.value.toUpperCase(); setForm((f) => ({ ...f, region: v })); }}
          />
        </Group>
        <TextInput label="Address" value={form.address} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, address: v })); }} />
        <TextInput label="General contact" value={form.general_contact} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, general_contact: v })); }} />
        <Select
          label="Size"
          value={form.size || null}
          onChange={(v) => setForm((f) => ({ ...f, size: v || '' }))}
          data={SIZE_FIELD_OPTIONS}
          clearable
        />
        <TextInput label="Industry" value={form.industry} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, industry: v })); }} />
        <TextInput label="Sport / Sector" value={form.sport_or_sector} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, sport_or_sector: v })); }} />
        <TextInput label="Level / League" value={form.level_league} onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, level_league: v })); }} />
        <Textarea
          label="Value proposition"
          value={form.value_proposition}
          onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, value_proposition: v })); }}
          rows={3}
        />
        <Textarea
          label="Notes"
          value={form.notes}
          onChange={(e) => { const v = e.currentTarget.value; setForm((f) => ({ ...f, notes: v })); }}
          rows={3}
        />
        <TagsInput
          label="Tags"
          value={form.tags}
          onChange={(v) => setForm((f) => ({ ...f, tags: v }))}
        />

        <Divider label="Contacts" labelPosition="left" />
        <ContactsEditor value={contacts} onChange={setContacts} />

        <Text size="xs" c="dimmed">
          Lands in Discovered/Qualified automatically based on a neutral default score — this form doesn&apos;t ask you to set ICE scores directly.
        </Text>

        <Group justify="flex-end" gap="xs" mt="xs">
          <Button variant="light" color="gray" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} loading={saving}>Create Lead</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
