'use client';

import { useState, useEffect } from 'react';
import type { Lead } from './types';
import { AdminModal, AdminDetailDrawer, AdminTextarea, AdminSelect, InfoCard } from '@sovereignsquad/gds-admin/client';
import { createGdsVocabularyPack, GdsIcons, StatusBadge } from '@sovereignsquad/gds-core/client';
import { Stack, Group, Text, Badge, Progress, Button, Box, Title, SimpleGrid, NumberInput, TextInput, Select, Modal, Checkbox, ActionIcon, Divider } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { showNotification } from '@mantine/notifications';
import { normalizeLead, ensureArrayField } from './lib/normalize-lead';
import { PRO_FIELD, CON_FIELD } from './lib/brand';
import { getTicketSize, SIZE_FIELD_OPTIONS } from './constants';
import { isContactStale, DEFAULT_STALENESS_THRESHOLD_DAYS } from '@/lib/contact-freshness';
import { computeStaleness, DEFAULT_STALE_THRESHOLDS } from '@/lib/stale-deal';
import { getNextStepNudge } from '@/lib/next-step-nudge';
import { sumDeals } from '@/lib/deals';
import type { Deal } from '@/lib/deals';
import { ContactsEditor, type ContactRow } from './components/ContactsEditor';
import {
  IconX,
  IconThumbUp,
  IconThumbDown,
  IconPin,
  IconRefresh,
  IconTrash,
  IconMail,
  IconPlus,
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

// Human-readable labels for lib/tech-stack-scan.ts's SIGNATURES ids (issue
// #69) — the accessible name of each badge must be a real label ("Google
// Analytics"), never the raw signature id, per the issue's own a11y spec.
const TECH_SIGNAL_LABELS: Record<string, string> = {
  wordpress: 'WordPress',
  wix: 'Wix',
  squarespace: 'Squarespace',
  webflow: 'Webflow',
  shopify: 'Shopify',
  'google-analytics': 'Google Analytics',
  gtm: 'Google Tag Manager',
  'meta-pixel': 'Meta Pixel',
  hubspot: 'HubSpot',
  nextjs: 'Next.js',
  react: 'React',
  vue: 'Vue.js',
};

// Renders null (section omitted) when no scan has run yet — the issue's own
// UX spec treats "not yet scanned" as absent, not as an empty/failed state.
function techSignalsSection(lead: Lead) {
  if (!lead.techSignalsScanStatus) return null;

  if (lead.techSignalsScanStatus === 'ok' && (lead.techSignals?.length ?? 0) > 0) {
    return (
      <Group gap="xs" role="list" aria-label="Detected tech signals">
        {lead.techSignals!.map((signal) => (
          <Badge key={signal} variant="light" color="teal" role="listitem" aria-label={TECH_SIGNAL_LABELS[signal] || signal}>
            {TECH_SIGNAL_LABELS[signal] || signal}
          </Badge>
        ))}
      </Group>
    );
  }

  if (lead.techSignalsScanStatus === 'ok') {
    return <Text size="sm" c="dimmed">No tech signals detected.</Text>;
  }

  // blocked/timeout/invalid_url/non_html/error — deliberately non-alarming
  // copy, no color signaling: an unreachable or bot-blocking site is an
  // expected, non-actionable outcome per the issue's own UX spec.
  return <Text size="sm" c="dimmed">Scan unavailable</Text>;
}

function formatTicketSizeCurrency(value: number, currency: 'USD' | 'EUR'): string {
  const symbol = currency === 'USD' ? '$' : '€';
  return `${symbol}${Math.round(value).toLocaleString()}`;
}

const TICKET_SIZE_METHOD_LABELS: Record<'tier_band' | 'per_unit', string> = {
  tier_band: 'company-size tier',
  per_unit: 'per-participant pricing',
};

// Full range/method/confidence — the detail-drawer treatment (issue #80),
// placed adjacent to ICE Score since both answer "how are we scoring this
// deal." Renders null (section omitted) when there is nothing at all to
// show for this lead, matching techSignalsSection()'s own omit-rather-than
// -show-empty-chrome convention above.
function ticketSizeDetailSection(lead: Lead) {
  const ticketSize = getTicketSize(lead);
  if (!ticketSize) return null;

  if (ticketSize.kind === 'unconfigured') {
    return (
      <Box>
        <Text fw={600}>Ticket Size</Text>
        <Text size="sm" c="dimmed">
          Not yet configured — set deal-size bands or product pricing in Sales Settings for this brand.
        </Text>
      </Box>
    );
  }

  if (ticketSize.kind === 'legacy') {
    return (
      <Box>
        <Text fw={600}>Ticket Size</Text>
        <Text fw={700} size="lg">{formatTicketSizeCurrency(ticketSize.value, ticketSize.currency)}</Text>
        <Text size="xs" c="dimmed" fs="italic">
          Unverified estimate — predates the firmographic estimation engine, pending recalculation.
        </Text>
      </Box>
    );
  }

  // A rep's manual override (issue #86) is a different kind of figure than
  // the modelled estimate below — a single reason-required number, not a
  // low/expected/high band, so it gets its own rendering rather than
  // reusing the "Range: ..." / "Modelled estimate from ..." copy that would
  // misrepresent it as the model's own output (CLAUDE.md Rule 7).
  if (ticketSize.method === 'manual_override') {
    return (
      <Box>
        <Group justify="space-between" align="baseline">
          <Text fw={600}>Ticket Size</Text>
          <Text fw={700} size="lg">{formatTicketSizeCurrency(ticketSize.expected, ticketSize.currency)}</Text>
        </Group>
        <Text size="xs" c="dimmed" fs="italic">
          Manually overridden{ticketSize.overriddenBy ? ` by ${ticketSize.overriddenBy}` : ''} — {ticketSize.overrideReason || 'no reason recorded'}
        </Text>
      </Box>
    );
  }

  // 'estimate' — the real, server-computed band. sizeAssumed (issue #112)
  // means the lead had no reliable size-tier data and this is the brand's
  // smallest configured deal-size band, not a real per-lead estimate — said
  // plainly rather than presented as if the lead's actual size were known.
  return (
    <Box>
      <Group justify="space-between" align="baseline">
        <Text fw={600}>Ticket Size</Text>
        <Text fw={700} size="lg">{formatTicketSizeCurrency(ticketSize.expected, ticketSize.currency)}</Text>
      </Group>
      <Text size="sm" c="dimmed">
        Range: {formatTicketSizeCurrency(ticketSize.low, ticketSize.currency)} – {formatTicketSizeCurrency(ticketSize.high, ticketSize.currency)}
      </Text>
      <Text size="xs" c="dimmed" fs="italic">
        {ticketSize.sizeAssumed
          ? "Smallest configured deal size — this lead's size isn't set, using the lowest tier as a conservative placeholder"
          : `Modelled estimate from ${TICKET_SIZE_METHOD_LABELS[ticketSize.method as 'tier_band' | 'per_unit']} · ${ticketSize.confidence} confidence`}
      </Text>
    </Box>
  );
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

// Matches lib/validate-lead.ts's ORG_SIZE_SET exactly — the same fixed
// 4-value enum the server validates `size` against on save (issue #88).
// SIZE_FIELD_OPTIONS moved to app/constants.ts (issue #127) — shared with
// app/components/AddLeadModal.tsx, which has no reason to import from this
// file directly.

// GDS's built-in semantic-action vocabulary (GdsVocabulary) has no "pin"
// entry — every other action below uses a registered built-in key directly
// (confirm/cancel/refresh/edit/delete), but "pin" needed this one-entry
// custom vocabulary pack. Module-scope constant: static, not per-render.
const LEAD_ACTION_VOCABULARY_PACK = createGdsVocabularyPack('lead', {
  pin: { defaultMessage: 'Pin', icon: GdsIcons.Star, ariaLabel: 'Pin to Engaged' },
  // Issue #126 — deliberately two separate actions, not one generic "move,"
  // since only one of the two is ever relevant for a given lead (derived
  // from lead.kanbanColumn, not a separate board-mode flag).
  backlog: { defaultMessage: 'Move to Backlog', icon: GdsIcons.Archive, ariaLabel: 'Move to Backlog' },
  unbacklog: { defaultMessage: 'Move to Pipeline', icon: GdsIcons.Restore, ariaLabel: 'Move to a pipeline column' },
});

// The 6 real pipeline columns a Backlog lead can move back into — same set
// as app/constants.ts's COLUMNS, duplicated here as plain value/label pairs
// since this file doesn't otherwise import that module's icon/color/
// description fields it doesn't need.
const PIPELINE_MOVE_TARGETS = [
  { value: 'DISCOVERED', label: 'Discovered' },
  { value: 'QUALIFIED', label: 'Qualified' },
  { value: 'ENGAGED', label: 'Engaged' },
  { value: 'PROPOSAL', label: 'Proposal' },
  { value: 'WON', label: 'Won' },
  { value: 'LOST', label: 'Lost' },
];

export function LeadDetailModal({ lead, brand = 'slg', opened = false, onClose, onAction, onDelete, onUpdated }: Props) {
  const [annotation, setAnnotation] = useState("");
  const [declineReason, setDeclineReason] = useState<DeclineReason>("OTHER");
  // Only "decline" is ever actually set (Accept/Pin/Refresh fire
  // immediately on click, no confirmation step) — narrowed from a stale
  // "decline" | "pin" | "refresh" | null union that implied a confirmation
  // flow for Pin/Refresh that was never wired up.
  const [actionMode, setActionMode] = useState<"decline" | "unbacklog" | null>(null);
  const [unbacklogTarget, setUnbacklogTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [outreachOpen, setOutreachOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(true);
  // Closed-won calibration capture (issue #83) — kept as its own standalone
  // mini-flow (own local state + save action) rather than folded into the
  // "Edit Lead Details" form below: at the time this was written,
  // handleModify() had no UI entry point at all (fixed in issue #88), and
  // keeping this field on its own save action means capturing the actual
  // deal value never requires touching any other lead field.
  const [actualDealValueInput, setActualDealValueInput] = useState<number | ''>('');
  const [savingActualDealValue, setSavingActualDealValue] = useState(false);
  // "Edit Lead Details" form (issue #88) — handleModify() below was defined
  // from this file's very first commit but never wired to any button; its
  // payload was built directly from `lead.X`, which isn't locally mutable
  // state, so there was no way to actually change anything before saving.
  // This local editForm is the real editable state; handleModify() now reads
  // from it instead.
  const [editingFields, setEditingFields] = useState(false);
  const [editForm, setEditForm] = useState<{
    entity_name: string; url: string; address: string; general_contact: string; size: string;
    industry: string; sport_or_sector: string; level_league: string; value_proposition: string; notes: string; tags: string;
    // Manual ticket-size override (issue #86) — blank means "no change to
    // the override state," not "clear it"; clearing is its own explicit
    // action (handleClearTicketSizeOverride below), never inferred from an
    // emptied field.
    manualTicketSizeExpected: number | '';
    manualTicketSizeReason: string;
  }>({
    entity_name: '', url: '', address: '', general_contact: '', size: '',
    industry: '', sport_or_sector: '', level_league: '', value_proposition: '', notes: '', tags: '',
    manualTicketSizeExpected: '', manualTicketSizeReason: '',
  });

  // Contact CRUD (issue #113) — a separate editable section from the general
  // Lead Details form above, since it's a repeatable-rows UI (add/remove),
  // not a flat field set. Own edit toggle + Save, same pattern as the
  // Actual Deal Value capture above.
  const [editingContacts, setEditingContacts] = useState(false);
  const [contactsForm, setContactsForm] = useState<ContactRow[]>([]);
  const [savingContacts, setSavingContacts] = useState(false);

  function openEditContacts() {
    if (!lead) return;
    setContactsForm((lead.contacts || []).map((c) => ({
      name: c.name || '', title: c.title || '', email: c.email || '', phone: c.phone || '',
      linkedin: c.linkedin || '', role: c.role || '', isDecisionMaker: c.isDecisionMaker === true,
    })));
    setEditingContacts(true);
  }

  // Manually-managed deals (issue #114) — always distinct from the
  // auto-computed ticketSizeEstimate above; nothing here ever runs
  // automatically.
  type DealRow = { id?: string; value: number | ''; currency: 'USD' | 'EUR'; label: string; source?: Deal['source'] };
  const [editingDeals, setEditingDeals] = useState(false);
  const [dealsForm, setDealsForm] = useState<DealRow[]>([]);
  const [savingDeals, setSavingDeals] = useState(false);

  function openEditDeals() {
    if (!lead) return;
    setDealsForm((lead.deals || []).map((d) => ({ id: d.id, value: d.value, currency: d.currency, label: d.label || '', source: d.source })));
    setEditingDeals(true);
  }

  // Pre-fills a new deal row from the current ticket-size estimate
  // (owner-confirmed design decision, issue #114) — value is editable
  // before save, not a blind auto-create.
  function handleConvertTicketToDeal() {
    const ticketSize = getTicketSize(lead);
    if (!ticketSize || ticketSize.kind === 'unconfigured') return;
    const expected = ticketSize.kind === 'legacy' ? ticketSize.value : ticketSize.expected;
    const currency: 'USD' | 'EUR' = ticketSize.kind === 'legacy' ? ticketSize.currency : ticketSize.currency;
    openEditDeals();
    setDealsForm((rows) => [...rows, { value: expected, currency, label: 'Converted from ticket estimate', source: 'converted_ticket_estimate' }]);
  }

  // Per-lead checklist (issue #117) — structured, completion-tracked items,
  // distinct from the free-text `notes` field.
  type ChecklistRow = { id?: string; text: string; done: boolean };
  const [editingChecklist, setEditingChecklist] = useState(false);
  const [checklistForm, setChecklistForm] = useState<ChecklistRow[]>([]);
  const [savingChecklist, setSavingChecklist] = useState(false);

  function openEditChecklist() {
    if (!lead) return;
    setChecklistForm((lead.checklist || []).map((c) => ({ id: c.id, text: c.text, done: c.done })));
    setEditingChecklist(true);
  }

  // Follow-up reminder (issue #121) — lead-level scheduled commitment,
  // distinct from lib/next-step-nudge.ts's passive, rule-derived suggestion
  // rendered below (`nudge`). Always-visible small section, own Save,
  // mirroring the Actual Deal Value pattern.
  const [nextActionDueAt, setNextActionDueAt] = useState<Date | null>(null);
  const [nextActionNote, setNextActionNote] = useState('');
  const [savingNextAction, setSavingNextAction] = useState(false);

  // BANT-lite qualification (issue #122) — informational only, not wired
  // into lib/stage-gate.ts's required-fields gate.
  const [qualBudgetConfirmed, setQualBudgetConfirmed] = useState(false);
  const [qualBudgetNotes, setQualBudgetNotes] = useState('');
  const [qualAuthorityConfirmed, setQualAuthorityConfirmed] = useState(false);
  const [qualNeedNotes, setQualNeedNotes] = useState('');
  const [qualTimeline, setQualTimeline] = useState('');
  const [savingQualification, setSavingQualification] = useState(false);

  useEffect(() => {
    setNextActionDueAt(lead?.nextActionDueAt ? new Date(lead.nextActionDueAt) : null);
    setNextActionNote(lead?.nextActionNote || '');
    setQualBudgetConfirmed(lead?.qualification?.budgetConfirmed === true);
    setQualBudgetNotes(lead?.qualification?.budgetNotes || '');
    setQualAuthorityConfirmed(lead?.qualification?.authorityConfirmed === true);
    setQualNeedNotes(lead?.qualification?.needNotes || '');
    setQualTimeline(lead?.qualification?.timelineEstimate || '');
  }, [
    lead?._id,
    lead?.nextActionDueAt,
    lead?.nextActionNote,
    lead?.qualification?.budgetConfirmed,
    lead?.qualification?.budgetNotes,
    lead?.qualification?.authorityConfirmed,
    lead?.qualification?.needNotes,
    lead?.qualification?.timelineEstimate,
  ]);

  useEffect(() => {
    setActualDealValueInput(typeof lead?.actualDealValueUsd === 'number' ? lead.actualDealValueUsd : '');
  }, [lead?._id, lead?.actualDealValueUsd]);

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
      // Success or failure, close the confirmation — a failure is already
      // surfaced via the red notification above, same pattern every other
      // action in this modal (Accept/Pin/Refresh) relies on; the user can
      // click Reject again to retry rather than an inline retry affordance.
      setActionMode(null);
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

  // Issue #126 — deliberately not the generic COLUMN_MOVE flow GDS's own
  // per-card dropdown would offer: this modal's ActionBar has no dropdown
  // widget at all, only discrete buttons, matching every other action here
  // (Accept/Decline/Pin/Refresh).
  async function handleMoveToBacklog() {
    if (!lead) return;
    setBusy(true);
    try {
      await onAction(lead._id, "COLUMN_MOVE", { kanbanColumn: "BACKLOG", sortOrder: Date.now() });
      showNotification({ message: 'Moved to Backlog', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Move to Backlog failed', color: 'red', autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  }

  async function handleMoveToPipeline() {
    if (!lead || !unbacklogTarget) return;
    setBusy(true);
    try {
      await onAction(lead._id, "COLUMN_MOVE", { kanbanColumn: unbacklogTarget, sortOrder: Date.now() });
      showNotification({ message: `Moved to ${unbacklogTarget}`, color: 'green', autoClose: 4000 });
    } catch (err) {
      // Surfaces the real server error (e.g. a stage-gate rejection when the
      // target is ENGAGED/PROPOSAL — lib/stage-gate.ts applies here exactly
      // as it does to any other COLUMN_MOVE, keyed off destination only).
      showNotification({ message: err instanceof Error ? err.message : 'Move failed', color: 'red', autoClose: 5000 });
    } finally {
      setBusy(false);
      setActionMode(null);
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

  // Issue #83: captures the real, closed contract value once a lead is WON,
  // so lib/ticket-size-calibration.ts can compare it against what this
  // lead's ticketSizeEstimate.expected predicted. A single-field MODIFY
  // call, deliberately not routed through handleModify() above — see the
  // state-declaration comment for why.
  async function handleSaveActualDealValue() {
    if (!lead || typeof actualDealValueInput !== 'number') return;
    setSavingActualDealValue(true);
    try {
      await onAction(lead._id, 'MODIFY', { actualDealValueUsd: actualDealValueInput });
      showNotification({ message: 'Actual deal value saved', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Save failed', color: 'red', autoClose: 5000 });
    } finally {
      setSavingActualDealValue(false);
    }
  }

  // Seeds editForm from the current lead and opens the edit UI (issue #88).
  function openEditFields() {
    if (!lead) return;
    setEditForm({
      entity_name: lead.entity_name || '',
      url: lead.url || '',
      address: lead.address || '',
      general_contact: lead.general_contact || '',
      size: lead.size || '',
      industry: lead.industry || '',
      sport_or_sector: lead.sport_or_sector || '',
      level_league: lead.level_league || '',
      value_proposition: lead.value_proposition || '',
      notes: lead.notes || '',
      tags: (lead.tags || []).join(', '),
      manualTicketSizeExpected: '',
      manualTicketSizeReason: '',
    });
    setEditingFields(true);
  }

  // Reads from editForm (the real, user-editable state), not lead.X — see
  // the editingFields state comment for why. Deliberately omits `contacts`
  // from the payload entirely: PATCH ... MODIFY only touches `contacts` when
  // the payload includes it, so leaving it out here leaves existing
  // contacts untouched, which is the safe, correct behavior for a form that
  // doesn't offer contacts editing (out of scope, issue #88).
  async function handleModify() {
    if (!lead) return;
    setBusy(true);
    try {
      const payload: Record<string, any> = {
        entity_name: editForm.entity_name,
        url: editForm.url,
        address: editForm.address,
        general_contact: editForm.general_contact,
        size: editForm.size,
        industry: editForm.industry,
        sport_or_sector: editForm.sport_or_sector,
        level_league: editForm.level_league,
        value_proposition: editForm.value_proposition,
        notes: editForm.notes,
        tags: editForm.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      // Only included when both fields are actually filled in — a blank
      // reason server-side silently skips setting the override rather than
      // applying one with no accountability trail (issue #86).
      if (typeof editForm.manualTicketSizeExpected === 'number' && editForm.manualTicketSizeExpected > 0 && editForm.manualTicketSizeReason.trim()) {
        payload.manualTicketSizeExpected = editForm.manualTicketSizeExpected;
        payload.manualTicketSizeReason = editForm.manualTicketSizeReason.trim();
      }
      await onAction(lead._id, 'MODIFY', payload);
      showNotification({ message: 'Lead updated', color: 'green', autoClose: 4000 });
      setEditingFields(false);
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Modify failed', color: 'red', autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  }

  // Reverts a manual ticket-size override back to the modelled estimate
  // (issue #86) — a standalone action, not routed through the general
  // editForm Save, since it's a single unambiguous intent with no other
  // fields involved.
  async function handleClearTicketSizeOverride() {
    if (!lead) return;
    setBusy(true);
    try {
      await onAction(lead._id, 'MODIFY', { clearManualTicketSizeOverride: true });
      showNotification({ message: 'Ticket-size override cleared', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Clear failed', color: 'red', autoClose: 5000 });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveContacts() {
    if (!lead) return;
    setSavingContacts(true);
    try {
      await onAction(lead._id, 'MODIFY', { contacts: contactsForm });
      showNotification({ message: 'Contacts updated', color: 'green', autoClose: 4000 });
      setEditingContacts(false);
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Save failed', color: 'red', autoClose: 5000 });
    } finally {
      setSavingContacts(false);
    }
  }

  async function handleSaveDeals() {
    if (!lead) return;
    setSavingDeals(true);
    try {
      await onAction(lead._id, 'MODIFY', { deals: dealsForm });
      showNotification({ message: 'Deals updated', color: 'green', autoClose: 4000 });
      setEditingDeals(false);
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Save failed', color: 'red', autoClose: 5000 });
    } finally {
      setSavingDeals(false);
    }
  }

  async function handleSaveChecklist() {
    if (!lead) return;
    setSavingChecklist(true);
    try {
      await onAction(lead._id, 'MODIFY', { checklist: checklistForm });
      showNotification({ message: 'Checklist updated', color: 'green', autoClose: 4000 });
      setEditingChecklist(false);
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Save failed', color: 'red', autoClose: 5000 });
    } finally {
      setSavingChecklist(false);
    }
  }

  async function handleSaveNextAction() {
    if (!lead) return;
    setSavingNextAction(true);
    try {
      await onAction(lead._id, 'MODIFY', {
        nextActionDueAt: nextActionDueAt ? nextActionDueAt.toISOString() : null,
        nextActionNote,
      });
      showNotification({ message: 'Follow-up saved', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Save failed', color: 'red', autoClose: 5000 });
    } finally {
      setSavingNextAction(false);
    }
  }

  async function handleClearNextAction() {
    if (!lead) return;
    setSavingNextAction(true);
    try {
      await onAction(lead._id, 'MODIFY', { nextActionDueAt: null, nextActionNote: '' });
      setNextActionDueAt(null);
      setNextActionNote('');
      showNotification({ message: 'Follow-up cleared', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Clear failed', color: 'red', autoClose: 5000 });
    } finally {
      setSavingNextAction(false);
    }
  }

  async function handleSaveQualification() {
    if (!lead) return;
    setSavingQualification(true);
    try {
      await onAction(lead._id, 'MODIFY', {
        qualification: {
          budgetConfirmed: qualBudgetConfirmed,
          budgetNotes: qualBudgetNotes,
          authorityConfirmed: qualAuthorityConfirmed,
          needNotes: qualNeedNotes,
          timelineEstimate: qualTimeline,
        },
      });
      showNotification({ message: 'Qualification saved', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Save failed', color: 'red', autoClose: 5000 });
    } finally {
      setSavingQualification(false);
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
      // Issue #126 — exactly one of these two is ever shown, derived from
      // the lead's own current column (never both, never neither).
      lead.kanbanColumn === 'BACKLOG'
        ? {
            action: 'lead:unbacklog' as const,
            color: 'blue',
            variant: 'light',
            disabled: busy,
            onClick: () => { setUnbacklogTarget(null); setActionMode('unbacklog'); },
          }
        : {
            action: 'lead:backlog' as const,
            color: 'gray',
            variant: 'light',
            disabled: busy,
            onClick: handleMoveToBacklog,
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
      {techSignalsSection(lead)}
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

      {ticketSizeDetailSection(lead)}

      {lead.kanbanColumn === 'WON' && (
        <Box>
          <Text size="sm" fw={600} mb={4}>Actual Deal Value</Text>
          <Text size="xs" c="dimmed" mb={4}>
            The real, closed contract value (USD) — used to calibrate future ticket-size estimates against real outcomes.
          </Text>
          <Group align="flex-end" gap="xs">
            <NumberInput
              aria-label="Actual deal value in USD"
              value={actualDealValueInput}
              onChange={(value) => setActualDealValueInput(typeof value === 'number' ? value : '')}
              min={0}
              prefix="$"
              thousandSeparator=","
              style={{ flex: 1 }}
            />
            <Button
              size="sm"
              variant="light"
              onClick={handleSaveActualDealValue}
              loading={savingActualDealValue}
              disabled={typeof actualDealValueInput !== 'number'}
            >
              Save
            </Button>
          </Group>
        </Box>
      )}

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
        <Box>
          <Text size="xs" c="dimmed">Source</Text>
          <Text size="sm">{lead.source || '—'}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Created</Text>
          <Text size="sm">{lead.createdAt ? new Date(lead.createdAt).toLocaleString() : '—'}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Last Updated</Text>
          <Text size="sm">{lead.updatedAt ? new Date(lead.updatedAt).toLocaleString() : '—'}</Text>
        </Box>
      </SimpleGrid>

      <Box>
        <Group justify="space-between" align="center">
          <Text fw={600}>Lead Details</Text>
          {!editingFields && (
            <Button size="xs" variant="light" onClick={openEditFields} disabled={busy}>Edit</Button>
          )}
        </Group>
        {editingFields && (
          <Stack gap="xs" mt="xs">
            <TextInput label="Entity name" value={editForm.entity_name} onChange={(e) => { const v = e.currentTarget.value; setEditForm((f) => ({ ...f, entity_name: v })); }} />
            <TextInput label="URL" value={editForm.url} onChange={(e) => { const v = e.currentTarget.value; setEditForm((f) => ({ ...f, url: v })); }} />
            <TextInput label="Address" value={editForm.address} onChange={(e) => { const v = e.currentTarget.value; setEditForm((f) => ({ ...f, address: v })); }} />
            <TextInput label="General contact" value={editForm.general_contact} onChange={(e) => { const v = e.currentTarget.value; setEditForm((f) => ({ ...f, general_contact: v })); }} />
            <Select
              label="Size"
              value={editForm.size || null}
              onChange={(value) => setEditForm((f) => ({ ...f, size: value || '' }))}
              data={SIZE_FIELD_OPTIONS}
              clearable
            />
            <TextInput label="Industry" value={editForm.industry} onChange={(e) => { const v = e.currentTarget.value; setEditForm((f) => ({ ...f, industry: v })); }} />
            <TextInput label="Sport / Sector" value={editForm.sport_or_sector} onChange={(e) => { const v = e.currentTarget.value; setEditForm((f) => ({ ...f, sport_or_sector: v })); }} />
            <TextInput label="Level / League" value={editForm.level_league} onChange={(e) => { const v = e.currentTarget.value; setEditForm((f) => ({ ...f, level_league: v })); }} />
            <AdminTextarea
              name="value_proposition"
              label="Value proposition"
              value={editForm.value_proposition}
              onChange={(value: string) => setEditForm((f) => ({ ...f, value_proposition: value }))}
              rows={3}
            />
            <AdminTextarea
              name="notes"
              label="Notes"
              value={editForm.notes}
              onChange={(value: string) => setEditForm((f) => ({ ...f, notes: value }))}
              rows={3}
            />
            <TextInput
              label="Tags (comma-separated)"
              value={editForm.tags}
              onChange={(e) => { const v = e.currentTarget.value; setEditForm((f) => ({ ...f, tags: v })); }}
            />
            <Box>
              <Text size="sm" fw={600}>Manual Ticket-Size Override</Text>
              <Text size="xs" c="dimmed">
                Overrides the modelled estimate with your own figure — e.g. a verbal budget number or a
                comparable recent close. Requires a reason, and persists until explicitly cleared (exempt
                from automatic recalculation in the meantime).
              </Text>
              <NumberInput
                label="Override value"
                placeholder="Leave blank to make no change"
                value={editForm.manualTicketSizeExpected}
                onChange={(value) => setEditForm((f) => ({ ...f, manualTicketSizeExpected: typeof value === 'number' ? value : '' }))}
                min={0}
                mt="xs"
              />
              <TextInput
                label="Reason (required to save an override)"
                value={editForm.manualTicketSizeReason}
                onChange={(e) => { const v = e.currentTarget.value; setEditForm((f) => ({ ...f, manualTicketSizeReason: v })); }}
                mt="xs"
              />
              {lead.ticketSizeEstimate?.method === 'manual_override' && (
                <Button size="xs" variant="subtle" color="gray" onClick={handleClearTicketSizeOverride} loading={busy} mt="xs">
                  Clear existing override
                </Button>
              )}
            </Box>
            <Group gap="xs">
              <Button size="sm" onClick={handleModify} loading={busy}>Save</Button>
              <Button size="sm" variant="subtle" color="gray" onClick={() => setEditingFields(false)} disabled={busy}>Cancel</Button>
            </Group>
          </Stack>
        )}
      </Box>

      <Stack gap="xs">
        <Group justify="space-between" align="baseline">
          <Text size="xs" c="dimmed" fw={600}>CONTACTS</Text>
          <Group gap="xs">
            {/* Helper text for the "refresh" action above: GDS's ActionBar has no
                per-action description slot, so this can't render literally under
                that button — it's surfaced here instead, next to the data it
                describes, without changing REQUEST_REFRESH's own behavior
                (CLAUDE.md Rule 7 — context only, no new affordance). */}
            {contactStaleCount > 0 && (
              <Text size="xs" c="orange">{contactStaleCount} of {lead.contacts?.length} contacts need re-verification</Text>
            )}
            {!editingContacts && (
              <Button size="xs" variant="light" onClick={openEditContacts} disabled={busy}>Edit</Button>
            )}
          </Group>
        </Group>
        {!editingContacts && (
          <>
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
          </>
        )}
        {editingContacts && (
          <Stack gap="sm">
            <ContactsEditor value={contactsForm} onChange={setContactsForm} />
            <Group gap="xs">
              <Button size="sm" onClick={handleSaveContacts} loading={savingContacts}>Save</Button>
              <Button size="sm" variant="subtle" color="gray" onClick={() => setEditingContacts(false)} disabled={savingContacts}>Cancel</Button>
            </Group>
          </Stack>
        )}
      </Stack>

      <Divider />

      <Stack gap="xs">
        <Group justify="space-between" align="baseline">
          <Text size="xs" c="dimmed" fw={600}>DEALS</Text>
          <Group gap="xs">
            {!editingDeals && (
              <>
                <Button size="xs" variant="subtle" onClick={handleConvertTicketToDeal} disabled={busy || !getTicketSize(lead) || getTicketSize(lead)?.kind === 'unconfigured'}>
                  Convert ticket estimate to a Deal
                </Button>
                <Button size="xs" variant="light" onClick={openEditDeals} disabled={busy}>Edit</Button>
              </>
            )}
          </Group>
        </Group>
        {!editingDeals && (
          <>
            {(lead.deals?.length ?? 0) === 0 && <Text size="sm" c="dimmed">No deals yet — deals are managed manually and never auto-created.</Text>}
            {(lead.deals || []).map((d) => (
              <Group key={d.id} justify="space-between">
                <Box>
                  <Text size="sm" fw={600}>{formatTicketSizeCurrency(d.value, d.currency)}</Text>
                  <Text size="xs" c="dimmed">{d.label || (d.source === 'converted_ticket_estimate' ? 'Converted from ticket estimate' : 'Manual deal')}</Text>
                </Box>
              </Group>
            ))}
            {(lead.deals?.length ?? 0) > 0 && (
              <Text size="xs" c="dimmed" fs="italic">Total: {formatTicketSizeCurrency(sumDeals(lead.deals), lead.deals![0].currency)} — deals take priority over the modelled ticket-size estimate in Forecast.</Text>
            )}
          </>
        )}
        {editingDeals && (
          <Stack gap="sm">
            {dealsForm.length === 0 && <Text size="sm" c="dimmed">No deals yet.</Text>}
            {dealsForm.map((d, i) => (
              <Box key={i} p="xs" style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6 }}>
                <Group justify="space-between" align="center" mb={4}>
                  <Text size="xs" c="dimmed" fw={600}>Deal {i + 1}</Text>
                  <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove deal" onClick={() => setDealsForm((rows) => rows.filter((_, idx) => idx !== i))}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
                <Group gap="xs" align="flex-end">
                  <NumberInput
                    size="xs"
                    label="Value"
                    prefix={d.currency === 'EUR' ? '€' : '$'}
                    thousandSeparator=","
                    value={d.value}
                    onChange={(v) => setDealsForm((rows) => rows.map((r, idx) => idx === i ? { ...r, value: typeof v === 'number' ? v : '' } : r))}
                    min={0}
                    style={{ flex: 1 }}
                  />
                  <TextInput size="xs" label="Label (optional)" value={d.label} onChange={(e) => { const v = e.currentTarget.value; setDealsForm((rows) => rows.map((r, idx) => idx === i ? { ...r, label: v } : r)); }} style={{ flex: 1 }} />
                </Group>
              </Box>
            ))}
            <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setDealsForm((rows) => [...rows, { value: '', currency: 'USD', label: '' }])}>
              Add deal
            </Button>
            <Group gap="xs">
              <Button size="sm" onClick={handleSaveDeals} loading={savingDeals}>Save</Button>
              <Button size="sm" variant="subtle" color="gray" onClick={() => setEditingDeals(false)} disabled={savingDeals}>Cancel</Button>
            </Group>
          </Stack>
        )}
      </Stack>

      <Divider />

      <Stack gap="xs">
        <Group justify="space-between" align="baseline">
          <Text size="xs" c="dimmed" fw={600}>CHECKLIST</Text>
          {!editingChecklist && (
            <Button size="xs" variant="light" onClick={openEditChecklist} disabled={busy}>Edit</Button>
          )}
        </Group>
        {!editingChecklist && (
          <>
            {(lead.checklist?.length ?? 0) === 0 && <Text size="sm" c="dimmed">No checklist items yet.</Text>}
            {(lead.checklist || []).map((item) => (
              <Group key={item.id} gap="xs">
                <Checkbox size="xs" checked={item.done} readOnly aria-label={item.done ? 'Done' : 'Not done'} />
                <Text size="sm" td={item.done ? 'line-through' : undefined} c={item.done ? 'dimmed' : undefined}>{item.text}</Text>
              </Group>
            ))}
          </>
        )}
        {editingChecklist && (
          <Stack gap="xs">
            {checklistForm.map((item, i) => (
              <Group key={i} gap="xs" wrap="nowrap">
                <Checkbox size="xs" checked={item.done} onChange={(e) => { const v = e.currentTarget.checked; setChecklistForm((rows) => rows.map((r, idx) => idx === i ? { ...r, done: v } : r)); }} />
                <TextInput size="xs" value={item.text} onChange={(e) => { const v = e.currentTarget.value; setChecklistForm((rows) => rows.map((r, idx) => idx === i ? { ...r, text: v } : r)); }} style={{ flex: 1 }} />
                <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove item" onClick={() => setChecklistForm((rows) => rows.filter((_, idx) => idx !== i))}>
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
            <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => setChecklistForm((rows) => [...rows, { text: '', done: false }])}>
              Add item
            </Button>
            <Group gap="xs">
              <Button size="sm" onClick={handleSaveChecklist} loading={savingChecklist}>Save</Button>
              <Button size="sm" variant="subtle" color="gray" onClick={() => setEditingChecklist(false)} disabled={savingChecklist}>Cancel</Button>
            </Group>
          </Stack>
        )}
      </Stack>

      <Divider />

      <Stack gap="xs">
        <Text size="xs" c="dimmed" fw={600}>FOLLOW-UP</Text>
        <Text size="xs" c="dimmed">A scheduled reminder for this lead — distinct from the automatic suggestion below.</Text>
        <Group align="flex-end" gap="xs">
          <DateInput
            size="xs"
            label="Due date"
            placeholder="No follow-up scheduled"
            value={nextActionDueAt}
            onChange={(v) => setNextActionDueAt(v ? new Date(v) : null)}
            clearable
            style={{ flex: 1 }}
          />
          <TextInput size="xs" label="Note" value={nextActionNote} onChange={(e) => setNextActionNote(e.currentTarget.value)} style={{ flex: 2 }} />
        </Group>
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={handleSaveNextAction} loading={savingNextAction}>Save follow-up</Button>
          {lead.nextActionDueAt && (
            <Button size="xs" variant="subtle" color="gray" onClick={handleClearNextAction} disabled={savingNextAction}>Clear</Button>
          )}
        </Group>
      </Stack>

      <Divider />

      <Stack gap="xs">
        <Text size="xs" c="dimmed" fw={600}>QUALIFICATION</Text>
        <Text size="xs" c="dimmed">Informational only — not required to move this lead through the pipeline.</Text>
        <Checkbox label="Budget confirmed" checked={qualBudgetConfirmed} onChange={(e) => setQualBudgetConfirmed(e.currentTarget.checked)} />
        <TextInput size="xs" label="Budget notes" value={qualBudgetNotes} onChange={(e) => setQualBudgetNotes(e.currentTarget.value)} />
        <Checkbox label="Buying authority confirmed" checked={qualAuthorityConfirmed} onChange={(e) => setQualAuthorityConfirmed(e.currentTarget.checked)} />
        <TextInput size="xs" label="Need / pain point" value={qualNeedNotes} onChange={(e) => setQualNeedNotes(e.currentTarget.value)} />
        <TextInput size="xs" label="Timeline estimate" placeholder="e.g. This quarter" value={qualTimeline} onChange={(e) => setQualTimeline(e.currentTarget.value)} />
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={handleSaveQualification} loading={savingQualification}>Save qualification</Button>
        </Group>
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
      {/* issue #90: Decline Reason used to be an unconditional field buried
          at the bottom of a long scrollable drawer, disconnected from
          Reject — a user could tap Reject (which only set dead state; it
          never actually called handleDecline) without ever seeing or
          setting a reason. A small dedicated confirmation, immune to scroll
          position, is the robust fix the issue itself called out as
          preferable to relying on layout placement. */}
      <Modal opened={actionMode === 'decline'} onClose={() => setActionMode(null)} title="Reject lead" centered>
        <Stack gap="sm">
          <AdminSelect
            name="declineReason"
            label="Decline Reason"
            value={declineReason}
            onChange={(value: string | null) => value && setDeclineReason(value as DeclineReason)}
            data={DECLINE_REASONS.map((r) => ({ value: r.value, label: r.label }))}
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="light" color="gray" onClick={() => setActionMode(null)} disabled={busy}>
              Cancel
            </Button>
            <Button color="red" onClick={handleDecline} loading={busy}>
              Confirm Reject
            </Button>
          </Group>
        </Stack>
      </Modal>
      {/* Issue #126 — "Move to Pipeline" needs a destination column, unlike
          every other single-purpose action button in this modal, so it gets
          the same confirmation-modal treatment Reject's reason picker
          already established rather than a bespoke new pattern. */}
      <Modal opened={actionMode === 'unbacklog'} onClose={() => setActionMode(null)} title="Move to Pipeline" centered>
        <Stack gap="sm">
          <AdminSelect
            name="unbacklogTarget"
            label="Move to"
            value={unbacklogTarget}
            onChange={(value: string | null) => setUnbacklogTarget(value)}
            data={PIPELINE_MOVE_TARGETS}
            placeholder="Choose a column"
          />
          <Group justify="flex-end" gap="xs">
            <Button variant="light" color="gray" onClick={() => setActionMode(null)} disabled={busy}>
              Cancel
            </Button>
            <Button color="blue" onClick={handleMoveToPipeline} loading={busy} disabled={!unbacklogTarget}>
              Confirm Move
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
