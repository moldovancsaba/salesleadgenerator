'use client';

import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import type { Lead } from './types';
import { getIceScore, getTicketSize } from './constants';
import type { TicketSizeDisplay } from './constants';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { getDecisionMakerContact } from '@/lib/contacts';
import type { StaleDealResult } from '@/lib/stale-deal';
import type { Nudge } from '@/lib/next-step-nudge';

type LeadCardProps = {
  lead: Lead;
  onOpen?: () => void;
  staleness?: StaleDealResult | null;
  nudge?: Nudge | null;
};

// Deliberately flat, borderless content — no ProductCard/Paper wrapper here.
// GDS's own KanbanCard already renders a bordered Paper shell around whatever
// renderItem returns (plus its drag handle and Move menu icons); nesting
// ProductCard's own `withBorder` shell inside that produced a visible
// "box within a box" around every kanban card.
// Space-constrained card display: an abbreviated "~$180K"-style value, never
// a full-precision figure — the card has no room for a low-high range, and
// a bare crisp number is exactly the CLAUDE.md Rule 7 violation issue #80
// exists to fix (an unvalidated $8,000,000,000 estimate reading as fact).
// The full range/method/confidence lives in the detail drawer instead.
function formatCompactTicketSize(value: number, currency: 'USD' | 'EUR'): string {
  const symbol = currency === 'USD' ? '$' : '€';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${Math.round(value / 1000)}K`;
  return `${symbol}${Math.round(value)}`;
}

function ticketSizeCardLabel(ticketSize: TicketSizeDisplay): string {
  if (!ticketSize) return '—';
  if (ticketSize.kind === 'unconfigured') return 'Not configured';
  if (ticketSize.kind === 'estimate') return `~${formatCompactTicketSize(ticketSize.expected, ticketSize.currency)}`;
  // 'legacy' — a pre-#79 lead not yet backfilled (issue #81); still marked
  // with "~" and "unverified" rather than shown as a bare trusted figure.
  return `~${formatCompactTicketSize(ticketSize.value, ticketSize.currency)}`;
}

function ticketSizeCardCaption(ticketSize: TicketSizeDisplay): string | null {
  if (!ticketSize || ticketSize.kind === 'unconfigured') return null;
  if (ticketSize.kind === 'legacy') return 'Unverified estimate';
  // A human override (issue #86) is a different kind of trust than the
  // firmographic model's own output — CLAUDE.md Rule 7 requires the caption
  // say so, never call it "modelled" once a rep has directly overridden it.
  if (ticketSize.method === 'manual_override') return 'Manually overridden';
  return 'Modelled estimate';
}

export function LeadCard({ lead, onOpen, staleness, nudge }: LeadCardProps) {
  const ice = getIceScore(lead);
  const region = lead.region || 'NA';
  const quality = lead.qualityStatus || 'DRAFT';
  const ticketSize = getTicketSize(lead);
  const ticketSizeLabel = ticketSizeCardLabel(ticketSize);
  const ticketSizeCaption = ticketSizeCardCaption(ticketSize);

  // Prefer the contact flagged isDecisionMaker (lib/contacts.ts); fall back to
  // the first contact so the row isn't always '—' before data gets flagged.
  const contactName = getDecisionMakerContact(lead.contacts)?.name || lead.contacts?.[0]?.name || '—';

  // Fixed field set, every row always rendered ('—' when absent) — matches
  // app/detail.tsx's existing placeholder convention, so every card has the
  // same shape instead of the row set varying by which fields a lead happens
  // to have populated.
  const metadata = [
    { label: 'Region', value: region },
    { label: 'ICE', value: ice },
    { label: 'Ticket size', value: ticketSizeLabel },
    { label: 'Size', value: lead.size || '—' },
    { label: 'Contact', value: contactName },
  ];

  return (
    <ErrorBoundary>
      <Stack gap={4}>
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Text fw={700} size="sm" truncate style={{ minWidth: 0 }}>{lead.entity_name}</Text>
          <Badge variant="light" size="sm" style={{ flexShrink: 0 }}>{quality}</Badge>
        </Group>
        {staleness && (
          <Group gap={4} wrap="nowrap">
            <Badge
              variant="light"
              color={staleness.severity === 'critical' ? 'red' : 'yellow'}
              size="sm"
              aria-label={`Stale for ${staleness.daysSince} days, threshold ${staleness.thresholdDays} days`}
            >
              {`⚠ ${staleness.severity === 'critical' ? 'Critical' : 'Stale'} · ${staleness.daysSince}d`}
            </Badge>
          </Group>
        )}
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
        {ticketSizeCaption && (
          <Text size="xs" c="dimmed" fs="italic">{ticketSizeCaption}</Text>
        )}
        {nudge && (
          <Text size="xs" c={nudge.severity === 'warn' ? 'orange' : 'dimmed'}>
            {nudge.message}
          </Text>
        )}
        {onOpen && (
          <Button variant="light" size="xs" onClick={onOpen} mt={4}>
            Preview
          </Button>
        )}
      </Stack>
    </ErrorBoundary>
  );
}
