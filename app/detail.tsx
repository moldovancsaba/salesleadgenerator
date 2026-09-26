'use client';

import { useState, useEffect, useCallback } from 'react';
import type { Lead } from './types';
import { AdminModal, AdminDetailDrawer, AdminTextarea, AdminSelect, InfoCard } from '@sovereignsquad/gds-admin/client';
import { createGdsVocabularyPack, GdsIcons, StatusBadge } from '@sovereignsquad/gds-core/client';
import { Stack, Group, Text, Badge, Progress, Button, Box, Title, SimpleGrid, NumberInput, TextInput, Select, Modal, Checkbox, ActionIcon, Divider } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { showNotification } from '@mantine/notifications';
import { normalizeLead, ensureArrayField } from './lib/normalize-lead';
import { PRO_FIELD, CON_FIELD } from './lib/brand-constants';
import type { CurrencyCode } from './lib/brand-constants';
import { getTicketSize, SIZE_FIELD_OPTIONS } from './constants';
import { isContactStale, DEFAULT_STALENESS_THRESHOLD_DAYS } from '@/lib/contact-freshness';
import { computeStaleness, DEFAULT_STALE_THRESHOLDS } from '@/lib/stale-deal';
import { getNextStepNudge } from '@/lib/next-step-nudge';
import { sumDeals } from '@/lib/deals';
import type { Deal } from '@/lib/deals';
import { ContactsEditor, type ContactRow } from './components/ContactsEditor';
import { GoogleContactsImport } from './components/GoogleContactsImport';
import { ActivityPanel } from './components/ActivityPanel';
import { CadencePanel } from './components/CadencePanel';
import { resolveBuyingRole, deriveIsDecisionMaker } from '@/lib/contacts';
import { FORECAST_CATEGORIES, resolveDefaultCategory, effectiveForecastCategory } from '@/lib/forecast-category';
import type { ForecastCategory } from '@/lib/forecast-category';
import {
  IconX,
  IconThumbUp,
  IconThumbDown,
  IconPin,
  IconRefresh,
  IconTrash,
  IconMail,
  IconPlus,
  IconFileText,
} from '@tabler/icons-react';
import { OutreachComposeModal } from './outreach/compose-modal';
import { TABLET_LANDSCAPE_MAX } from './constants';
import { useIsCompactViewport } from './lib/use-is-compact-viewport';
import { TOUR_SELECTOR } from './lib/tour/selectors';

type KanbanColumn = Lead['kanbanColumn'];
type DeclineReason = Lead extends { declineReason?: infer R } ? R : never;

// Issue #206 — buying-committee role badge, replacing the single "Decision
// Maker" badge. 'blocker' uses red (a real risk signal, not decorative);
// 'unknown' renders no badge at all, same "no badge" convention the old
// isDecisionMaker: false state already had.
const BUYING_ROLE_BADGE: Partial<Record<NonNullable<Lead['contacts']>[number]['buyingRole'] & string, { label: string; color: string }>> = {
  economic_buyer: { label: 'Economic Buyer', color: 'blue' },
  champion: { label: 'Champion', color: 'green' },
  influencer: { label: 'Influencer', color: 'grape' },
  blocker: { label: 'Blocker', color: 'red' },
  decision_maker: { label: 'Decision Maker', color: 'blue' },
};

const FORECAST_CATEGORY_LABEL: Record<ForecastCategory, string> = {
  pipeline: 'Pipeline',
  best_case: 'Best Case',
  commit: 'Commit',
  closed: 'Closed',
};

type Props = {
  lead: Lead;
  brand?: string;
  // Issue #195 — brand/tenant config moved to an async Mongo-backed registry
  // this Client Component can't call itself; the brand's currency is now
  // resolved by the nearest async Server Component ancestor
  // (app/sales/[brand]/page.tsx) and threaded down as a prop instead of
  // this file importing BRAND_CONFIG directly.
  currency?: CurrencyCode;
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

// Deals: Quote generation (issue #211) — status badge, text+shape always
// present together (never color alone, WCAG 1.4.1, matching every other
// status indicator in this file).
type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'signed';
function quoteStatusBadge(status: QuoteStatus) {
  const config: Record<QuoteStatus, { status: 'neutral' | 'info' | 'warning' | 'success'; label: string }> = {
    draft: { status: 'neutral', label: 'Draft' },
    sent: { status: 'info', label: 'Sent' },
    viewed: { status: 'warning', label: 'Viewed' },
    signed: { status: 'success', label: 'Signed' },
  };
  const { status: variant, label } = config[status];
  return <StatusBadge status={variant} aria-label={`Quote status: ${label}`}>{label}</StatusBadge>;
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

function formatTicketSizeCurrency(value: number, currency: CurrencyCode): string {
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

export function LeadDetailModal({ lead, brand = 'slg', currency, opened = false, onClose, onAction, onDelete, onUpdated }: Props) {
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
  // Below desktop width, render as a full-screen AdminModal instead of the
  // side AdminDetailDrawer — a drawer is too cramped on tablet/mobile
  // viewports. `initialValue: true` preserves this modal's pre-#130
  // default of assuming compact until the real viewport is known.
  const fullScreen = useIsCompactViewport(TABLET_LANDSCAPE_MAX, true);
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
    entity_name: string; url: string; country: string; address: string; general_contact: string; size: string;
    industry: string; sport_or_sector: string; level_league: string; value_proposition: string; notes: string; tags: string;
    // Manual ticket-size override (issue #86) — blank means "no change to
    // the override state," not "clear it"; clearing is its own explicit
    // action (handleClearTicketSizeOverride below), never inferred from an
    // emptied field.
    manualTicketSizeExpected: number | '';
    manualTicketSizeReason: string;
  }>({
    entity_name: '', url: '', country: '', address: '', general_contact: '', size: '',
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
    setContactsForm((lead.contacts || []).map((c) => {
      const buyingRole = resolveBuyingRole(c);
      return {
        name: c.name || '', title: c.title || '', email: c.email || '', phone: c.phone || '',
        linkedin: c.linkedin || '', role: c.role || '', buyingRole, isDecisionMaker: deriveIsDecisionMaker(buyingRole),
      };
    }));
    setEditingContacts(true);
  }

  // Issue #216 — Rule 7: "Import from Google Contacts" must stay genuinely
  // disabled, never clickable-but-broken, until a real active connection is
  // confirmed. `undefined` (still checking) is treated the same as
  // disabled by GoogleContactsImport — never optimistically enabled.
  const [googleContactsConnected, setGoogleContactsConnected] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setGoogleContactsConnected(undefined);
    fetch(`/api/integrations/connections?brand=${encodeURIComponent(brand)}&tenantId=default`)
      .then((res) => (res.ok ? res.json() : { connections: [] }))
      .then((data) => {
        if (cancelled) return;
        const connection = (data.connections || []).find((c: any) => c.provider === 'google_contacts');
        setGoogleContactsConnected(connection?.status === 'active');
      })
      .catch(() => { if (!cancelled) setGoogleContactsConnected(false); });
    return () => { cancelled = true; };
  }, [opened, brand]);

  // Manually-managed deals (issue #114) — always distinct from the
  // auto-computed ticketSizeEstimate above; nothing here ever runs
  // automatically.
  type DealLineItemRow = { productId: string; quantity: number; unitPriceOverride?: number };
  type DealRow = { id?: string; value: number | ''; currency: CurrencyCode; label: string; source?: Deal['source']; lineItems?: DealLineItemRow[] };
  const [editingDeals, setEditingDeals] = useState(false);
  const [dealsForm, setDealsForm] = useState<DealRow[]>([]);
  const [savingDeals, setSavingDeals] = useState(false);

  // Catalog products for the "build from catalog" line-item mode (issue
  // #215) — loaded lazily, only once a rep actually starts editing deals,
  // never on every lead-detail open.
  type CatalogProduct = { id: string; name: string; unitPrice: number; currency: CurrencyCode; pricingModel: string; active: boolean };
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [catalogLoaded, setCatalogLoaded] = useState(false);

  function openEditDeals() {
    if (!lead) return;
    setDealsForm((lead.deals || []).map((d) => ({ id: d.id, value: d.value, currency: d.currency, label: d.label || '', source: d.source, lineItems: d.lineItems })));
    setEditingDeals(true);
    if (!catalogLoaded) {
      setCatalogLoaded(true);
      fetch(`/api/products/${encodeURIComponent(brand)}?tenantId=default`)
        .then((res) => (res.ok ? res.json() : { products: [] }))
        .then((data) => setCatalogProducts(Array.isArray(data.products) ? data.products : []))
        .catch(() => setCatalogProducts([]));
    }
  }

  function dealLineItemTotal(row: DealRow): number {
    if (!Array.isArray(row.lineItems)) return 0;
    return row.lineItems.reduce((sum, item) => {
      const product = catalogProducts.find((p) => p.id === item.productId);
      const unitPrice = typeof item.unitPriceOverride === 'number' ? item.unitPriceOverride : (product?.unitPrice ?? 0);
      return sum + item.quantity * unitPrice;
    }, 0);
  }

  // Pre-fills a new deal row from the current ticket-size estimate
  // (owner-confirmed design decision, issue #114) — value is editable
  // before save, not a blind auto-create.
  function handleConvertTicketToDeal() {
    const ticketSize = getTicketSize(lead);
    if (!ticketSize || ticketSize.kind === 'unconfigured') return;
    const expected = ticketSize.kind === 'legacy' ? ticketSize.value : ticketSize.expected;
    const currency: CurrencyCode = ticketSize.kind === 'legacy' ? ticketSize.currency : ticketSize.currency;
    openEditDeals();
    setDealsForm((rows) => [...rows, { value: expected, currency, label: 'Converted from ticket estimate', source: 'converted_ticket_estimate' }]);
  }

  // Deals: Quote generation (issue #211) — fetched once per lead open, same
  // convention as the assignable-users effect above. canGenerate/canSend
  // are server-computed feature-detection flags (Blob storage/Resend
  // configured), driving the disabled state of the buttons below per
  // CLAUDE.md Rule 7 — a genuinely non-functional action is rendered
  // disabled, never live-looking.
  type QuoteRow = { _id: string; dealId: string; status: QuoteStatus; viewUrl: string; createdAt: string };
  const [quotesByDeal, setQuotesByDeal] = useState<Record<string, QuoteRow[]>>({});
  const [quotesCanGenerate, setQuotesCanGenerate] = useState(false);
  const [quotesCanSend, setQuotesCanSend] = useState(false);
  const [quotesLoaded, setQuotesLoaded] = useState(false);
  const [quoteBusyId, setQuoteBusyId] = useState<string | null>(null);

  // Deliberately narrowed to lead?._id (not the whole lead object) — quotes
  // only need reloading when the open lead or brand actually changes, never
  // on every unrelated field edit to the same lead.
  const reloadQuotes = useCallback(() => {
    if (!lead) return;
    fetch(`/api/leads/${lead._id}/quotes?brand=${encodeURIComponent(brand)}&tenantId=default`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Failed to load quotes (${res.status})`))))
      .then((data) => {
        const byDeal: Record<string, QuoteRow[]> = {};
        (Array.isArray(data.quotes) ? data.quotes : []).forEach((q: QuoteRow) => {
          byDeal[q.dealId] = [...(byDeal[q.dealId] || []), q];
        });
        setQuotesByDeal(byDeal);
        setQuotesCanGenerate(Boolean(data.canGenerate));
        setQuotesCanSend(Boolean(data.canSend));
      })
      .catch((err) => {
        console.error('quotes fetch error:', err);
        setQuotesByDeal({});
      })
      .finally(() => setQuotesLoaded(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?._id, brand]);

  useEffect(() => {
    if (!opened || !lead) return;
    setQuotesLoaded(false);
    reloadQuotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opened, lead?._id, brand]);

  async function handleGenerateQuote(dealId: string) {
    if (!lead) return;
    setQuoteBusyId(dealId);
    try {
      const res = await fetch(`/api/leads/${lead._id}/quotes?brand=${encodeURIComponent(brand)}&tenantId=default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dealId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to generate quote: ${res.status}`);
      }
      showNotification({ message: 'Quote generated.', color: 'teal' });
      reloadQuotes();
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Failed to generate quote', color: 'red' });
    } finally {
      setQuoteBusyId(null);
    }
  }

  async function handleSendQuote(quoteId: string) {
    if (!lead) return;
    setQuoteBusyId(quoteId);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`/api/leads/${lead._id}/quotes/${quoteId}/send?brand=${encodeURIComponent(brand)}&tenantId=default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idempotencyKey }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to send quote: ${res.status}`);
      }
      const data = await res.json();
      if (data.sent === false) {
        showNotification({ message: data.reason || 'Quote could not be sent', color: 'red' });
      } else {
        showNotification({ message: 'Quote sent.', color: 'teal' });
        reloadQuotes();
      }
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Failed to send quote', color: 'red' });
    } finally {
      setQuoteBusyId(null);
    }
  }

  // Mark as signed is a legally consequential, unverified (v1 has no real
  // e-signature capture) manual state change — requires an explicit
  // confirmation step so the UI never implies a stronger guarantee than it
  // actually has (issue #211 §13/§17/§18).
  async function handleMarkQuoteSigned(quoteId: string) {
    if (!lead) return;
    if (!window.confirm('Mark this quote as signed? This records a manual status change with no automated verification — confirm the agreement was actually reached outside this app.')) return;
    setQuoteBusyId(quoteId);
    try {
      const res = await fetch(`/api/leads/${lead._id}/quotes/${quoteId}/mark-signed?brand=${encodeURIComponent(brand)}&tenantId=default`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Failed to mark quote as signed: ${res.status}`);
      }
      showNotification({ message: 'Quote marked as signed.', color: 'teal' });
      reloadQuotes();
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Failed to mark quote as signed', color: 'red' });
    } finally {
      setQuoteBusyId(null);
    }
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

  // Lead ownership (issue: CRM Lead ownership) — assignee picker. Fetched
  // from GET /api/leads/assignable-users (brand-scoped, not the super-
  // admin-only /api/admin/users) whenever the modal opens for a given
  // brand; callerRole/callerSsoUserId drive the disabled-with-reason state
  // for a non-admin trying to assign to someone other than themselves
  // (CLAUDE.md Rule 7 — no live-looking control that silently fails).
  const [assignableUsers, setAssignableUsers] = useState<Array<{ ssoUserId: string; email: string; name?: string }>>([]);
  const [callerSsoUserId, setCallerSsoUserId] = useState<string | null>(null);
  const [callerRole, setCallerRole] = useState<'admin' | 'user' | null>(null);
  const [loadingAssignable, setLoadingAssignable] = useState(false);
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  // Forecast category (issue #204) — sticky override control, same
  // "select a value, Save applies it as its own action" shape as the
  // Assignment control above. forecastCategoryTarget always starts at the
  // lead's current effective category (override if one exists, else the
  // stage-derived default) so opening the picker never shows a blank/wrong
  // starting value.
  const [forecastCategoryTarget, setForecastCategoryTarget] = useState<ForecastCategory>(() => effectiveForecastCategory(lead));
  const [settingForecastCategory, setSettingForecastCategory] = useState(false);

  useEffect(() => {
    if (!opened) return;
    let cancelled = false;
    setLoadingAssignable(true);
    fetch(`/api/leads/assignable-users?brand=${encodeURIComponent(brand)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`Failed to load assignable users (${res.status})`))))
      .then((data) => {
        if (cancelled) return;
        setAssignableUsers(Array.isArray(data.users) ? data.users : []);
        setCallerSsoUserId(data.callerSsoUserId ?? null);
        setCallerRole(data.callerRole ?? null);
      })
      .catch((err) => {
        // Non-fatal — the assignment display/current-state section above
        // still renders; only the picker's own option list is affected.
        console.error('assignable-users fetch error:', err);
      })
      .finally(() => { if (!cancelled) setLoadingAssignable(false); });
    return () => { cancelled = true; };
  }, [opened, brand]);

  useEffect(() => {
    setAssignTarget(lead?.assignedTo ?? null);
  }, [lead?._id, lead?.assignedTo]);

  useEffect(() => {
    setForecastCategoryTarget(effectiveForecastCategory({
      kanbanColumn: lead?.kanbanColumn,
      forecastCategory: lead?.forecastCategory,
      forecastCategoryOverriddenBy: lead?.forecastCategoryOverriddenBy,
    }));
  }, [lead?._id, lead?.kanbanColumn, lead?.forecastCategory, lead?.forecastCategoryOverriddenBy]);

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
      country: lead.country || '',
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
  // contacts untouched, which is the safe, correct behavior for this
  // specific form. Contacts editing exists (issue #113) but lives in its
  // own section with its own save handler, independent of this general
  // Lead Details form — not a remaining gap, a deliberate separation.
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
      // Omitted entirely when blank, not sent as ''  — unlike every other
      // field on this form, the server validates country's format even on a
      // partial MODIFY (a 2-letter ISO code) whenever the key is present at
      // all, so sending an empty string for the many leads that don't have
      // one yet (this field was only just wired up — see CHANGELOG) would
      // 400 every other edit on this form too. Leaving it out here means
      // "no change," matching the manual-ticket-size fields' own contract below.
      // Issue #223: also omitted when unchanged, so a lead whose stored code
      // is invalid can still save its other fields; only an actual country
      // edit is validated.
      const editedCountry = editForm.country.trim().toUpperCase();
      if (editedCountry && editedCountry !== String(lead.country || '').toUpperCase()) {
        payload.country = editedCountry;
      }
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
    // A deal switched to "Build from catalog" with zero lines added yet
    // would resolve to no usable value at all server-side and be silently
    // dropped (never a fabricated $0 deal) — caught here instead of
    // surprising the rep after save.
    if (dealsForm.some((r) => Array.isArray(r.lineItems) && r.lineItems.length === 0)) {
      showNotification({ message: 'Add at least one line item, or switch back to a bare value, before saving.', color: 'red', autoClose: 5000 });
      return;
    }
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

  // Lead ownership (issue: CRM Lead ownership) — clearing an existing
  // assignment requires an explicit confirm step (removes visibility from
  // whoever currently owns the lead), matching this app's own established
  // window.confirm convention for every other destructive action
  // (CadencePanel.tsx, battlecards/templates/cadences delete flows) rather
  // than introducing a different confirm pattern for just this one action.
  async function handleAssign(target: string | null) {
    if (!lead) return;
    if (target === null) {
      const confirmed = window.confirm('Clear this lead\'s assignment? It will show as Unassigned until someone claims or is assigned it again.');
      if (!confirmed) return;
    }
    setAssigning(true);
    try {
      await onAction(lead._id, 'ASSIGN', { assignedTo: target });
      setAssignTarget(target);
      showNotification({ message: target === null ? 'Assignment cleared' : 'Lead assigned', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Assignment failed', color: 'red', autoClose: 5000 });
    } finally {
      setAssigning(false);
    }
  }

  // Forecast category (issue #204) — a lead never has forecastCategory
  // stored until it's explicitly overridden (see lib/forecast-category.ts),
  // so "Reset to default" sends null to clear the override rather than
  // computing and sending the current default value — the two are only
  // equivalent right now, and would silently diverge the moment the lead's
  // stage changes again if this sent an explicit value instead.
  async function handleSetForecastCategory(category: ForecastCategory) {
    if (!lead) return;
    setSettingForecastCategory(true);
    try {
      await onAction(lead._id, 'SET_FORECAST_CATEGORY', { forecastCategory: category });
      showNotification({ message: `Forecast category set to ${FORECAST_CATEGORY_LABEL[category]}`, color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Forecast category update failed', color: 'red', autoClose: 5000 });
    } finally {
      setSettingForecastCategory(false);
    }
  }

  async function handleResetForecastCategory() {
    if (!lead) return;
    setSettingForecastCategory(true);
    try {
      await onAction(lead._id, 'SET_FORECAST_CATEGORY', { forecastCategory: null });
      showNotification({ message: 'Forecast category reset to stage default', color: 'green', autoClose: 4000 });
    } catch (err) {
      showNotification({ message: err instanceof Error ? err.message : 'Reset failed', color: 'red', autoClose: 5000 });
    } finally {
      setSettingForecastCategory(false);
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
        // Issue #185 — GDS's renderSemanticAction spreads unrecognized props
        // (including `id`) straight onto the real Mantine <Button>, so this
        // lands on the actual DOM node the onboarding tour spotlights. Only
        // compiles because `actions` has no explicit ActionBarProps
        // annotation anywhere in its assignment chain today (confirmed) —
        // if a future refactor adds one, TypeScript's excess-property check
        // would start rejecting this and it'd need an `as` cast instead.
        id: TOUR_SELECTOR.composeOutreach,
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
    <Stack gap="md" data-tour="lead-detail-content">
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
          <Text size="xs" c="dimmed">Assigned to</Text>
          <Text size="sm" title={lead.assignedAt ? `Changed ${new Date(lead.assignedAt).toLocaleString()}` : undefined}>
            {lead.assignedToEmail || (lead.assignedTo ? lead.assignedTo : 'Unassigned')}
          </Text>
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

      {/* Lead ownership (issue: CRM Lead ownership) — self-assign is always
          allowed; assigning to (or clearing) someone else's assignment is
          disabled with a visible reason for a non-admin (CLAUDE.md Rule 7)
          rather than only failing after the attempt via the server's own
          403. GDS's AdminSelect primitive (already imported/used elsewhere
          in this file) per the issue's Design System requirement. */}
      <Box>
        <Text size="xs" c="dimmed" fw={600} mb={4}>ASSIGNMENT</Text>
        <Group gap="xs" align="flex-end">
          <AdminSelect
            name="assignTo"
            label="Assign to"
            placeholder={loadingAssignable ? 'Loading…' : 'Unassigned'}
            disabled={loadingAssignable}
            data={[
              { value: '__unassigned__', label: 'Unassigned' },
              ...assignableUsers.map((u) => ({
                value: u.ssoUserId,
                label: u.name ? `${u.name} (${u.email})` : u.email,
              })),
            ]}
            value={assignTarget ?? '__unassigned__'}
            onChange={(value: string | null) => setAssignTarget(value === '__unassigned__' || !value ? null : value)}
          />
          <Button
            size="xs"
            variant="light"
            loading={assigning}
            disabled={
              assignTarget === (lead.assignedTo ?? null)
              || (
                // Self-assign/self-release is always allowed; anything else
                // (assigning to, or clearing, someone else's assignment)
                // needs the brand-admin role — matches lib/lead-assignment.ts's
                // canAssign() exactly, client-side, for immediate feedback.
                callerRole !== 'admin'
                && assignTarget !== callerSsoUserId
                && !(assignTarget === null && lead.assignedTo === callerSsoUserId)
              )
            }
            onClick={() => handleAssign(assignTarget)}
          >
            {assignTarget === null ? 'Clear assignment' : 'Assign'}
          </Button>
        </Group>
        {callerRole !== 'admin' && assignTarget !== callerSsoUserId && assignTarget !== (lead.assignedTo ?? null) && !(assignTarget === null && lead.assignedTo === callerSsoUserId) && (
          <Text size="xs" c="dimmed" mt={4}>Only a brand admin can assign this lead to another user.</Text>
        )}
      </Box>

      {/* Forecast category (issue #204) — neutral/muted "Default for stage"
          state vs. an explicit "Overridden by X, date" state, matching
          ticketSizeEstimate.method === 'manual_override''s own established
          visual pattern (see the Manual Ticket-Size Override block below). */}
      <Box>
        <Text size="xs" c="dimmed" fw={600} mb={4}>FORECAST CATEGORY</Text>
        <Group gap="xs" align="flex-end">
          <AdminSelect
            name="forecastCategory"
            label="Category"
            data={FORECAST_CATEGORIES.map((cat) => ({ value: cat, label: FORECAST_CATEGORY_LABEL[cat] }))}
            value={forecastCategoryTarget}
            onChange={(value: string | null) => { if (value) setForecastCategoryTarget(value as ForecastCategory); }}
          />
          <Button
            size="xs"
            variant="light"
            loading={settingForecastCategory}
            disabled={forecastCategoryTarget === effectiveForecastCategory(lead)}
            onClick={() => handleSetForecastCategory(forecastCategoryTarget)}
          >
            Save
          </Button>
          {lead.forecastCategoryOverriddenBy && (
            <Button size="xs" variant="subtle" color="gray" loading={settingForecastCategory} onClick={handleResetForecastCategory}>
              Reset to default
            </Button>
          )}
        </Group>
        {lead.forecastCategoryOverriddenBy ? (
          <Text size="xs" c="dimmed" mt={4}>
            Overridden by {lead.forecastCategoryOverriddenBy}
            {lead.forecastCategoryOverriddenAt ? `, ${new Date(lead.forecastCategoryOverriddenAt).toLocaleString()}` : ''}
          </Text>
        ) : (
          <Text size="xs" c="dimmed" mt={4}>
            Default for stage ({FORECAST_CATEGORY_LABEL[resolveDefaultCategory(lead.kanbanColumn)]})
          </Text>
        )}
      </Box>

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
            <TextInput
              label="Country"
              description="2-letter ISO code, e.g. US, GB, DE"
              placeholder="US"
              maxLength={2}
              value={editForm.country}
              onChange={(e) => { const v = e.currentTarget.value.toUpperCase(); setEditForm((f) => ({ ...f, country: v })); }}
            />
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
              <GoogleContactsImport
                leadId={lead._id}
                brand={brand}
                connected={googleContactsConnected}
                onImported={onUpdated}
              />
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
                  {BUYING_ROLE_BADGE[contact.buyingRole as keyof typeof BUYING_ROLE_BADGE] && (
                    <Badge variant="light" size="xs" color={BUYING_ROLE_BADGE[contact.buyingRole as keyof typeof BUYING_ROLE_BADGE]!.color}>
                      {BUYING_ROLE_BADGE[contact.buyingRole as keyof typeof BUYING_ROLE_BADGE]!.label}
                    </Badge>
                  )}
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
              <Stack key={d.id} gap={4}>
                <Group justify="space-between">
                  <Box>
                    <Text size="sm" fw={600}>{formatTicketSizeCurrency(d.value, d.currency)}</Text>
                    <Text size="xs" c="dimmed">
                      {d.label || (
                        d.source === 'converted_ticket_estimate' ? 'Converted from ticket estimate'
                        : d.source === 'catalog_line_items' ? `${d.lineItems?.length ?? 0} catalog line item${(d.lineItems?.length ?? 0) === 1 ? '' : 's'}`
                        : 'Manual deal'
                      )}
                    </Text>
                  </Box>
                </Group>
                {/* Deals: Quote generation (issue #211) — quotesLoaded gates
                    rendering so the button never flashes enabled-then-
                    disabled while the feature-detection fetch is in flight. */}
                {quotesLoaded && (
                  <Stack gap={4} pl="xs">
                    {(quotesByDeal[d.id] || []).map((q) => (
                      <Group key={q._id} gap="xs" wrap="wrap">
                        {quoteStatusBadge(q.status)}
                        <Text size="xs" c="dimmed">{new Date(q.createdAt).toLocaleDateString()}</Text>
                        <Button
                          size="compact-xs"
                          variant="subtle"
                          component="a"
                          href={q.viewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`View quote PDF generated ${new Date(q.createdAt).toLocaleDateString()}`}
                        >
                          View PDF
                        </Button>
                        {q.status === 'draft' && (
                          <Button
                            size="compact-xs"
                            variant="light"
                            disabled={!quotesCanSend || quoteBusyId === q._id}
                            loading={quoteBusyId === q._id}
                            onClick={() => handleSendQuote(q._id)}
                            aria-describedby={!quotesCanSend ? 'quote-send-disabled-reason' : undefined}
                          >
                            Send
                          </Button>
                        )}
                        {(q.status === 'sent' || q.status === 'viewed') && (
                          <Button
                            size="compact-xs"
                            variant="light"
                            color="teal"
                            disabled={quoteBusyId === q._id}
                            loading={quoteBusyId === q._id}
                            onClick={() => handleMarkQuoteSigned(q._id)}
                          >
                            Mark as signed
                          </Button>
                        )}
                      </Group>
                    ))}
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<IconFileText size={12} />}
                      disabled={!quotesCanGenerate || quoteBusyId === d.id}
                      loading={quoteBusyId === d.id}
                      onClick={() => handleGenerateQuote(d.id)}
                      aria-label={`Generate quote for deal: ${d.label || formatTicketSizeCurrency(d.value, d.currency)}`}
                      aria-describedby={!quotesCanGenerate ? 'quote-generate-disabled-reason' : undefined}
                    >
                      Generate Quote
                    </Button>
                    {!quotesCanSend && quotesCanGenerate && (
                      <Text id="quote-send-disabled-reason" size="9px" c="dimmed">Email sending is not configured for this environment.</Text>
                    )}
                    {!quotesCanGenerate && (
                      <Text id="quote-generate-disabled-reason" size="9px" c="dimmed">Quote file storage is not configured for this environment.</Text>
                    )}
                  </Stack>
                )}
              </Stack>
            ))}
            {(lead.deals?.length ?? 0) > 0 && (
              <Text size="xs" c="dimmed" fs="italic">Total: {formatTicketSizeCurrency(sumDeals(lead.deals), lead.deals![0].currency)} — deals take priority over the modelled ticket-size estimate in Forecast.</Text>
            )}
          </>
        )}
        {editingDeals && (
          <Stack gap="sm">
            {dealsForm.length === 0 && <Text size="sm" c="dimmed">No deals yet.</Text>}
            {dealsForm.map((d, i) => {
              const usesCatalog = Array.isArray(d.lineItems);
              // Only active products in this deal's own currency are
              // selectable — a currency-mismatched or deactivated product
              // is never offered for a new line (issue #215 §6/§13/§15 #4),
              // though a historical line already referencing one still
              // renders (with an "inactive"/"different currency" tag) so it
              // stays legible.
              const pickableProducts = catalogProducts.filter((p) => p.active && p.currency === d.currency);
              return (
              <Box key={i} p="xs" style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 6 }}>
                <Group justify="space-between" align="center" mb={4}>
                  <Text size="xs" c="dimmed" fw={600}>Deal {i + 1}</Text>
                  <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove deal" onClick={() => setDealsForm((rows) => rows.filter((_, idx) => idx !== i))}>
                    <IconTrash size={14} />
                  </ActionIcon>
                </Group>
                <Group gap="xs" mb={6}>
                  <Button
                    size="compact-xs"
                    variant={usesCatalog ? 'subtle' : 'filled'}
                    onClick={() => setDealsForm((rows) => rows.map((r, idx) => idx === i ? { ...r, lineItems: undefined } : r))}
                  >
                    Bare value
                  </Button>
                  <Button
                    size="compact-xs"
                    variant={usesCatalog ? 'filled' : 'subtle'}
                    onClick={() => setDealsForm((rows) => rows.map((r, idx) => idx === i ? { ...r, lineItems: r.lineItems ?? [] } : r))}
                  >
                    Build from catalog
                  </Button>
                </Group>
                {!usesCatalog && (
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
                )}
                {usesCatalog && (
                  <Stack gap="xs">
                    <TextInput size="xs" label="Label (optional)" value={d.label} onChange={(e) => { const v = e.currentTarget.value; setDealsForm((rows) => rows.map((r, idx) => idx === i ? { ...r, label: v } : r)); }} />
                    {pickableProducts.length === 0 && (d.lineItems?.length ?? 0) === 0 && (
                      <Text size="xs" c="dimmed">No active {d.currency} products in the catalog yet — add some at Product Catalog, or use a bare value instead.</Text>
                    )}
                    {(d.lineItems || []).map((item, li) => {
                      const product = catalogProducts.find((p) => p.id === item.productId);
                      const unitPrice = typeof item.unitPriceOverride === 'number' ? item.unitPriceOverride : (product?.unitPrice ?? 0);
                      const options = product && !pickableProducts.some((p) => p.id === product.id)
                        ? [{ value: product.id, label: `${product.name}${product.active ? '' : ' (inactive)'}` }, ...pickableProducts.map((p) => ({ value: p.id, label: p.name }))]
                        : pickableProducts.map((p) => ({ value: p.id, label: p.name }));
                      return (
                        <Group key={li} gap="xs" align="flex-end" wrap="nowrap">
                          <Select
                            size="xs"
                            label="Product"
                            aria-label="Product"
                            data={options}
                            value={item.productId || null}
                            onChange={(v) => setDealsForm((rows) => rows.map((r, idx) => idx === i ? { ...r, lineItems: (r.lineItems || []).map((li2, li2i) => li2i === li ? { ...li2, productId: v || '' } : li2) } : r))}
                            style={{ flex: 2 }}
                          />
                          <NumberInput
                            size="xs"
                            label="Qty"
                            aria-label="Quantity"
                            value={item.quantity}
                            onChange={(v) => setDealsForm((rows) => rows.map((r, idx) => idx === i ? { ...r, lineItems: (r.lineItems || []).map((li2, li2i) => li2i === li ? { ...li2, quantity: typeof v === 'number' ? v : 1 } : li2) } : r))}
                            min={1}
                            style={{ flex: 1 }}
                          />
                          <NumberInput
                            size="xs"
                            label="Unit price"
                            aria-label="Unit price override"
                            prefix={d.currency === 'EUR' ? '€' : '$'}
                            value={unitPrice}
                            onChange={(v) => setDealsForm((rows) => rows.map((r, idx) => idx === i ? { ...r, lineItems: (r.lineItems || []).map((li2, li2i) => li2i === li ? { ...li2, unitPriceOverride: typeof v === 'number' ? v : undefined } : li2) } : r))}
                            min={0}
                            style={{ flex: 1 }}
                          />
                          <ActionIcon size="sm" variant="subtle" color="red" aria-label="Remove line item" onClick={() => setDealsForm((rows) => rows.map((r, idx) => idx === i ? { ...r, lineItems: (r.lineItems || []).filter((_, li2i) => li2i !== li) } : r))}>
                            <IconTrash size={14} />
                          </ActionIcon>
                        </Group>
                      );
                    })}
                    <Button
                      size="compact-xs"
                      variant="subtle"
                      leftSection={<IconPlus size={12} />}
                      disabled={pickableProducts.length === 0}
                      onClick={() => setDealsForm((rows) => rows.map((r, idx) => idx === i ? { ...r, lineItems: [...(r.lineItems || []), { productId: pickableProducts[0]?.id || '', quantity: 1 }] } : r))}
                    >
                      Add line
                    </Button>
                    <Text size="xs" fw={600}>Running total: {formatTicketSizeCurrency(dealLineItemTotal(d), d.currency)}</Text>
                  </Stack>
                )}
              </Box>
              );
            })}
            <Button size="xs" variant="subtle" leftSection={<IconPlus size={14} />} onClick={() => {
              // Issue #169 — default a new manual deal to the currency
              // actually configured for this brand/tenant rather than a
              // hardcoded 'USD'. Prefers the lead's own computed ticket-size
              // currency (kept in sync with the Sales Settings currency
              // selector — see app/lib/ticket-size-store.ts), matching what
              // "Convert ticket estimate to a Deal" already does just above;
              // falls back to the brand's own default when no estimate has
              // been computed for this lead yet.
              const ticketSize = getTicketSize(lead);
              const defaultCurrency: CurrencyCode = (ticketSize && ticketSize.kind !== 'unconfigured' ? ticketSize.currency : undefined)
                ?? currency
                ?? 'USD';
              setDealsForm((rows) => [...rows, { value: '', currency: defaultCurrency, label: '' }]);
            }}>
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

      <Divider />

      <CadencePanel leadId={lead._id} brand={brand} activeCadence={lead.activeCadence} />

      <Divider />

      {/* Issue #207 — shares this brand's public booking page for this
          lead. A plain button rather than a GDS semantic ActionBar entry
          (the actions array above uses a constrained action-type registry
          not designed for an arbitrary new action like this one) —
          a deliberate, low-risk placement choice, not an attempt to
          extend that governed component's own contract. */}
      <Group justify="flex-end">
        <Button
          size="xs"
          variant="light"
          onClick={() => {
            const url = `${window.location.origin}/schedule/${brand}?leadId=${lead._id}`;
            navigator.clipboard.writeText(url)
              .then(() => showNotification({ message: 'Scheduling link copied', color: 'green', autoClose: 3000 }))
              .catch(() => showNotification({ message: 'Could not copy link', color: 'red', autoClose: 4000 }));
          }}
        >
          Copy scheduling link
        </Button>
      </Group>

      <ActivityPanel leadId={lead._id} brand={brand} contacts={lead.contacts} />

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
