'use client';

import { useState, useEffect } from 'react';
import {
  Modal,
  Box,
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
  Checkbox,
  SegmentedControl,
} from '@mantine/core';
import { InlineAlert } from '@sovereignsquad/gds-core/client';
import {
  IconUserPlus,
  IconCurrencyDollar,
  IconBuilding,
  IconCheck,
  IconUsers,
} from '@tabler/icons-react';
import { showNotification } from '@mantine/notifications';
import type { Brand, CurrencyCode } from '@/app/lib/brand-constants';
import { CURRENCY_CODE_OPTIONS } from '@/app/lib/brand-constants';
import { BUYING_ROLES, type NormalizedContact, type BuyingRole } from '@/lib/contacts';
import {
  inferCompanyFromEmail,
  inferCountryFromDomain,
  formatLocalPartAsName,
  COMMON_PUBLIC_MAIL_DOMAINS,
} from '@/lib/email-contact-extractor';

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
  mode: 'convert' | 'add_deal' | 'add_contact';
  opened: boolean;
  onClose: () => void;
  onSuccess: (data: { leadId: string; deal?: any; lead?: any; action?: string }) => void;
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

  // Target mode for threads that already have a lead:
  // 'existing_lead' adds contacts/deals to the current lead;
  // 'new_lead' creates a separate lead for a participant from a different company/organization.
  const [targetMode, setTargetMode] = useState<'existing_lead' | 'new_lead'>('existing_lead');

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

  // Selective contact harvesting state
  const [selectedContactEmails, setSelectedContactEmails] = useState<string[]>([]);

  // Pre-fill fields whenever modal is opened or inputs change
  useEffect(() => {
    if (!opened) return;
    setErrorMsg(null);

    const email = defaultContact?.email || (threadParticipants[0]?.email ?? '');
    setContactEmail(email);

    const name = defaultContact?.name || threadParticipants[0]?.name || '';
    setContactName(name);

    setContactTitle(defaultContact?.title || threadParticipants[0]?.title || '');
    setContactPhone(defaultContact?.phone || threadParticipants[0]?.phone || '');

    const companyInfo = email ? inferCompanyFromEmail(email) : null;
    const inferredCompany = companyInfo?.companyName || 'Inbound Prospect';

    if (mode === 'convert' || !leadId) {
      setTargetMode('new_lead');
      setEntityName(inferredCompany);
      setUrl(companyInfo?.domain ? `https://${companyInfo.domain}` : 'https://example.com');
      setCountry(inferCountryFromDomain(companyInfo?.domain || ''));
      setDealLabel(`${inferredCompany} - Initial Deal`);
    } else if (mode === 'add_contact') {
      setTargetMode('existing_lead');
      setEntityName(inferredCompany);
      setUrl(companyInfo?.domain ? `https://${companyInfo.domain}` : 'https://example.com');
      setCountry(inferCountryFromDomain(companyInfo?.domain || ''));
      setDealLabel(`${inferredCompany} - Initial Deal`);
    } else {
      setTargetMode('existing_lead');
      setDealLabel(`${leadName || 'Lead'} - Deal`);
    }

    // Default contact harvesting selection:
    // Pre-select primary contact + same company domain contacts only.
    // Exclude other companies and generic public mail providers by default.
    const normalizedPrimary = email.toLowerCase().trim();
    const primaryDomain = normalizedPrimary.includes('@') ? normalizedPrimary.split('@')[1] : '';
    const isPrimaryGeneric = primaryDomain ? COMMON_PUBLIC_MAIL_DOMAINS.has(primaryDomain) : true;

    const initialEmails = new Set<string>();
    if (normalizedPrimary) initialEmails.add(normalizedPrimary);

    for (const p of threadParticipants) {
      const pEmail = p.email.toLowerCase().trim();
      const pDomain = pEmail.includes('@') ? pEmail.split('@')[1] : '';
      if (!pDomain) continue;
      if (pEmail === normalizedPrimary) {
        initialEmails.add(pEmail);
      } else if (!isPrimaryGeneric && pDomain === primaryDomain) {
        initialEmails.add(pEmail);
      }
    }

    setSelectedContactEmails(Array.from(initialEmails));
  }, [opened, defaultContact, threadParticipants, leadName, leadId, mode]);

  const isCreatingLead = mode === 'convert' || (!leadId) || (Boolean(leadId) && targetMode === 'new_lead');
  const isAddingDeal = mode === 'add_deal';

  const normalizedPrimaryEmail = contactEmail.toLowerCase().trim();
  const primaryDomain = normalizedPrimaryEmail.includes('@') ? normalizedPrimaryEmail.split('@')[1] : '';
  const isPrimaryGeneric = primaryDomain ? COMMON_PUBLIC_MAIL_DOMAINS.has(primaryDomain) : true;
  const companyInfo = normalizedPrimaryEmail ? inferCompanyFromEmail(normalizedPrimaryEmail) : null;
  const inferredCompany = companyInfo?.companyName || 'Inbound Prospect';

  // Check if user has explicitly checked contacts from different company domains
  const hasSelectedDifferentOrg = selectedContactEmails.some((em) => {
    const dom = em.split('@')[1]?.toLowerCase().trim();
    return dom && primaryDomain && dom !== primaryDomain && !COMMON_PUBLIC_MAIL_DOMAINS.has(dom);
  });

  const handleSubmit = async () => {
    setSubmitting(true);
    setErrorMsg(null);

    try {
      if (isCreatingLead) {
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
      } else if (mode === 'add_contact') {
        if (!contactEmail.trim()) {
          setErrorMsg('Contact email is required');
          setSubmitting(false);
          return;
        }
      }

      const payload = {
        threadId,
        action: isCreatingLead ? 'create_lead' : isAddingDeal ? 'add_deal' : 'attach_lead',
        existingLeadId: isCreatingLead ? undefined : leadId,
        relinkThread: leadId && targetMode === 'new_lead' ? false : true,
        selectedContactEmails,
        lead: isCreatingLead
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
          : mode === 'add_contact'
          ? {
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
          isAddingDeal || (isCreatingLead && createDeal && dealValue && Number(dealValue) > 0)
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
        throw new Error(data?.error || 'Failed to process request');
      }

      showNotification({
        title: 'Success',
        message: isCreatingLead
          ? `Created Lead "${entityName}" with ${selectedContactEmails.length || 1} contact(s)${data.deal ? ` and ${currency} ${Number(dealValue).toLocaleString()} Deal` : ''}.`
          : mode === 'add_contact'
          ? `Added ${selectedContactEmails.length || 1} contact(s) to ${leadName || 'Lead'}.`
          : `Added ${currency} ${Number(dealValue).toLocaleString()} Deal to ${leadName || 'Lead'}.`,
        color: 'teal',
        icon: <IconCheck size={16} />,
      });

      onSuccess({
        leadId: data.leadId,
        deal: data.deal,
        lead: data.lead,
        action: payload.action,
      });
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
          {isCreatingLead ? (
            <IconUserPlus size={20} color="var(--mantine-color-indigo-6)" />
          ) : mode === 'add_contact' ? (
            <IconUsers size={20} color="var(--mantine-color-blue-6)" />
          ) : (
            <IconCurrencyDollar size={20} color="var(--mantine-color-teal-6)" />
          )}
          <Text fw={700} size="md">
            {isCreatingLead
              ? 'Convert Email Contact to Lead & Deal'
              : mode === 'add_contact'
              ? `Add Contact to ${leadName || 'Lead'}`
              : `Add Deal to ${leadName || 'Lead'}`}
          </Text>
        </Group>
      }
      size="lg"
      radius="md"
    >
      <Stack gap="md">
        {errorMsg && (
          <InlineAlert
            severity="error"
            title="Conversion Error"
            message={errorMsg}
            action={
              <Button size="compact-xs" variant="subtle" color="red" onClick={() => setErrorMsg(null)}>
                Dismiss
              </Button>
            }
          />
        )}

        {/* Multi-Company Action Switcher when thread already has a lead */}
        {leadId && mode === 'add_contact' && (
          <Paper p="xs" withBorder radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
            <Text size="xs" fw={600} mb={6} c="dimmed">
              Conversion Destination:
            </Text>
            <SegmentedControl
              fullWidth
              size="xs"
              value={targetMode}
              onChange={(val) => setTargetMode(val as 'existing_lead' | 'new_lead')}
              data={[
                {
                  value: 'existing_lead',
                  label: `Add to ${leadName || 'Current Lead'}`,
                },
                {
                  value: 'new_lead',
                  label: `Create Separate Lead for ${inferredCompany}`,
                },
              ]}
            />
          </Paper>
        )}

        {/* Organization / Lead Section */}
        {isCreatingLead && (
          <Paper p="sm" withBorder radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
            <Group gap="xs" mb="xs">
              <IconBuilding size={16} color="var(--mantine-color-indigo-6)" />
              <Text fw={700} size="sm">
                Organization & Lead Details
              </Text>
            </Group>
            <Stack gap="xs">
              <TextInput
                label="Company / Organization Name"
                required
                size="xs"
                placeholder="e.g. Romanian Handball Federation"
                value={entityName}
                onChange={(e) => setEntityName(e.currentTarget.value)}
              />
              <Group grow>
                <TextInput
                  label="Website URL"
                  size="xs"
                  placeholder="https://frh.ro"
                  value={url}
                  onChange={(e) => setUrl(e.currentTarget.value)}
                />
                <TextInput
                  label="Country Code"
                  size="xs"
                  placeholder="RO, US, DE, GB"
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
        )}

        {/* Primary Contact Section */}
        {(isCreatingLead || mode === 'add_contact') && (
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
                  placeholder="jane@frh.ro"
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
                  placeholder="+40 21 311 0000"
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
          </Paper>
        )}

        {/* Selective Contact Harvesting Section */}
        {(isCreatingLead || mode === 'add_contact') && threadParticipants.length > 1 && (
          <Paper p="sm" withBorder radius="sm" style={{ backgroundColor: 'var(--mantine-color-gray-0)' }}>
            <Group justify="space-between" align="center" mb="xs">
              <Group gap="xs">
                <IconUsers size={16} color="var(--mantine-color-indigo-6)" />
                <Text fw={700} size="sm">
                  Contacts in Thread ({selectedContactEmails.length}/{threadParticipants.length} selected)
                </Text>
              </Group>
              <Group gap={6}>
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => {
                    setSelectedContactEmails(normalizedPrimaryEmail ? [normalizedPrimaryEmail] : []);
                  }}
                >
                  Only Primary
                </Button>
                {primaryDomain && !isPrimaryGeneric && (
                  <Button
                    size="compact-xs"
                    variant="subtle"
                    color="indigo"
                    onClick={() => {
                      const sameOrg = threadParticipants
                        .filter((p) => p.email.toLowerCase().endsWith(`@${primaryDomain}`))
                        .map((p) => p.email.toLowerCase().trim());
                      setSelectedContactEmails(
                        Array.from(new Set([normalizedPrimaryEmail, ...sameOrg]))
                      );
                    }}
                  >
                    Only @{primaryDomain}
                  </Button>
                )}
                <Button
                  size="compact-xs"
                  variant="subtle"
                  color="gray"
                  onClick={() => {
                    setSelectedContactEmails(threadParticipants.map((p) => p.email.toLowerCase().trim()));
                  }}
                >
                  Select All
                </Button>
              </Group>
            </Group>

            <Text size="xs" c="dimmed" mb="xs">
              Select which contacts from this conversation to associate with this lead. Contacts from other companies are excluded by default to keep records clean.
            </Text>

            <Stack gap="xs">
              {threadParticipants.map((p) => {
                const pEmail = p.email.toLowerCase().trim();
                const isPrimary = pEmail === normalizedPrimaryEmail;
                const pDomain = pEmail.includes('@') ? pEmail.split('@')[1] : '';
                const isSameDomain = !isPrimaryGeneric && pDomain === primaryDomain;
                const isPublic = COMMON_PUBLIC_MAIL_DOMAINS.has(pDomain);
                const isSelected = selectedContactEmails.includes(pEmail);

                return (
                  <Paper
                    key={pEmail}
                    p="xs"
                    withBorder
                    radius="xs"
                    style={{
                      backgroundColor: isSelected ? 'var(--mantine-color-white)' : 'var(--mantine-color-gray-1)',
                      borderColor: isSelected ? 'var(--mantine-color-indigo-3)' : 'var(--mantine-color-gray-3)',
                    }}
                  >
                    <Group justify="space-between" align="center" wrap="nowrap">
                      <Checkbox
                        size="xs"
                        checked={isSelected}
                        disabled={isPrimary}
                        label={
                          <Box>
                            <Group gap={6} align="center">
                              <Text size="xs" fw={isPrimary ? 700 : 500}>
                                {p.name || formatLocalPartAsName(pEmail.split('@')[0])}
                              </Text>
                              <Text size="11px" c="dimmed">
                                ({pEmail})
                              </Text>
                            </Group>
                            {p.title && (
                              <Text size="10px" c="dimmed">
                                {p.title}
                              </Text>
                            )}
                          </Box>
                        }
                        onChange={(e) => {
                          if (e.currentTarget.checked) {
                            setSelectedContactEmails((prev) => Array.from(new Set([...prev, pEmail])));
                          } else {
                            setSelectedContactEmails((prev) => prev.filter((em) => em !== pEmail));
                          }
                        }}
                      />
                      <Group gap={4} wrap="nowrap">
                        {p.isExistingContact && (
                          <Badge size="xs" color="teal" variant="light">
                            {p.existingLeadName ? `Saved on ${p.existingLeadName}` : 'Existing Contact'}
                          </Badge>
                        )}
                        {isPrimary && (
                          <Badge size="xs" color="indigo" variant="filled">
                            Primary
                          </Badge>
                        )}
                        {isSameDomain && !isPrimary && (
                          <Badge size="xs" color="indigo" variant="light">
                            Same Org (@{pDomain})
                          </Badge>
                        )}
                        {!isSameDomain && !isPublic && !isPrimary && (
                          <Badge size="xs" color="orange" variant="light">
                            Different Org (@{pDomain})
                          </Badge>
                        )}
                        {isPublic && !isPrimary && (
                          <Badge size="xs" color="gray" variant="light">
                            Personal
                          </Badge>
                        )}
                      </Group>
                    </Group>
                  </Paper>
                );
              })}
            </Stack>

            {hasSelectedDifferentOrg && (
              <Box mt="xs">
                <InlineAlert
                  severity="warning"
                  title="Cross-Company Contacts Selected"
                  message="You have selected contacts from multiple distinct company domains. They will all be attached to this lead."
                />
              </Box>
            )}
          </Paper>
        )}

        {/* Deal Section */}
        {(isCreatingLead || isAddingDeal) && (
          <Paper
            p="sm"
            withBorder
            radius="sm"
            style={{ backgroundColor: createDeal ? 'var(--mantine-color-teal-0)' : undefined }}
          >
            <Group justify="space-between" align="center" mb={createDeal ? 'xs' : 0}>
              <Group gap="xs">
                <IconCurrencyDollar size={18} color="var(--mantine-color-teal-7)" />
                <Text fw={700} size="sm">
                  Deal Details
                </Text>
              </Group>
              {isCreatingLead && (
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
        )}

        <Divider />

        <Group justify="flex-end" mt="xs">
          <Button variant="default" size="xs" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="xs"
            color={isCreatingLead ? 'indigo' : mode === 'add_contact' ? 'blue' : 'teal'}
            leftSection={
              isCreatingLead ? (
                <IconUserPlus size={14} />
              ) : mode === 'add_contact' ? (
                <IconUsers size={14} />
              ) : (
                <IconCurrencyDollar size={14} />
              )
            }
            onClick={handleSubmit}
            loading={submitting}
          >
            {isCreatingLead
              ? createDeal
                ? 'Convert to Lead & Deal'
                : 'Convert to Lead'
              : mode === 'add_contact'
              ? `Add to ${leadName || 'Lead'}`
              : 'Add Deal to Lead'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
