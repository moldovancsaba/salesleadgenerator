'use client';

import { useState } from 'react';
import { ActionIcon, Avatar, Box, Button, Group, Stack, Text } from '@mantine/core';
import { StatusBadge, LabelTag, CountBadge } from '@sovereignsquad/gds-core/client';
import {
  IconChevronDown,
  IconChevronUp,
  IconUser,
  IconArrowUpRight,
  IconCheck,
  IconX,
  IconMail,
  IconPhone,
} from '@tabler/icons-react';
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
import { computeDealHealth } from '@/lib/deal-health';
import { shouldShowWinProbability } from '@/lib/card-tiering';
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
  onAction?: (leadId: string, action: string, payload?: Record<string, unknown>) => Promise<void>;
  onQuickEmail?: (lead: Lead) => void;
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
// a bare crisp number is exactly the AGENTS.md Rule 7 violation issue #80
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
  // firmographic model's own output — AGENTS.md Rule 7 requires the caption
  // say so, never call it "modelled" once a rep has directly overridden it.
  if (ticketSize.method === 'manual_override') return 'Manually overridden';
  // sizeAssumed (issue #112): the smallest configured deal-size band, used
  // as a conservative placeholder because this lead's size isn't set — the
  // card must not caption this as "Modelled estimate," which would imply
  // the model actually knows this lead's size.
  if (ticketSize.sizeAssumed) return 'Smallest tier (size unknown)';
  return 'Modelled estimate';
}

function formatSectorLabel(raw: unknown): string | null {
  if (!raw) return null;
  const str = Array.isArray(raw) ? raw.join(', ') : typeof raw === 'string' ? raw : String(raw);
  if (!str.trim()) return null;
  return str
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      s
        .replace(/[-_]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
    )
    .join(' · ');
}

export function LeadCard({
  lead,
  onOpen,
  staleness,
  nudge,
  winProbability,
  tourTarget,
  onAction,
  onQuickEmail,
}: LeadCardProps) {
  const [actionRunning, setActionRunning] = useState(false);
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
  const dealHealth = computeDealHealth(lead, now);
  const createdLabel = formatRelativeDays(lead.createdAt, now);
  const updatedLabel = formatRelativeDays(lead.updatedAt, now);

  const isTerminalColumn = lead.kanbanColumn === 'WON' || lead.kanbanColumn === 'LOST';
  const isReviewColumn = lead.kanbanColumn === 'DISCOVERED' || lead.kanbanColumn === 'QUALIFIED';
  const dueAt = lead.nextActionDueAt ? new Date(lead.nextActionDueAt) : null;
  const dueValid = dueAt && !Number.isNaN(dueAt.getTime());
  const dueDays = dueValid ? Math.floor((dueAt!.getTime() - now.getTime()) / 86_400_000) : null;

  // Prefer the contact flagged isDecisionMaker (lib/contacts.ts); fall back to
  // the first contact so the row isn't always '—' before data gets flagged.
  const decisionMaker = getDecisionMakerContact(lead.contacts);
  const rawPrimary = decisionMaker || (Array.isArray(lead.contacts) ? lead.contacts[0] : null);
  const primaryContact = rawPrimary && typeof rawPrimary === 'object' ? rawPrimary : null;
  const rawName = primaryContact && typeof primaryContact.name === 'string' ? primaryContact.name.trim() : '';
  const contactName = rawName || '—';
  const rawTitle = primaryContact && typeof primaryContact.title === 'string' ? primaryContact.title.trim() : '';
  const rawRole = primaryContact && typeof primaryContact.role === 'string' ? primaryContact.role.trim() : '';
  const contactTitle = rawTitle || rawRole || '';
  const primaryEmail = primaryContact?.email && typeof primaryContact.email === 'string' ? primaryContact.email.trim() : null;

  const rawOwner = typeof lead.assignedToEmail === 'string' && lead.assignedToEmail.trim()
    ? lead.assignedToEmail.split('@')[0]
    : typeof lead.assignedTo === 'string' && lead.assignedTo.trim()
      ? lead.assignedTo
      : 'Unassigned';

  // Format email prefix like "david.klopp" -> "David Klopp"
  const ownerLabel = typeof rawOwner === 'string' && rawOwner.includes('.')
    ? rawOwner.split('.').filter(Boolean).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')
    : String(rawOwner || 'Unassigned');

  const ownerInitials = ownerLabel === 'Unassigned'
    ? '?'
    : ownerLabel
        .split(' ')
        .filter(Boolean)
        .map((s) => s.charAt(0).toUpperCase())
        .slice(0, 2)
        .join('') || '?';

  const tier0Metadata = [
    { label: 'Region', value: region },
    { label: hasDeals ? 'Deal value' : 'Ticket size', value: hasDeals ? formatCompactCurrency(dealsTotal, dealCurrency) : ticketSizeLabel },
    { label: 'Owner', value: ownerLabel },
  ];
  const tier1Metadata = [
    { label: 'ICE', value: ice },
    { label: 'Size', value: lead.size || '—' },
    { label: 'Contact', value: contactName },
  ];
  if (shouldShowWinProbability(isTerminalColumn, winProbability)) {
    tier1Metadata.push({ label: 'Win probability', value: `${Math.round(winProbability as number * 100)}%` });
  }

  // Tier 1 always has at least ICE/Size/Contact (unconditional fixed
  // fields), so the expand affordance always has something to show —
  // no presence check needed here.
  const [expanded, setExpanded] = useState(false);

  const handleCardClick = () => {
    if (onOpen) onOpen();
  };

  return (
    <ErrorBoundary>
      <Stack
        gap={6}
        data-tour={tourTarget ? TOUR_SELECTOR.leadCard : undefined}
        onClick={handleCardClick}
        style={{ cursor: onOpen ? 'pointer' : 'default', width: '100%' }}
      >
        {/* Primary Identifier: Full-width unconstrained lead entity name */}
        <Box style={{ minWidth: 0, width: '100%' }}>
          <Text
            fw={700}
            size="sm"
            title={lead.entity_name}
            style={{
              lineHeight: 1.35,
              wordBreak: 'break-word',
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              color: 'var(--gds-text-primary)',
            }}
          >
            {lead.entity_name}
          </Text>
          {(lead.industry || lead.sport_or_sector) && (
            <Text size="xs" c="dimmed" truncate style={{ marginTop: 1 }}>
              {formatSectorLabel(lead.industry || lead.sport_or_sector)}
            </Text>
          )}
        </Box>

        {/* Primary Contact: Prominently identifies the human counterparty with quick actions */}
        <Group justify="space-between" align="center" wrap="nowrap" style={{ minWidth: 0, marginTop: 1 }}>
          <Group gap={4} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <IconUser size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
            {contactName !== '—' ? (
              <Text size="xs" fw={500} truncate title={contactTitle ? `${contactName} (${contactTitle})` : contactName}>
                {contactName}
                {contactTitle && (
                  <Text component="span" size="xs" c="dimmed" fw={400}>
                    {` · ${contactTitle}`}
                  </Text>
                )}
              </Text>
            ) : (
              <Text size="xs" c="dimmed" fs="italic">
                No contact assigned
              </Text>
            )}
          </Group>
          {primaryEmail ? (
            <ActionIcon
              size="xs"
              variant="subtle"
              color="indigo"
              aria-label={`Email ${contactName}`}
              title={`Email ${contactName} (${primaryEmail})`}
              onClick={(e) => {
                e.stopPropagation();
                if (onQuickEmail) onQuickEmail(lead);
                else window.location.href = `mailto:${primaryEmail}`;
              }}
            >
              <IconMail size={12} />
            </ActionIcon>
          ) : (
            contactName === '—' && (
              <Button
                size="compact-xs"
                variant="subtle"
                color="gray"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen?.();
                }}
              >
                + Contact
              </Button>
            )
          )}
        </Group>

        {/* Commercial Metric & Context Attribute Badges */}
        <Group gap={5} wrap="wrap" align="center">
          {hasDeals ? (
            <LabelTag
              tone="info"
              size="sm"
              label={formatCompactCurrency(dealsTotal, dealCurrency)}
              aria-label={`Deal value: ${formatCompactCurrency(dealsTotal, dealCurrency)}`}
            />
          ) : ticketSizeLabel !== '—' && (
            <LabelTag
              tone="info"
              size="sm"
              label={ticketSizeLabel}
              aria-label={`Ticket size estimate: ${ticketSizeLabel}`}
            />
          )}

          {region && region !== 'NA' && (
            <LabelTag tone="neutral" size="sm" label={region} />
          )}

          {showQualityBadge && (
            <StatusBadge
              status={quality === 'VERIFIED' ? 'success' : quality === 'CHECKED' ? 'info' : 'neutral'}
              size="xs"
            >
              {quality}
            </StatusBadge>
          )}

          {!isTerminalColumn && (
            <StatusBadge
              status={
                dealHealth.tier === 'healthy'
                  ? 'success'
                  : dealHealth.tier === 'at_risk'
                    ? 'warning'
                    : 'danger'
              }
              size="xs"
              aria-label={`Deal health: ${dealHealth.label}`}
            >
              {`HP ${dealHealth.score}`}
            </StatusBadge>
          )}

          {/* Urgency Alert & Follow-up Indicator */}
          {dueValid && dueDays !== null && dueDays <= 0 ? (
            <StatusBadge
              status={dueDays < 0 ? 'danger' : 'warning'}
              withIcon
              size="xs"
              aria-label={dueDays < 0 ? `${Math.abs(dueDays)} days overdue` : 'Action due today'}
            >
              {dueDays < 0 ? `${Math.abs(dueDays)}d overdue` : 'Due today'}
            </StatusBadge>
          ) : null}

          {/* Stale / Urgency Indicator — de-duplicated so days are never displayed twice */}
          {staleness ? (
            <StatusBadge
              status={staleness.severity === 'critical' ? 'danger' : 'warning'}
              withIcon
              size="xs"
              aria-label={`Stale for ${staleness.daysSince} days, threshold ${staleness.thresholdDays} days`}
            >
              {`${staleness.severity === 'critical' ? 'Critical' : 'Stale'} · ${staleness.daysSince}d`}
            </StatusBadge>
          ) : rotten ? (
            rotten.level === 'green' ? null : (
              <StatusBadge
                status={rotten.level === 'red' ? 'danger' : 'warning'}
                size="xs"
                aria-label={`Last touched ${rotten.daysSince} days ago`}
              >
                {`${rotten.daysSince}d`}
              </StatusBadge>
            )
          ) : null}
        </Group>

        {/* Owner & Follow-up/Activity Meta */}
        <Group
          justify="space-between"
          align="center"
          wrap="nowrap"
          pt={4}
          style={{ borderTop: '1px solid var(--gds-border-card)' }}
        >
          <Group gap={6} wrap="nowrap" style={{ minWidth: 0, flex: 1 }}>
            <Avatar
              size={18}
              radius="xl"
              color={ownerLabel === 'Unassigned' ? 'gray' : 'blue'}
              style={{ fontSize: 9, fontWeight: 700, flexShrink: 0 }}
            >
              {ownerInitials}
            </Avatar>
            <Text size="xs" fw={500} truncate title={`Owner: ${ownerLabel}`}>
              {ownerLabel}
            </Text>
          </Group>
          <Text
            size="xs"
            c={dueDays !== null && dueDays <= 0 ? (dueDays < 0 ? 'red' : 'orange') : 'dimmed'}
            style={{ flexShrink: 0 }}
          >
            {dueValid && dueDays !== null
              ? (dueDays < 0 ? `${Math.abs(dueDays)}d overdue` : dueDays === 0 ? 'Due today' : `Due in ${dueDays}d`)
              : (updatedLabel || createdLabel || '')}
          </Text>
        </Group>

        {/* Action Bar: Progressive Disclosure Toggle & Direct Open */}
        <Group justify="space-between" align="center" wrap="nowrap" pt={2} style={{ borderTop: '1px solid var(--gds-border-card)' }}>
          <Group
            gap={4}
            wrap="nowrap"
            style={{ cursor: 'pointer', userSelect: 'none', flexShrink: 0 }}
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
          >
            <ActionIcon
              size="xs"
              variant="subtle"
              color="gray"
              aria-label={expanded ? 'Show less' : 'Show more'}
              aria-expanded={expanded}
            >
              {expanded ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            </ActionIcon>
            <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
              {expanded ? 'Show less' : 'Show more'}
            </Text>
          </Group>

          {onOpen && (
            <Button
              variant="subtle"
              size="compact-xs"
              color="gray"
              className="card-action-open"
              onClick={(e) => {
                e.stopPropagation();
                onOpen();
              }}
              data-tour={tourTarget ? TOUR_SELECTOR.leadDetailOpen : undefined}
              rightSection={<IconArrowUpRight size={12} />}
            >
              Open
            </Button>
          )}
        </Group>

        {/* Semantic Stage Decisions: Accept / Decline in Review columns, or Quick Email in active pipeline */}
        {isReviewColumn && onAction ? (
          <Group gap={6} grow wrap="nowrap" pt={1}>
            <Button
              size="compact-xs"
              color="teal"
              variant="light"
              className="card-action-accept"
              leftSection={<IconCheck size={12} />}
              loading={actionRunning}
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  setActionRunning(true);
                  await onAction(lead._id, 'ACCEPT');
                } catch {
                  // notification handled upstream
                } finally {
                  setActionRunning(false);
                }
              }}
            >
              Accept
            </Button>
            <Button
              size="compact-xs"
              color="red"
              variant="subtle"
              className="card-action-decline"
              leftSection={<IconX size={12} />}
              loading={actionRunning}
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  setActionRunning(true);
                  await onAction(lead._id, 'DECLINE');
                } catch {
                  // notification handled upstream
                } finally {
                  setActionRunning(false);
                }
              }}
            >
              Decline
            </Button>
          </Group>
        ) : !isTerminalColumn && primaryEmail ? (
          <Box pt={1}>
            <Button
              fullWidth
              size="compact-xs"
              color="indigo"
              variant="light"
              className="card-action-email"
              leftSection={<IconMail size={12} />}
              onClick={(e) => {
                e.stopPropagation();
                if (onQuickEmail) onQuickEmail(lead);
                else window.location.href = `mailto:${primaryEmail}`;
              }}
            >
              Email
            </Button>
          </Box>
        ) : null}

        {/* Progressive Disclosure (Tier 1 Metadata) */}
        {expanded && (
          <Stack gap={4} pt={4} style={{ borderTop: '1px dashed var(--gds-border-card)' }}>
            <Stack gap={2}>
              {tier1Metadata.map((m) => (
                <Group key={m.label} justify="space-between" gap="xs" wrap="nowrap">
                  <Text size="xs" c="dimmed">{m.label}</Text>
                  <Text size="xs" fw={500} truncate style={{ minWidth: 0 }}>{m.value}</Text>
                </Group>
              ))}
            </Stack>

            {(() => {
              const validTags = Array.isArray(lead.tags)
                ? lead.tags.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
                : [];
              if (validTags.length === 0) return null;
              return (
                <Group gap={4} wrap="wrap" role="list" aria-label="Tags" mt={2}>
                  {validTags.slice(0, 3).map((tag) => (
                    <Box component="span" role="listitem" key={tag}>
                      <LabelTag tone="neutral" size="xs" label={tag} />
                    </Box>
                  ))}
                  {validTags.length > 3 && (
                    <LabelTag tone="neutral" size="xs" label={`+${validTags.length - 3}`} />
                  )}
                </Group>
              );
            })()}

            {ticketSizeCaption && !hasDeals && (
              <Text size="xs" c="dimmed" fs="italic">{ticketSizeCaption}</Text>
            )}

            {checklist.total > 0 && (
              <Text size="xs" c={checklist.done === checklist.total ? 'teal' : 'dimmed'}>
                {`Checklist ${checklist.done}/${checklist.total}`}
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
          </Stack>
        )}
      </Stack>
    </ErrorBoundary>
  );
}
