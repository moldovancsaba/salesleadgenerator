'use client';

import { useState, useEffect } from 'react';
import {
  Modal,
  Stack,
  Group,
  TextInput,
  NumberInput,
  Select,
  Switch,
  Button,
  Text,
  Badge,
  Paper,
  Divider,
  Alert,
} from '@mantine/core';
import {
  IconUserPlus,
  IconCurrencyDollar,
  IconBuilding,
  IconAlertCircle,
  IconCheck,
  IconUsers,
} from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';
import type { Brand, CurrencyCode } from '@/app/lib/brand-constants';
import { CURRENCY_CODE_OPTIONS } from '@/app/lib/brand-constants';
import { BUYING_ROLES, type NormalizedContact, type BuyingRole } from '@/lib/contacts';
import { inferCompanyFromEmail, inferCountryFromDomain } from '@/lib/email-contact-extractor';

type Props = {
  brand: Brand;
  threadId: string;
  leadId?: string;
  leadName?: string;
  defaultContact?: {
    name?: string;
    email: string;
    title?: string;
    phone?: string;
  };
  threadParticipants?: NormalizedContact[];
  mode: 'convert' | 'add_deal';
  opened: boolean;
  onClose: () => void;
  onSuccess: (data: { leadId: string; deal?: any; lead?: any }) => void;
};

const STAGE_OPTIONS = [
  { value: 'DISCOVERED', label: 'Discovered' },
  { value: 'IDENTIFIED', label: 'Identified' },
  { value: 'CONTACTED', label: 'Contacted' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'IN_PIPELINE', label: 'In Pipeline' },
];

export function ConvertModal({
  brand,
  threadId,
  leadId,
  leadName,
  defaultContact,
  threadParticipants = [],
  mode,
  opened,
  onClose,
  onSuccess,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Lead fields
  const [entityName, setEntityName] = useState('');
  const [url, setUrl] = useState('');
  const [country, setCountry] = useState('US');
  const [kanbanColumn, setKanbanColumn] = useState('IDENTIFIED');
  const [contactName, setContactName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactTitle, setContactTitle] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [buyingRole, setBuyingRole] = useState<BuyingRole>('decision_maker');

  // Deal fields
  const [createDeal, setCreateDeal] = useState(true);
  const [dealValue, setDealValue] = useState<number | string>(10000);
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [dealLabel, setDealLabel] = useState('');
  const [stageId, setStageId] = useState('QUALIFIED');
  const [probability, setProbability] = useState<number | string>(50);

  // Pre-fill fields whenever opened
  useEffect(() => {
    if (!opened) return;
    setErrorMsg(null);

    const email = defaultContact?.email || (threadParticipants[0]?.email ?? '');
    setContactEmail(email);

    const name = defaultContact?.name || threadParticipants[0]?.name || '';
    setContactName(name);

    setContactTitle(defaultContact?.title || threadParticipants[0]?.title || '');
    setContactPhone(defaultContact?.phone || threadParticipants[0]?.phone || '');

    if (email) {
      const companyInfo = inferCompanyFromEmail(email);
      const company = companyInfo?.companyName || 'Inbound Prospect';
      setEntityName(leadName || company);
      setUrl(companyInfo?.domain ? `https://${companyInfo.domain}` : 'https://example.com');
      setCountry(inferCountryFromDomain(companyInfo?.domain || ''));
      setDealLabel(`${leadName || company} - Initial Deal`);
    } else {
      setEntityName(leadName || 'Inbound Prospect');
      setDealLabel(`${leadName || 'Inbound Prospect'} - Initial Deal`);
    }
  }, [opened, defaultContact, threadParticipants, leadName]);

  const handleSubmit = async () => {
    setSubmitting(true);
    setErrorMsg(null);

    try {
      if (mode === 'convert') {
        if (!entityName.trim()) {
          setErrorMsg('Organization name is required');
          setSubmitting(false);
          return;
        }
        if (!contactEmail.trim()) {
          setErrorMsg('Contact email is required');
          setSubmitting(false);
          return;
        }
      }

      const payload = {
        threadId,
        action: mode === 'convert' ? 'create_lead' : 'add_deal',
        existingLeadId: leadId,
        lead:
          mode === 'convert'
            ? {
                entity_name: entityName.trim(),
                url: url.trim(),
                country: country.trim().toUpperCase(),
                kanbanColumn,
                contact: {
                  name: contactName.trim(),
                  email: contactEmail.trim().toLowerCase(),
                  title: contactTitle.trim(),
                  phone: contactPhone.trim(),
                  buyingRole,
                },
              }
            : undefined,
        deal:
          createDeal && dealValue && Number(dealValue) > 0
            ? {
                createDeal: true,
                value: Number(dealValue),
                currency,
                label: dealLabel.trim() || undefined,
                stageId,
                probability: Number(probability) || undefined,
              }
            : undefined,
      };

      const res = await fetch(`/api/inbox/${brand}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to convert email');
      }

      showNotification({
        title: 'Success',
        message:
          mode === 'convert'
            ? `Converted "${entityName}" to Lead${data.deal ? ` with ${currency} ${Number(dealValue).toLocaleString()} Deal` : ''}.`
            : `Added ${currency} ${Number(dealValue).toLocaleString()} Deal to ${leadName}.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      });

      onSuccess(data);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Conversion failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={
        <Group gap="xs">
          {mode === 'convert' ? <IconUserPlus size={20} color="var(--mantine-color-indigo-6)" /> : <IconCurrencyDollar size={20} color="var(--mantine-color-teal-6)" />}
          <Text fw={700} size="md">
            {mode === 'convert' ? 'Convert Email Contact to Lead & Deal' : `Add Deal to ${leadName || 'Lead'}`}
          </Text>
        </Group>
      }
      size="lg"
      radius="md"
    >
      <Stack gap="md">
        {errorMsg && (
          <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setErrorMsg(null)}>
            {errorMsg}
          </Alert>
        )}

        {mode === 'convert' && (
          <>
            <Paper p="sm" withBorder radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
              <Group gap="xs" mb="xs">
                <IconBuilding size={16} color="var(--mantine-color-indigo-6)" />
                <Text fw={700} size="sm">
                  Organization & Lead
                </Text>
              </Group>
              <Stack gap="xs">
                <TextInput
                  label="Company / Organization Name"
                  required
                  size="xs"
                  placeholder="e.g. Acme Sports Inc."
                  value={entityName}
                  onChange={(e) => setEntityName(e.currentTarget.value)}
                />
                <Group grow>
                  <TextInput
                    label="Website URL"
                    size="xs"
                    placeholder="https://acme.com"
                    value={url}
                    onChange={(e) => setUrl(e.currentTarget.value)}
                  />
                  <TextInput
                    label="Country Code"
                    size="xs"
                    placeholder="US, DE, GB"
                    value={country}
                    onChange={(e) => setCountry(e.currentTarget.value.toUpperCase())}
                  />
                  <Select
                    label="Pipeline Stage"
                    size="xs"
                    data={STAGE_OPTIONS}
                    value={kanbanColumn}
                    onChange={(val) => val && setKanbanColumn(val)}
                  />
                </Group>
              </Stack>
            </Paper>

            <Paper p="sm" withBorder radius="sm">
              <Group gap="xs" mb="xs">
                <IconUserPlus size={16} color="var(--mantine-color-blue-6)" />
                <Text fw={700} size="sm">
                  Primary Contact
                </Text>
              </Group>
              <Stack gap="xs">
                <Group grow>
                  <TextInput
                    label="Contact Name"
                    size="xs"
                    placeholder="Jane Doe"
                    value={contactName}
                    onChange={(e) => setContactName(e.currentTarget.value)}
                  />
                  <TextInput
                    label="Contact Email"
                    required
                    size="xs"
                    placeholder="jane@acme.com"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.currentTarget.value)}
                  />
                </Group>
                <Group grow>
                  <TextInput
                    label="Job Title"
                    size="xs"
                    placeholder="VP Commercial"
                    value={contactTitle}
                    onChange={(e) => setContactTitle(e.currentTarget.value)}
                  />
                  <TextInput
                    label="Phone"
                    size="xs"
                    placeholder="+1 555-0100"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.currentTarget.value)}
                  />
                  <Select
                    label="Buying Role"
                    size="xs"
                    data={BUYING_ROLES.map((r) => ({ value: r, label: r.replace('_', ' ') }))}
                    value={buyingRole}
                    onChange={(val) => val && setBuyingRole(val as BuyingRole)}
                  />
                </Group>
              </Stack>

              {threadParticipants.length > 1 && (
                <Alert color="blue" variant="light" icon={<IconUsers size={16} />} mt="sm">
                  <Text size="xs">
                    <strong>{threadParticipants.length} contacts</strong> detected in this email thread will be automatically saved to this lead.
                  </Text>
                </Alert>
              )}
            </Paper>
          </>
        )}

        {/* Deal Section */}
        <Paper p="sm" withBorder radius="sm" style={{ backgroundColor: createDeal ? 'var(--mantine-color-teal-0)' : undefined }}>
          <Group justify="space-between" align="center" mb={createDeal ? 'xs' : 0}>
            <Group gap="xs">
              <IconCurrencyDollar size={18} color="var(--mantine-color-teal-7)" />
              <Text fw={700} size="sm">
                Deal Details
              </Text>
            </Group>
            {mode === 'convert' && (
              <Switch
                label="Create Deal alongside Lead"
                size="xs"
                checked={createDeal}
                onChange={(e) => setCreateDeal(e.currentTarget.checked)}
              />
            )}
          </Group>

          {createDeal && (
            <Stack gap="xs">
              <Group grow>
                <NumberInput
                  label="Deal Value"
                  size="xs"
                  required
                  min={1}
                  placeholder="10000"
                  value={dealValue}
                  onChange={(val) => setDealValue(val)}
                />
                <Select
                  label="Currency"
                  size="xs"
                  data={CURRENCY_CODE_OPTIONS}
                  value={currency}
                  onChange={(val) => val && setCurrency(val as CurrencyCode)}
                />
                <NumberInput
                  label="Win Probability (%)"
                  size="xs"
                  min={0}
                  max={100}
                  value={probability}
                  onChange={(val) => setProbability(val)}
                />
              </Group>
              <TextInput
                label="Deal Title / Label"
                size="xs"
                placeholder="e.g. Q4 Sponsorship & Signage"
                value={dealLabel}
                onChange={(e) => setDealLabel(e.currentTarget.value)}
              />
            </Stack>
          )}
        </Paper>

        <Group justify="flex-end" mt="sm">
          <Button variant="default" size="xs" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="xs"
            color={mode === 'convert' ? 'indigo' : 'teal'}
            leftSection={mode === 'convert' ? <IconUserPlus size={14} /> : <IconCurrencyDollar size={14} />}
            onClick={handleSubmit}
            loading={submitting}
          >
            {mode === 'convert' ? (createDeal ? 'Convert to Lead & Deal' : 'Convert to Lead') : 'Add Deal to Lead'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
