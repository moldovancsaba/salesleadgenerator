'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Modal, Stack, Group, Text, Button, Paper, Badge, Divider, Loader } from '@mantine/core';
import { showNotification } from '@mantine/notifications';
import { useIsCompactViewport } from '../lib/use-is-compact-viewport';

// Issue #130 — the "Merge" action's actual UI, opened from a confirmed pair
// in /admin/duplicates. One responsive component with two layout modes
// (desktop: all conflicts in a scrollable list; mobile/PWA: one conflict per
// screen), matching this app's established pattern of a single component
// branching on useIsCompactViewport() rather than two separate
// implementations — see docs/ARCHITECTURE.md's "Duplicate Lead Merge"
// section for the framing note this follows.

type FieldClassification =
  | { kind: 'auto-union'; field: string; mergedValue: unknown }
  | { kind: 'auto-resolved'; field: string; mergedValue: unknown; rule: string }
  | { kind: 'fill-from-one-side'; field: string; mergedValue: unknown; source: 'A' | 'B' }
  | { kind: 'conflict'; field: string; valueA: unknown; valueB: unknown };

type PreviewLead = { id: string; entity_name: string; url?: string; kanbanColumn: string; updatedAt?: string };

type Preview = {
  reviewId: string;
  status: string;
  leadA: PreviewLead;
  leadB: PreviewLead;
  suggestedPrimaryId: string;
  classifications: FieldClassification[];
};

type Props = {
  reviewId: string | null;
  opened: boolean;
  onClose: () => void;
  onMerged: () => void;
};

// Auto-union fields worth calling out to the operator by name — anything
// else that auto-merges (bucket 2/3 in lib/lead-merge.ts) is routine
// bookkeeping, not worth a line in the summary.
const AUTO_UNION_LABELS: Record<string, string> = {
  contacts: 'contact',
  tags: 'tag',
  deals: 'deal',
  checklist: 'checklist item',
};

function formatFieldLabel(field: string): string {
  if (field.startsWith('qualification.')) {
    return `Qualification — ${formatFieldLabel(field.slice('qualification.'.length))}`;
  }
  if (field.startsWith('pricingByCompany.')) {
    return `Pricing — ${field.slice('pricingByCompany.'.length)}`;
  }
  return field
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase());
}

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '(empty)';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function buildAutoSummary(classifications: FieldClassification[]): string | null {
  const parts: string[] = [];
  for (const c of classifications) {
    if (c.kind !== 'auto-union') continue;
    const label = AUTO_UNION_LABELS[c.field];
    if (!label || !Array.isArray(c.mergedValue) || c.mergedValue.length === 0) continue;
    const count = c.mergedValue.length;
    parts.push(`${count} ${label}${count === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return null;
  return `${parts.join(', ')} will be combined automatically.`;
}

export function MergeConflictModal({ reviewId, opened, onClose, onMerged }: Props) {
  const compact = useIsCompactViewport();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, 'A' | 'B'>>({});
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!opened || !reviewId) return;
    setLoading(true);
    setError(null);
    setPreview(null);
    setResolutions({});
    setStep(0);
    fetch(`/api/duplicate-reviews/merge?reviewId=${encodeURIComponent(reviewId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Failed to load merge preview (${res.status})`);
        return data as Preview;
      })
      .then((data) => {
        setPreview(data);
        setPrimaryId(data.suggestedPrimaryId);
      })
      .catch((err: any) => setError(err?.message || 'Failed to load merge preview'))
      .finally(() => setLoading(false));
  }, [opened, reviewId]);

  if (!opened) return null;

  const conflicts = (preview?.classifications || []).filter((c): c is Extract<FieldClassification, { kind: 'conflict' }> => c.kind === 'conflict');
  const autoSummary = preview ? buildAutoSummary(preview.classifications) : null;
  const allResolved = conflicts.every((c) => resolutions[c.field] === 'A' || resolutions[c.field] === 'B');

  function pick(field: string, side: 'A' | 'B') {
    setResolutions((prev) => ({ ...prev, [field]: side }));
  }

  async function handleConfirm() {
    if (!preview || !primaryId) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/duplicate-reviews/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewId: preview.reviewId, primaryId, resolutions }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Merge failed (${res.status})`);
      showNotification({ message: 'Leads merged', color: 'green', autoClose: 4000 });
      onMerged();
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Merge failed');
    } finally {
      setSaving(false);
    }
  }

  const primaryPicker = preview && (
    <Stack gap={4}>
      <Text size="sm" fw={600}>Which lead should survive?</Text>
      <Group grow gap="xs">
        {[preview.leadA, preview.leadB].map((lead) => (
          <Paper
            key={lead.id}
            withBorder
            p="xs"
            radius="sm"
            onClick={() => setPrimaryId(lead.id)}
            style={{ cursor: 'pointer', borderColor: primaryId === lead.id ? 'var(--mantine-color-blue-6)' : undefined, borderWidth: primaryId === lead.id ? 2 : 1 }}
          >
            <Stack gap={2}>
              <Group gap={4} wrap="nowrap">
                <Text size="sm" fw={600} lineClamp={1}>{lead.entity_name}</Text>
                {lead.id === preview.suggestedPrimaryId && <Badge size="xs" variant="light" color="blue">Suggested</Badge>}
              </Group>
              <Text size="xs" c="dimmed">{lead.kanbanColumn}</Text>
            </Stack>
          </Paper>
        ))}
      </Group>
    </Stack>
  );

  function conflictRow(c: Extract<FieldClassification, { kind: 'conflict' }>) {
    const selected = resolutions[c.field];
    return (
      <Paper key={c.field} withBorder p="sm" radius="sm">
        <Stack gap="xs">
          <Text size="sm" fw={600}>{formatFieldLabel(c.field)}</Text>
          <Group grow gap="xs">
            <Button variant={selected === 'A' ? 'filled' : 'light'} color="gray" onClick={() => pick(c.field, 'A')} style={{ height: 'auto', whiteSpace: 'normal' }} p="xs">
              {formatFieldValue(c.valueA)}
            </Button>
            <Button variant={selected === 'B' ? 'filled' : 'light'} color="gray" onClick={() => pick(c.field, 'B')} style={{ height: 'auto', whiteSpace: 'normal' }} p="xs">
              {formatFieldValue(c.valueB)}
            </Button>
          </Group>
        </Stack>
      </Paper>
    );
  }

  let body: ReactNode;
  if (loading) {
    body = <Group justify="center" py="xl"><Loader size="sm" /></Group>;
  } else if (error && !preview) {
    body = <Text c="red" size="sm">{error}</Text>;
  } else if (preview) {
    if (conflicts.length === 0) {
      // Zero conflicts — the fully-automatic path. No picker screens at all.
      body = (
        <Stack gap="sm">
          {primaryPicker}
          <Text size="sm" c="dimmed">
            These leads are identical on every field that matters — merging will just
            {autoSummary ? ` ${autoSummary.toLowerCase()}` : ' combine them'} and remove the duplicate.
          </Text>
        </Stack>
      );
    } else if (compact) {
      // Mobile/PWA — one conflict per screen, big tap targets, a progress indicator.
      const current = conflicts[Math.min(step, conflicts.length - 1)];
      body = (
        <Stack gap="sm">
          {primaryPicker}
          <Divider />
          <Text size="xs" c="dimmed">Conflict {step + 1} of {conflicts.length}</Text>
          {conflictRow(current)}
          <Group justify="space-between">
            <Button variant="light" color="gray" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>Back</Button>
            {step < conflicts.length - 1 ? (
              <Button onClick={() => setStep((s) => s + 1)} disabled={!resolutions[current.field]}>Next</Button>
            ) : (
              autoSummary && <Text size="xs" c="dimmed" ta="right" style={{ flex: 1, marginLeft: 8 }}>{autoSummary}</Text>
            )}
          </Group>
        </Stack>
      );
    } else {
      // Desktop — every conflict in one scrollable list.
      body = (
        <Stack gap="sm">
          {primaryPicker}
          <Divider />
          {autoSummary && <Text size="xs" c="dimmed">{autoSummary}</Text>}
          <Stack gap="xs">{conflicts.map(conflictRow)}</Stack>
        </Stack>
      );
    }
  }

  const confirmDisabled = !preview || !primaryId || !allResolved || (compact && conflicts.length > 0 && step < conflicts.length - 1);

  return (
    <Modal opened={opened} onClose={onClose} title="Merge duplicate leads" size={compact ? 'full' : 'lg'} fullScreen={compact} centered>
      <Stack gap="md">
        {body}
        {error && preview && <Text c="red" size="xs">{error}</Text>}
        <Group justify="flex-end" gap="xs">
          <Button variant="light" color="gray" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button color="orange" onClick={handleConfirm} loading={saving} disabled={confirmDisabled}>Confirm Merge</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
