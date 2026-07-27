'use client';

import { ActionIcon, Box, Button, Checkbox, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';

// Extracted from app/detail.tsx's LeadDetailModal (issue #113) so
// app/components/AddLeadModal.tsx (issue #127) can reuse the exact same
// repeatable-rows contact editor instead of a second, drifting copy.
// Purely controlled — no internal edit-mode/save state of its own; each
// caller owns that (LeadDetailModal has an Edit/Save/Cancel toggle around
// this, AddLeadModal is always "editing" since it's a single create form).
export type ContactRow = {
  name: string;
  title: string;
  email: string;
  phone: string;
  linkedin: string;
  role: string;
  isDecisionMaker: boolean;
};

export const EMPTY_CONTACT_ROW: ContactRow = {
  name: '', title: '', email: '', phone: '', linkedin: '', role: '', isDecisionMaker: false,
};

type Props = {
  value: ContactRow[];
  onChange: (rows: ContactRow[]) => void;
};

export function ContactsEditor({ value, onChange }: Props) {
  return (
    <Stack gap="sm">
      {value.length === 0 && <Text size="sm" c="dimmed">No contacts yet.</Text>}
      {value.map((c, i) => (
        <Box key={i} p="xs" style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6 }}>
          <Group justify="space-between" align="center" mb={4}>
            <Text size="xs" c="dimmed" fw={600}>Contact {i + 1}</Text>
            <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove contact" onClick={() => onChange(value.filter((_, idx) => idx !== i))}>
              <IconTrash size={14} />
            </ActionIcon>
          </Group>
          <Stack gap={4}>
            <TextInput size="xs" placeholder="Name" value={c.name} onChange={(e) => { const v = e.currentTarget.value; onChange(value.map((r, idx) => idx === i ? { ...r, name: v } : r)); }} />
            <TextInput size="xs" placeholder="Title" value={c.title} onChange={(e) => { const v = e.currentTarget.value; onChange(value.map((r, idx) => idx === i ? { ...r, title: v } : r)); }} />
            <TextInput size="xs" placeholder="Email" value={c.email} onChange={(e) => { const v = e.currentTarget.value; onChange(value.map((r, idx) => idx === i ? { ...r, email: v } : r)); }} />
            <TextInput size="xs" placeholder="Phone" value={c.phone} onChange={(e) => { const v = e.currentTarget.value; onChange(value.map((r, idx) => idx === i ? { ...r, phone: v } : r)); }} />
            <TextInput size="xs" placeholder="LinkedIn URL" value={c.linkedin} onChange={(e) => { const v = e.currentTarget.value; onChange(value.map((r, idx) => idx === i ? { ...r, linkedin: v } : r)); }} />
            <Checkbox size="xs" label="Decision maker" checked={c.isDecisionMaker} onChange={(e) => { const v = e.currentTarget.checked; onChange(value.map((r, idx) => idx === i ? { ...r, isDecisionMaker: v } : r)); }} />
          </Stack>
        </Box>
      ))}
      <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => onChange([...value, { ...EMPTY_CONTACT_ROW }])}>
        Add contact
      </Button>
    </Stack>
  );
}
