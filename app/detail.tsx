'use client';

import { useState, useEffect } from 'react';
import type { Lead } from './types';
import { AdminModal, AdminDetailDrawer, AdminTextarea, AdminSelect, InfoCard } from '@doneisbetter/gds-admin/client';
import { Stack, Group, Text, Badge, Progress, Button, Box, Title, SimpleGrid } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeLead, ensureArrayField } from './lib/normalize-lead';
import {
  IconX,
  IconThumbUp,
  IconThumbDown,
  IconPin,
  IconRefresh,
  IconTrash,
  IconMail,
} from '@tabler/icons-react';
import { OutreachComposeModal } from './outreach/compose-modal';

type KanbanColumn = Lead['kanbanColumn'];
type DeclineReason = Lead extends { declineReason?: infer R } ? R : never;

type Props = {
  lead?: Lead | null;
  brand?: string;
  opened?: boolean;
  onClose: () => void;
  onAction: (leadId: string, action: string, payload?: any) => void;
  onDelete: (leadId: string) => void;
  onUpdated: () => void;
};

const DECLINE_REASONS: { value: DeclineReason; label: string }[] = [
  { value: "WRONG_INDUSTRY", label: "Wrong industry" },
  { value: "NO_DECISION_MAKER", label: "No decision maker" },
  { value: "TOO_SMALL", label: "Too small" },
  { value: "ALREADY_COMPETITOR", label: "Already competitor" },
  { value: "BAD_TIMING", label: "Bad timing" },
  { value: "BUDGET_CONSTRAINTS", label: "Budget constraints" },
  { value: "NOT_RESPONSIVE", label: "Not responsive" },
  { value: "MISSING_CONTEXT", label: "Missing context" },
  { value: "LOW_PRIORITY", label: "Low priority" },
  { value: "OTHER", label: "Other" },
];

export function LeadDetailModal({ lead, brand = 'slg', opened = false, onClose, onAction, onDelete, onUpdated }: Props) {
  const [annotation, setAnnotation] = useState("");
  const [declineReason, setDeclineReason] = useState<DeclineReason>("OTHER");
  const [actionMode, setActionMode] = useState<"decline" | "pin" | "refresh" | null>(null);
  const [busy, setBusy] = useState(false);
  const [outreachOpen, setOutreachOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(max-width: 1279px)');
    setFullScreen(mql.matches);
    const handler = (event: MediaQueryListEvent) => setFullScreen(event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  const ice = (lead?.ice) || { impact: 0, confidence: 0, ease: 0 };
  const iceScore = Math.round(ice.impact * ice.confidence * ice.ease);
  const maxIce = 1000;
  const icePercent = Math.min(100, (iceScore / maxIce) * 100);

  const normalized = normalizeLead(lead || {}, brand);
  const normalizedPro = ensureArrayField((normalized as any)[`pro_for_${brand}`]);
  const normalizedCon = ensureArrayField((normalized as any)[`con_for_${brand}`]);

  const iceToneValue = iceScore >= 700 ? 'teal' : iceScore >= 480 ? 'green' : iceScore >= 200 ? 'orange' : 'blue';
  const regionToneValue = (lead?.region || '') === 'USA' ? 'blue' : lead.region === 'CEE' ? 'indigo' : lead.region === 'MENA' ? 'green' : 'gray';
  const qualityStatus: string = ((normalized.qualityStatus || 'DRAFT') as string);
  const qualityToneValue = qualityStatus === 'VERIFIED' ? 'teal' : qualityStatus === 'CHECKED' ? 'orange' : 'gray';

  async function handleAccept() {
    setBusy(true);
    try {
      await onAction(lead._id, "ACCEPT", { annotation: annotation || "Accepted" });
      showNotification({ message: 'Moved to QUALIFIED', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Accept failed', color: 'red', autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  }

  async function handleDecline() {
    setBusy(true);
    try {
      await onAction(lead._id, "DECLINE", { declineReason, annotation });
      showNotification({ message: 'Moved to LOST', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Decline failed', color: 'red', autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  }

  async function handlePin() {
    setBusy(true);
    try {
      await onAction(lead._id, "PIN", { annotation });
      showNotification({ message: 'Pinned to ENGAGED', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Pin failed', color: 'red', autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    try {
      await onAction(lead._id, "REQUEST_REFRESH", { annotation });
      showNotification({ message: 'Refresh requested', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Refresh request failed', color: 'red', autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      await onDelete(lead._id);
      showNotification({ message: 'Lead deleted', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Delete failed', color: 'red', autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  }

  async function handleModify() {
    setBusy(true);
    try {
      await onAction(lead._id, 'MODIFY', {
        entity_name: lead.entity_name,
        url: lead.url,
        address: lead.address,
        general_contact: lead.general_contact,
        size: lead.size,
        industry: lead.industry,
        sport_or_sector: lead.sport_or_sector,
        level_league: lead.level_league,
        decision_maker_name: lead.decision_maker_name,
        decision_maker_title: lead.decision_maker_title,
        decision_maker_contact: lead.decision_maker_contact,
        value_proposition: lead.value_proposition,
        notes: lead.notes,
        tags: lead.tags,
      });
      showNotification({ message: 'Lead updated', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Modify failed', color: 'red', autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  }

  const actions = {
    primary: {
      action: 'gds.action.approve',
      color: 'green',
      disabled: busy,
      onClick: handleAccept,
    },
    secondary: [
      {
        action: 'gds.action.reject',
        color: 'red',
        variant: 'light',
        disabled: busy,
        onClick: () => setActionMode("decline"),
      },
      {
        action: 'gds.action.pin',
        color: 'blue',
        variant: 'light',
        disabled: busy,
        onClick: handlePin,
      },
      {
        action: 'gds.action.refresh',
        color: 'gray',
        variant: 'light',
        disabled: busy,
        onClick: handleRefresh,
      },
    ],
    tertiary: [
      {
        action: 'gds.action.edit',
        color: 'dark',
        variant: 'light',
        disabled: busy,
        onClick: () => setOutreachOpen(true),
      },
      {
        action: 'gds.action.modify',
        color: 'yellow',
        variant: 'light',
        disabled: busy,
        onClick: handleModify,
      },
      {
        action: 'gds.action.delete',
        color: 'red',
        variant: 'subtle',
        destructive: true,
        disabled: busy,
        onClick: handleDelete,
      },
    ],
  };

  const metadata = (
    <Stack gap="xs">
      <Title order={3}>{lead.entity_name}</Title>
      <Group gap="xs">
        <Badge variant="light" color="gray">{lead.country || '—'}</Badge>
        <Badge variant="light" color={regionToneValue}>{lead.region || '—'}</Badge>
        <Text size="sm" c="dimmed">{lead.industry || lead.sport_or_sector}</Text>
        <Badge variant="light" color={qualityToneValue}>{qualityStatus}</Badge>
      </Group>
    </Stack>
  );

  const content = (
    <Stack gap="md">
      <Box>
        <Group justify="space-between">
          <Text fw={600}>ICE Score</Text>
          <Text fw={700} size="lg">{iceScore} / {maxIce}</Text>
        </Group>
        <Progress value={icePercent} size="lg" color={iceToneValue} />
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs" mt="xs">
          <Box>
            <Text size="xs" c="dimmed">Impact</Text>
            <Text fw={600}>{ice.impact} / 10</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Confidence</Text>
            <Text fw={600}>{ice.confidence} / 10</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">Ease</Text>
            <Text fw={600}>{ice.ease} / 10</Text>
          </Box>
        </SimpleGrid>
      </Box>

      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <Box>
          <Text size="xs" c="dimmed">URL</Text>
          {lead.url ? (
            <Text size="sm" component="a" href={lead.url} target="_blank" c="blue">{lead.url}</Text>
          ) : '—'}
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Size</Text>
          <Text size="sm">{lead.size || '—'}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Level / League</Text>
          <Text size="sm">{lead.level_league || '—'}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Kanban Column</Text>
          <Text size="sm">{lead.kanbanColumn}</Text>
        </Box>
      </SimpleGrid>

      <Stack gap="xs">
        <Text size="xs" c="dimmed" fw={600}>CONTACTS</Text>
        {lead.decision_maker_name ? (
          <Box>
            <Text fw={600}>{lead.decision_maker_name}</Text>
            {lead.decision_maker_title && <Text size="sm" c="dimmed">{lead.decision_maker_title}</Text>}
            <Text size="sm" c="dimmed">{lead.decision_maker_contact || ''}</Text>
          </Box>
        ) : null}
        {(lead.contacts || []).map((contact, i) => (
          <Box key={i}>
            <Text fw={600}>{contact.name || contact.title || 'Contact'}</Text>
            {contact.title && <Text size="sm" c="dimmed">{contact.title}</Text>}
            {contact.email && <Text size="sm" c="dimmed">{contact.email}</Text>}
            {contact.phone && <Text size="sm" c="dimmed">{contact.phone}</Text>}
            {contact.linkedin && <Text size="sm" c="blue">{contact.linkedin}</Text>}
          </Box>
        ))}
      </Stack>

      {((normalizedPro && normalizedPro.length > 0) || (normalizedCon && normalizedCon.length > 0)) && (
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {normalizedPro && normalizedPro.length > 0 && (
            <Box>
              <Text size="xs" c="green" fw={600} tt="uppercase">Pros</Text>
              <Stack gap={4}>
                {normalizedPro.map((pro, i) => (<Text size="sm" key={i}>• {pro}</Text>))}
              </Stack>
            </Box>
          )}
          {normalizedCon && normalizedCon.length > 0 && (
            <Box>
              <Text size="xs" c="red" fw={600} tt="uppercase">Cons</Text>
              <Stack gap={4}>
                {normalizedCon.map((con, i) => (<Text size="sm" key={i}>• {con}</Text>))}
              </Stack>
            </Box>
          )}
        </SimpleGrid>
      )}

      {lead.value_proposition && (
        <Box>
          <Text size="xs" c="blue" fw={600} tt="uppercase">Value Proposition</Text>
          <Text size="sm">{lead.value_proposition}</Text>
        </Box>
      )}

      {(lead.feedbackScore > 0 || lead.declineCount > 0 || lead.acceptanceCount > 0) && (
        <Box>
          <Text size="xs" fw={600} tt="uppercase">Feedback History</Text>
          <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xs">
            <Box>
              <Text size="xs" c="dimmed">Feedback Score</Text>
              <Text fw={700}>{lead.feedbackScore}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">Acceptances</Text>
              <Text fw={700} c="green">{lead.acceptanceCount}</Text>
            </Box>
            <Box>
              <Text size="xs" c="dimmed">Declines</Text>
              <Text fw={700} c="red">{lead.declineCount}</Text>
            </Box>
          </SimpleGrid>
          {lead.declinedAt && lead.declineReason && (
            <Text size="xs" c="dimmed">Declined: {new Date(lead.declinedAt).toLocaleDateString()} ({lead.declineReason})</Text>
          )}
        </Box>
      )}

      <AdminSelect
        name="declineReason"
        label="Decline Reason"
        description="Only used when declining"
        value={declineReason}
        onChange={(value) => setDeclineReason(value as DeclineReason)}
        data={DECLINE_REASONS.map((r) => ({ value: r.value, label: r.label }))}
      />
      <AdminTextarea
        name="annotation"
        label="Annotation"
        description="Add notes, reasoning, or context for your action…"
        value={annotation}
        onChange={(value) => setAnnotation(value)}
        rows={3}
      />
    </Stack>
  );

  if (!lead || !opened) {
    return null;
  }

  return (
    <>
      {fullScreen ? (
        <AdminModal opened={visible} onClose={onClose} title={lead.entity_name} description={lead.industry || lead.sport_or_sector || undefined} size="full" actions={actions as any}>
          <Stack gap="md">{content}</Stack>
        </AdminModal>
      ) : (
        <AdminDetailDrawer opened={visible} onClose={onClose} title={lead.entity_name} description={lead.industry || lead.sport_or_sector || undefined} metadata={metadata} actions={actions as any} />
      )}
      <OutreachComposeModal opened={outreachOpen} onClose={() => setOutreachOpen(false)} lead={lead} brand={brand} />
    </>
  );
}
