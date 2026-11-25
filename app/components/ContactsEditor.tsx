'use client';

import { ActionIcon, Box, Button, Group, Select, SimpleGrid, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import { BUYING_ROLES, deriveIsDecisionMaker } from '../../lib/contacts';
import type { BuyingRole } from '../../lib/contacts';
import type { Department } from '../../lib/title-normalization';
import { splitContactName } from '../../lib/template-personalization';

// Extracted from app/detail.tsx's LeadDetailModal (issue #113) so
// app/components/AddLeadModal.tsx (issue #127) can reuse the exact same
// repeatable-rows contact editor instead of a second, drifting copy.
// Purely controlled — no internal edit-mode/save state of its own; each
// caller owns that (LeadDetailModal has an Edit/Save/Cancel toggle around
// this, AddLeadModal is always "editing" since it's a single create form).
export type ContactRow = {
  name: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  title: string;
  departmentOverride?: Department;
  email: string;
  phone: string;
  linkedin: string;
  role: string;
  buyingRole: BuyingRole;
  // Issue #206 — kept on ContactRow, but no longer directly editable: it's
  // always derived from buyingRole (deriveIsDecisionMaker()) before a row
  // is sent to the API, so any consumer still reading isDecisionMaker
  // directly off a saved lead keeps working unchanged.
  isDecisionMaker: boolean;
};

export const EMPTY_CONTACT_ROW: ContactRow = {
  name: '',
  firstName: '',
  lastName: '',
  country: '',
  title: '',
  departmentOverride: undefined,
  email: '',
  phone: '',
  linkedin: '',
  role: '',
  buyingRole: 'unknown',
  isDecisionMaker: false,
};

const BUYING_ROLE_LABEL: Record<BuyingRole, string> = {
  economic_buyer: 'Economic buyer',
  champion: 'Champion',
  influencer: 'Influencer',
  blocker: 'Blocker',
  decision_maker: 'Decision maker',
  unknown: 'Not yet classified',
};

const BUYING_ROLE_OPTIONS = BUYING_ROLES.map((role) => ({ value: role, label: BUYING_ROLE_LABEL[role] }));

const DEPARTMENT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '__auto__', label: 'Auto-detect from job title' },
  { value: 'Executive', label: 'Executive' },
  { value: 'Sales', label: 'Sales' },
  { value: 'Marketing', label: 'Marketing' },
  { value: 'Operations', label: 'Operations' },
];

type Props = {
  value: ContactRow[];
  onChange: (rows: ContactRow[]) => void;
};

function updateRow(value: ContactRow[], i: number, patch: Partial<ContactRow>): ContactRow[] {
  return value.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
}

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
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={6}>
              <TextInput
                size="xs"
                placeholder="First name"
                aria-label="First name"
                value={c.firstName ?? splitContactName(c.name).firstName}
                onChange={(e) => {
                  const first = e.currentTarget.value;
                  const last = c.lastName ?? splitContactName(c.name).lastName;
                  const joined = [first.trim(), last.trim()].filter(Boolean).join(' ');
                  onChange(updateRow(value, i, { firstName: first, lastName: last, name: joined }));
                }}
              />
              <TextInput
                size="xs"
                placeholder="Last name"
                aria-label="Last name"
                value={c.lastName ?? splitContactName(c.name).lastName}
                onChange={(e) => {
                  const last = e.currentTarget.value;
                  const first = c.firstName ?? splitContactName(c.name).firstName;
                  const joined = [first.trim(), last.trim()].filter(Boolean).join(' ');
                  onChange(updateRow(value, i, { firstName: first, lastName: last, name: joined }));
                }}
              />
            </SimpleGrid>
            <TextInput
              size="xs"
              placeholder="Name"
              value={c.name}
              onChange={(e) => {
                const v = e.currentTarget.value;
                const { firstName, lastName } = splitContactName(v);
                onChange(updateRow(value, i, { name: v, firstName, lastName }));
              }}
            />
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={6}>
              <TextInput size="xs" placeholder="Title" value={c.title} onChange={(e) => { const v = e.currentTarget.value; onChange(updateRow(value, i, { title: v })); }} />
              <Select
                size="xs"
                aria-label="Department"
                data={DEPARTMENT_OPTIONS}
                value={c.departmentOverride && c.departmentOverride !== 'Unknown' ? c.departmentOverride : '__auto__'}
                allowDeselect={false}
                onChange={(val) => {
                  const override = val && val !== '__auto__' ? (val as Department) : undefined;
                  onChange(updateRow(value, i, { departmentOverride: override }));
                }}
              />
            </SimpleGrid>
            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing={6}>
              <TextInput size="xs" placeholder="Email" value={c.email} onChange={(e) => { const v = e.currentTarget.value; onChange(updateRow(value, i, { email: v })); }} />
              <TextInput
                size="xs"
                placeholder="Country ISO (e.g. US, GB)"
                maxLength={2}
                value={c.country || ''}
                onChange={(e) => {
                  const v = e.currentTarget.value.toUpperCase();
                  onChange(updateRow(value, i, { country: v }));
                }}
              />
            </SimpleGrid>
            <TextInput size="xs" placeholder="Phone" value={c.phone} onChange={(e) => { const v = e.currentTarget.value; onChange(updateRow(value, i, { phone: v })); }} />
            <TextInput size="xs" placeholder="LinkedIn URL" value={c.linkedin} onChange={(e) => { const v = e.currentTarget.value; onChange(updateRow(value, i, { linkedin: v })); }} />
            <Select
              size="xs"
              label="Buying role"
              data={BUYING_ROLE_OPTIONS}
              value={c.buyingRole}
              allowDeselect={false}
              onChange={(value_) => {
                const role = (value_ as BuyingRole) || 'unknown';
                onChange(updateRow(value, i, { buyingRole: role, isDecisionMaker: deriveIsDecisionMaker(role) }));
              }}
            />
          </Stack>
        </Box>
      ))}
      <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => onChange([...value, { ...EMPTY_CONTACT_ROW }])}>
        Add contact
      </Button>
    </Stack>
  );
}
