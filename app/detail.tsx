'use client';

import { useState, useEffect } from 'react';
import type { Lead } from './types';
import { AdminModal, AdminDetailDrawer, AdminTextarea, AdminSelect, InfoCard } from '@sovereignsquad/gds-admin/client';
import { createGdsVocabularyPack, GdsIcons, StatusBadge } from '@sovereignsquad/gds-core/client';
import { Stack, Group, Text, Badge, Progress, Button, Box, Title, SimpleGrid } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { normalizeLead, ensureArrayField } from './lib/normalize-lead';
import { PRO_FIELD, CON_FIELD } from './lib/brand';
import { isContactStale, DEFAULT_STALENESS_THRESHOLD_DAYS } from '@/lib/contact-freshness';
import { computeStaleness, DEFAULT_STALE_THRESHOLDS } from '@/lib/stale-deal';
import { getNextStepNudge } from '@/lib/next-step-nudge';
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
import { TABLET_LANDSCAPE_MAX } from './constants';

type KanbanColumn = Lead['kanbanColumn'];
type DeclineReason = Lead extends { declineReason?: infer R } ? R : never;

type Props = {
  lead: Lead;
  brand?: string;
  opened?: boolean;
  onClose: () => void;
  onAction: (leadId: string, action: string, payload?: any) => void;
  onDelete: (leadId: string) => void;
  onUpdated: () => void;
};

// MX-based domain-deliverability signal (issue #67) — proves the domain can
// receive mail, never a specific mailbox, so copy always says "domain."
// Undefined (background check hasn't landed yet) and the terminal
// status: 'unverified' (malformed email — rare, since contacts[] isn't
// hard-gated on email format) share one "Checking…" display per the
// issue's own UX spec, which treats both as one "not yet resolved" bucket.
function emailStatusBadge(status: import('@/lib/email-verification').EmailVerificationStatus | undefined) {
  const effective = status?.status ?? 'unverified';
  if (effective === 'mx-verified') {
    return <StatusBadge status="success" aria-label="Email domain verified — this domain can receive mail">Verified domain</StatusBadge>;
  }
  if (effective === 'mx-failed') {
    return <StatusBadge status="danger" aria-label="Email domain check found this domain cannot receive mail">Undeliverable domain</StatusBadge>;
  }
  if (effective === 'check-error') {
    return <StatusBadge status="warning" aria-label="Email domain check failed due to a temporary error — a retry is pending">Check failed — retry pending</StatusBadge>;
  }
  return <StatusBadge status="info" aria-label="Email domain deliverability check in progress">Checking…</StatusBadge>;
}

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

// GDS's built-in semantic-action vocabulary (GdsVocabulary) has no "pin"
// entry — every other action below uses a registered built-in key directly
// (confirm/cancel/refresh/edit/delete), but "pin" needed this one-entry
// custom vocabulary pack. Module-scope constant: static, not per-render.
const LEAD_ACTION_VOCABULARY_PACK = createGdsVocabularyPack('lead', {
  pin: { defaultMessage: 'Pin', icon: GdsIcons.Star, ariaLabel: 'Pin to Engaged' },
});

export function LeadDetailModal({ lead, brand = 'slg', opened = false, onClose, onAction, onDelete, onUpdated }: Props) {
  const [annotation, setAnnotation] = useState("");
  const [declineReason, setDeclineReason] = useState<DeclineReason>("OTHER");
  const [actionMode, setActionMode] = useState<"decline" | "pin" | "refresh" | null>(null);
  const [busy, setBusy] = useState(false);
  const [outreachOpen, setOutreachOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Below desktop width, render as a full-screen AdminModal instead of the
    // side AdminDetailDrawer — a drawer is too cramped on tablet/mobile viewports.
    const mql = window.matchMedia(`(max-width: ${TABLET_LANDSCAPE_MAX}px)`);
    setFullScreen(mql.matches);
    const handler = (event: MediaQueryListEvent) => setFullScreen(event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  if (!lead || !opened) {
    return null;
  }

  const ice = lead.ice || { impact: 0, confidence: 0, ease: 0 };
  const iceScore = Math.round(ice.impact * ice.confidence * ice.ease);
  const maxIce = 1000;
  const icePercent = Math.min(100, (iceScore / maxIce) * 100);

  const normalized = normalizeLead(lead);
  const normalizedPro = ensureArrayField((normalized as any)[PRO_FIELD]);
  const normalizedCon = ensureArrayField((normalized as any)[CON_FIELD]);

  const contactStaleCount = (lead.contacts || []).filter((c) => isContactStale(c, DEFAULT_STALENESS_THRESHOLD_DAYS)).length;

  // DEFAULT_STALE_THRESHOLDS (not brand-fetched /api/settings thresholds):
  // this modal makes no additional API calls per issue #62's own scope, and
  // app/kanban.tsx itself falls back to these same defaults on fetch failure.
  const nudgeNow = new Date();
  const nudgeStaleness = computeStaleness(
    { kanbanColumn: lead.kanbanColumn, updatedAt: lead.updatedAt },
    DEFAULT_STALE_THRESHOLDS,
    nudgeNow
  );
  const nudge = getNextStepNudge(
    { kanbanColumn: lead.kanbanColumn, createdAt: lead.createdAt, contacts: lead.contacts },
    nudgeStaleness,
    nudgeNow
  );

  const iceToneValue = iceScore >= 700 ? 'teal' : iceScore >= 480 ? 'green' : iceScore >= 200 ? 'orange' : 'blue';
  const regionToneValue = lead.region === 'US' ? 'blue' : lead.region === 'CEE' ? 'indigo' : lead.region === 'MENA' ? 'green' : 'gray';
  const qualityStatus: string = ((normalized.qualityStatus || 'DRAFT') as string);
  const qualityToneValue = qualityStatus === 'VERIFIED' ? 'teal' : qualityStatus === 'CHECKED' ? 'orange' : 'gray';

  async function handleAccept() {
    if (!lead) return;
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
    if (!lead) return;
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
    if (!lead) return;
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
    if (!lead) return;
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
    if (!lead) return;
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
    if (!lead) return;
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
        contacts: lead.contacts,
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

  // `action` must resolve against GDS's ActionBar semantic-action
  // vocabulary at runtime (confirmed by testing — the type-level
  // `namespace:action` escape hatch alone is not enough; the id must
  // actually be registered, either in the built-in GdsVocabulary or a
  // pack passed via `vocabularyPacks`). Every action here maps to a
  // built-in vocabulary key except "pin" (LEAD_ACTION_VOCABULARY_PACK,
  // defined above — GdsVocabulary has no "pin" entry).
  const actions = {
    primary: {
      action: 'confirm' as const,
      ariaLabel: 'Approve',
      color: 'green',
      disabled: busy,
      onClick: handleAccept,
    },
    secondary: [
      {
        action: 'cancel' as const,
        ariaLabel: 'Reject',
        color: 'red',
        variant: 'light',
        disabled: busy,
        onClick: () => setActionMode("decline"),
      },
      {
        action: 'lead:pin' as const,
        color: 'blue',
        variant: 'light',
        disabled: busy,
        onClick: handlePin,
      },
      {
        action: 'refresh' as const,
        ariaLabel: 'Request refresh',
        color: 'gray',
        variant: 'light',
        disabled: busy,
        onClick: handleRefresh,
      },
    ],
    tertiary: [
      {
        action: 'edit' as const,
        ariaLabel: 'Compose outreach',
        color: 'dark',
        variant: 'light',
        disabled: busy,
        onClick: () => setOutreachOpen(true),
      },

      {
        action: 'delete' as const,
        ariaLabel: 'Delete',
        color: 'red',
        variant: 'subtle',
        disabled: busy,
        onClick: handleDelete,
      },
    ],
    vocabularyPacks: [LEAD_ACTION_VOCABULARY_PACK],
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

      {nudge && (
        <Box>
          <Group justify="space-between" align="center" wrap="wrap">
            <Text size="sm" c={nudge.severity === 'warn' ? 'orange' : 'dimmed'}>{nudge.message}</Text>
            {nudge.actionable && nudge.action === 'REQUEST_REFRESH' && (
              <Button
                size="xs"
                variant="light"
                color="orange"
                onClick={handleRefresh}
                loading={busy}
                aria-label={`Request refresh — ${nudge.message}`}
              >
                Request refresh
              </Button>
            )}
          </Group>
        </Box>
      )}

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
        <Group justify="space-between" align="baseline">
          <Text size="xs" c="dimmed" fw={600}>CONTACTS</Text>
          {/* Helper text for the "refresh" action above: GDS's ActionBar has no
              per-action description slot, so this can't render literally under
              that button — it's surfaced here instead, next to the data it
              describes, without changing REQUEST_REFRESH's own behavior
              (CLAUDE.md Rule 7 — context only, no new affordance). */}
          {contactStaleCount > 0 && (
            <Text size="xs" c="orange">{contactStaleCount} of {lead.contacts?.length} contacts need re-verification</Text>
          )}
        </Group>
        {/* Decision-maker status is a flag on a contact (isDecisionMaker), not a
            separate top-level block — see lib/contacts.ts, issue #45. Every
            contact renders the same way; the flag only adds a badge. */}
        {(lead.contacts || []).length === 0 && <Text size="sm" c="dimmed">—</Text>}
        {(lead.contacts || []).map((contact, i) => (
          <Box key={i}>
            <Group gap="xs">
              <Text fw={600}>{contact.name || contact.title || 'Contact'}</Text>
              {contact.isDecisionMaker && <Badge variant="light" size="xs" color="blue">Decision Maker</Badge>}
              {isContactStale(contact, DEFAULT_STALENESS_THRESHOLD_DAYS) && (
                <Badge variant="light" size="xs" color="orange">Needs re-verification</Badge>
              )}
            </Group>
            {contact.title && (
              <Group gap={4} wrap="nowrap">
                <Text size="sm" c="dimmed">{contact.title}</Text>
                {contact.seniorityTier && contact.seniorityTier !== 'Unknown' && (
                  <Badge variant="light" size="xs" color="grape">{contact.seniorityTier}</Badge>
                )}
                {contact.department && contact.department !== 'Unknown' && (
                  <Badge variant="outline" size="xs" color="gray">{contact.department}</Badge>
                )}
              </Group>
            )}
            {contact.email && (
              <Group gap={4} wrap="nowrap">
                <Text size="sm" c="dimmed" component="a" href={`mailto:${contact.email.trim()}`}>{contact.email}</Text>
                {emailStatusBadge(contact.emailVerificationStatus)}
              </Group>
            )}
            {contact.phone && <Text size="sm" c="dimmed" component="a" href={`tel:${contact.phone.trim()}`}>{contact.phone}</Text>}
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
        onChange={(value: string | null) => value && setDeclineReason(value as DeclineReason)}
        data={DECLINE_REASONS.map((r) => ({ value: r.value, label: r.label }))}
      />
      <AdminTextarea
        name="annotation"
        label="Annotation"
        description="Add notes, reasoning, or context for your action…"
        value={annotation}
        onChange={(value: string) => setAnnotation(value)}
        rows={3}
      />
    </Stack>
  );

  return (
    <>
      {fullScreen ? (
        <AdminModal opened={opened} onClose={onClose} title={lead.entity_name} description={lead.industry || lead.sport_or_sector || undefined} size="full" actions={actions}>
          <Stack gap="md">{content}</Stack>
        </AdminModal>
      ) : (
        <AdminDetailDrawer opened={opened} onClose={onClose} title={lead.entity_name} description={lead.industry || lead.sport_or_sector || undefined} metadata={metadata} actions={actions}>
          {content}
        </AdminDetailDrawer>
      )}
      <OutreachComposeModal opened={outreachOpen} onClose={() => setOutreachOpen(false)} lead={lead} brand={brand} />
    </>
  );
}
