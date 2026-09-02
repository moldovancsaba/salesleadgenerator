'use client';

import { Badge, Button, Group, Stack, Text } from '@mantine/core';
import type { Lead } from './types';
import type { CurrencyCode } from './lib/brand';
import { getIceScore, getTicketSize } from './constants';
import type { TicketSizeDisplay } from './constants';
import { ErrorBoundary } from '@/app/components/ErrorBoundary';
import { getDecisionMakerContact } from '@/lib/contacts';
import type { StaleDealResult } from '@/lib/stale-deal';
import type { Nudge } from '@/lib/next-step-nudge';
import { sumDeals } from '@/lib/deals';
import { checklistProgress } from '@/lib/checklist';
import { computeRottenLevel } from '@/lib/rotten-indicator';
import { TOUR_SELECTOR } from './lib/tour/selectors';

type LeadCardProps = {
  lead: Lead;
  onOpen?: () => void;
  staleness?: StaleDealResult | null;
  nudge?: Nudge | null;
  // Per-column close probability (issue #118) — an aggregate, forecast-level
  // figure (lib/pipeline-weights.ts / win-rate calibration), not a per-lead
  // computed field, so it arrives as a prop rather than being derived from
  // `lead` here. undefined/null means the caller has no forecast data loaded
  // (e.g. Forecast section collapsed) — the row is simply omitted then.
  winProbability?: number | null;
  // Issue #185 — true for exactly one card (the first item of the first
  // non-empty column, chosen in app/kanban.tsx's renderItem) so the
  // onboarding tour has a single real, stable element to spotlight — every
  // other rendered LeadCard instance leaves this undefined.
  tourTarget?: boolean;
  // Inline Accept/Decline (2026-09-02) — undefined (not just omitted) when the
  // caller has no onAction handler wired up, same optional-callback contract
  // onOpen already uses, so a card rendered without board-level action support
  // silently shows no buttons rather than a dead one.
  onAccept?: () => void;
  onDecline?: () => void;
  actionBusy?: boolean;
};

const CURRENCY_SYMBOL: Record<string, string> = { USD: '$', EUR: '€' };

function formatCompactCurrency(value: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency] || '$';
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${symbol}${Math.round(value / 1000)}K`;
  return `${symbol}${Math.round(value)}`;
}

// Compact "3d ago" / "today" relative-time label — mirrors
// formatCompactTicketSize's own "no room for full precision on a kanban
// card" rationale below. Full absolute date+time lives in Lead Details
// (app/detail.tsx) instead; this label also carries a `title` tooltip with
// the absolute value for anyone who hovers.
function formatRelativeDays(iso: string | undefined, now: Date): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return '1d ago';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

const ROTTEN_COLOR: Record<'green' | 'yellow' | 'red', string> = { green: 'green', yellow: 'yellow', red: 'red' };

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
function formatCompactTicketSize(value: number, currency: CurrencyCode): string {
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
  // sizeAssumed (issue #112): the smallest configured deal-size band, used
  // as a conservative placeholder because this lead's size isn't set — the
  // card must not caption this as "Modelled estimate," which would imply
  // the model actually knows this lead's size.
  if (ticketSize.sizeAssumed) return 'Smallest tier (size unknown)';
  return 'Modelled estimate';
}

export function LeadCard({ lead, onOpen, staleness, nudge, winProbability, tourTarget, onAccept, onDecline, actionBusy }: LeadCardProps) {
  const ice = getIceScore(lead);
  const region = lead.region || 'NA';
  const quality = lead.qualityStatus || 'DRAFT';
  // Issue #115: DRAFT is only shown in DISCOVERED/QUALIFIED (auto-managed
  // columns a lead hasn't been manually worked yet) — CHECKED/VERIFIED
  // always render, in every column, unchanged. Uses lead.kanbanColumn
  // directly rather than a separate `column` prop: it's the same field
  // app/kanban.tsx's renderItem already trusts for staleness/nudge
  // computation on this exact lead, so a second prop would just be a second
  // name for the same value.
  const showQualityBadge = quality !== 'DRAFT' || lead.kanbanColumn === 'DISCOVERED' || lead.kanbanColumn === 'QUALIFIED';
  const ticketSize = getTicketSize(lead);
  const ticketSizeLabel = ticketSizeCardLabel(ticketSize);
  const ticketSizeCaption = ticketSizeCardCaption(ticketSize);

  const dealsTotal = sumDeals(lead.deals);
  const hasDeals = (lead.deals?.length ?? 0) > 0;
  const dealCurrency = lead.deals?.[0]?.currency || 'USD';

  const checklist = checklistProgress(lead.checklist);

  const now = new Date();
  const rotten = computeRottenLevel({ kanbanColumn: lead.kanbanColumn, updatedAt: lead.updatedAt }, now);
  const createdLabel = formatRelativeDays(lead.createdAt, now);
  const updatedLabel = formatRelativeDays(lead.updatedAt, now);

  const isTerminalColumn = lead.kanbanColumn === 'WON' || lead.kanbanColumn === 'LOST';
  const dueAt = lead.nextActionDueAt ? new Date(lead.nextActionDueAt) : null;
  const dueValid = dueAt && !Number.isNaN(dueAt.getTime());
  const dueDays = dueValid ? Math.floor((dueAt!.getTime() - now.getTime()) / 86_400_000) : null;

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
    { label: hasDeals ? 'Deal value' : 'Ticket size', value: hasDeals ? formatCompactCurrency(dealsTotal, dealCurrency) : ticketSizeLabel },
    { label: 'Size', value: lead.size || '—' },
    { label: 'Contact', value: contactName },
  ];
  if (!isTerminalColumn && typeof winProbability === 'number' && Number.isFinite(winProbability)) {
    metadata.push({ label: 'Win probability', value: `${Math.round(winProbability * 100)}%` });
  }

  return (
    <ErrorBoundary>
      <Stack gap={4} data-tour={tourTarget ? TOUR_SELECTOR.leadCard : undefined}>
        <Group justify="space-between" align="flex-start" wrap="nowrap" gap="xs">
          <Text fw={700} size="sm" truncate style={{ minWidth: 0 }}>{lead.entity_name}</Text>
          <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
            {rotten && (
              <Badge
                variant="dot"
                color={ROTTEN_COLOR[rotten.level]}
                size="sm"
                aria-label={`Last touched ${rotten.daysSince} days ago`}
              >
                {`${rotten.daysSince}d`}
              </Badge>
            )}
            {showQualityBadge && <Badge variant="light" size="sm">{quality}</Badge>}
            {/* Additive, not a replacement for the quality badge above
                (owner-confirmed via AskUserQuestion, issue #115) — a lead
                can show both DRAFT and DEAL at once. */}
            {hasDeals && <Badge variant="filled" color="grape" size="sm">DEAL</Badge>}
          </Group>
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
        {(lead.tags?.length ?? 0) > 0 && (
          <Group gap={4} wrap="wrap" role="list" aria-label="Tags">
            {lead.tags!.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="outline" color="gray" size="xs" role="listitem">{tag}</Badge>
            ))}
            {lead.tags!.length > 3 && (
              <Badge variant="outline" color="gray" size="xs">{`+${lead.tags!.length - 3}`}</Badge>
            )}
          </Group>
        )}
        <Stack gap={2}>
          {metadata.map((m) => (
            <Group key={m.label} justify="space-between" gap="xs" wrap="nowrap">
              <Text size="xs" c="dimmed">{m.label}</Text>
              <Text size="xs" fw={500} truncate style={{ minWidth: 0 }}>{m.value}</Text>
            </Group>
          ))}
        </Stack>
        {ticketSizeCaption && !hasDeals && (
          <Text size="xs" c="dimmed" fs="italic">{ticketSizeCaption}</Text>
        )}
        {checklist.total > 0 && (
          <Text size="xs" c={checklist.done === checklist.total ? 'teal' : 'dimmed'}>
            {`Checklist ${checklist.done}/${checklist.total}`}
          </Text>
        )}
        {dueValid && (
          <Text size="xs" c={dueDays !== null && dueDays < 0 ? 'red' : dueDays === 0 ? 'orange' : 'dimmed'}>
            {dueDays !== null && dueDays < 0
              ? `Follow-up ${Math.abs(dueDays)}d overdue`
              : dueDays === 0
                ? 'Follow-up due today'
                : `Follow-up in ${dueDays}d`}
          </Text>
        )}
        {nudge && (
          <Text size="xs" c={nudge.severity === 'warn' ? 'orange' : 'dimmed'}>
            {nudge.message}
          </Text>
        )}
        {(createdLabel || updatedLabel) && (
          <Text size="xs" c="dimmed" title={`Created ${lead.createdAt ? new Date(lead.createdAt).toLocaleString() : '—'} · Updated ${lead.updatedAt ? new Date(lead.updatedAt).toLocaleString() : '—'}`}>
            {createdLabel && `Created ${createdLabel}`}{createdLabel && updatedLabel && ' · '}{updatedLabel && `Updated ${updatedLabel}`}
          </Text>
        )}
        {(onOpen || onAccept || onDecline) && (
          <Group gap={4} mt={4}>
            {onOpen && (
              <Button variant="light" size="xs" onClick={onOpen} data-tour={tourTarget ? TOUR_SELECTOR.leadDetailOpen : undefined}>
                Open
              </Button>
            )}
            {onAccept && (
              <Button variant="light" size="xs" color="green" onClick={onAccept} loading={actionBusy} aria-label={`Accept ${lead.entity_name}`}>
                Accept
              </Button>
            )}
            {onDecline && (
              <Button variant="light" size="xs" color="red" onClick={onDecline} loading={actionBusy} aria-label={`Decline ${lead.entity_name}`}>
                Decline
              </Button>
            )}
          </Group>
        )}
      </Stack>
    </ErrorBoundary>
  );
}
