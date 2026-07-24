'use client';

import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import type { Lead } from './types';
import { getIceScore, getTicketSize } from './constants';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';

type LeadCardProps = {
  lead: Lead;
  onOpen?: () => void;
};

// Deliberately flat, borderless content — no ProductCard/Paper wrapper here.
// GDS's own KanbanCard already renders a bordered Paper shell around whatever
// renderItem returns (plus its drag handle and Move menu icons); nesting
// ProductCard's own `withBorder` shell inside that produced a visible
// "box within a box" around every kanban card.
export function LeadCard({ lead, onOpen }: LeadCardProps) {
  const ice = getIceScore(lead);
  const region = lead.region || 'NA';
  const quality = lead.qualityStatus || 'DRAFT';
  const ticketSize = getTicketSize(lead);
  const ticketSizeLabel = ticketSize
    ? `${ticketSize.currency === 'USD' ? '$' : '€'}${Math.round(ticketSize.value).toLocaleString()}`
    : null;

  // Fixed field set, every row always rendered ('—' when absent) — matches
  // app/detail.tsx's existing placeholder convention, so every card has the
  // same shape instead of the row set varying by which fields a lead happens
  // to have populated.
  const metadata = [
    { label: 'Region', value: region },
    { label: 'ICE', value: ice },
    { label: 'Ticket size', value: ticketSizeLabel || '—' },
    { label: 'Size', value: lead.size || '—' },
    { label: 'Contact', value: lead.decision_maker_name || '—' },
  ];

  return (
    <ErrorBoundary>
      <Stack gap={4}>
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Text fw={700} size="sm" truncate style={{ minWidth: 0 }}>{lead.entity_name}</Text>
          <Badge variant="light" size="sm" style={{ flexShrink: 0 }}>{quality}</Badge>
        </Group>
        {(lead.industry || lead.sport_or_sector) && (
          <Text size="xs" c="dimmed">{lead.industry || lead.sport_or_sector}</Text>
        )}
        <Stack gap={2}>
          {metadata.map((m) => (
            <Group key={m.label} justify="space-between" gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed">{m.label}</Text>
              <Text size="xs" fw={500} truncate style={{ minWidth: 0 }}>{m.value}</Text>
            </Group>
          ))}
        </Stack>
        {onOpen && (
          <Button variant="light" size="xs" onClick={onOpen} mt={4}>
            Preview
          </Button>
        )}
      </Stack>
    </ErrorBoundary>
  );
}
