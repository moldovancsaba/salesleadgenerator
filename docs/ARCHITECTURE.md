# Architecture — Sales Lead Generator

**Version:** 2.4.23

---

## System Context

```
┌───────────────────────────────────────────────────────┐
│                       Frontend                         │
│   /sales/[brand]   /outreach/templates   detail modal  │
└─────────────────────────┬───────────────────────────────┘
                          │ HTTPS
                          ▼
┌───────────────────────────────────────────────────────┐
│                     API Routes                         │
│   /api/leads   /api/health   /api/admin/*   outreach*   │
└─────────────────────────┬───────────────────────────────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
   ┌──────────────┐ ┌──────────────┐ ┌───────────────────┐
   │   MongoDB    │ │  Outcome +   │ │  Research Agent   │
   │   Atlas      │ │  Outreach    │ │  OpenClaw cron    │
   │              │ │  Logs        │ │                   │
   └──────────────┘ └──────────────┘ └───────────────────┘
```

---

## Frontend

- `/sales/[brand]` — pipeline page with kanban and table view. Implemented as a thin `async` Server Component (`app/sales/[brand]/page.tsx`) that awaits the Next.js 15 `params` Promise and resolves `brand`, rendering a Client Component (`app/sales/[brand]/sales-page-client.tsx`) that holds all interactive state and data fetching. This split exists specifically because Next 15's generated `PageProps` type requires `params: Promise<{...}>` on the page's exported component regardless of client/server boundary, and this repo's pinned React 18.3 has no `use()` hook to unwrap a Promise inside a Client Component — the Server Component wrapper resolves it once and passes a plain string prop down instead. As of 2.4.19, `page.tsx` also exports `generateMetadata()` returning the brand's display label (from `BRAND_CONFIG`/`resolveBrand()` in `app/lib/brand.ts`); the root layout's `metadata.title` is a `{ template: "%s · Sales Lead Generator", default: "Sales Lead Generator" }` object, so the browser tab reads `CogMap · Sales Lead Generator` / `Seyu · Sales Lead Generator` — brand name first, for scanning between tabs.
- `/outreach/templates` — template management UI
- `/salessettings/[client]` (2.4.20) — Company Setup / Sales Settings: a plain-language questionnaire (what a brand sells, who buys it, how it's priced, deal size, purchase frequency, upsell, sales cycle, an example customer, seasonality, notes) that a brand's own team fills in so the OpenClaw/KiloClaw research agent can refine lead scoring and revenue forecasts without requiring the respondent to know financial/accounting terminology (ACV/ARR/MRR etc. — see GitHub issue #24). Same Server Component/Client Component split as `/sales/[brand]` (`page.tsx` resolves `client` via `resolveBrand()` and exports `generateMetadata()` returning `"<Brand> Settings"`; `sales-settings-client.tsx` holds all form state). Deliberately built with plain Mantine primitives (`Checkbox.Group`, `NumberInput`, `Select`, repeatable product rows), not GDS Admin form wrappers — GDS has no equivalent for repeatable rows/checkbox groups this form needs, and this avoids further GDS integration surface area after 3.11.x's type-contract issues.
- Detail modal — lead actions, outreach compose, feedback

### Key client behavior
- Fetches all pages from `GET /api/leads?brand=<brand>` (cursor-paginated as of 2.4.7, looping on `hasMore`/`nextCursor` instead of a single capped fetch) and normalizes locally
- Uses `handleAction` for mutations: ACCEPT, DECLINE, PIN, REQUEST_REFRESH, COLUMN_MOVE, DELETE
- Uses `handleMove` for drag-to-column moves, invoked by GDS `KanbanBoard`'s `onMoveItem` (see below) — as of 2.4.0, `handleMove` is genuinely wired to a UI gesture; previously the function existed but nothing called it
- Shows Mantine notifications for success/failure
- No manual sort control exists in the UI (the header's Asc/Desc button was removed in 2.4.3 — it never actually sorted anything). DISCOVERED/QUALIFIED sort by ICE score server-side (2.4.4); ENGAGED/PROPOSAL/WON/LOST sort by `sortOrder`
- Detail modal is full-screen on mobile via `matchMedia`
- Predictive search bar (top-center, under the header): an always-editable `TextInput` with a debounced dropdown of matches from `GET /api/search?q=&brand=`; selecting a result opens the detail modal directly. Originally built with GDS's `SearchableSelect`, but that component is a closed combobox picker (a button that only reveals its real typing field once opened) rather than a search bar, and was confusing to use — replaced with a plain input in 2.4.1. Reads the response's `leads` array (renamed from `results` in 2.4.7)

### Kanban Lead Card
As of 2.4.17, `app/card.tsx`'s `LeadCard` renders **flat, borderless** content (plain Mantine `Stack`/`Group`/`Text`/`Badge`/`Button` — no `ProductCard`, no `Paper`/`Card` wrapper of its own). This replaced a `ProductCard`-based version (used 2.3.1–2.4.16) after GDS's own `KanbanCard` (see below) turned out to *always* wrap whatever `renderItem` returns in its own bordered `Paper` — nesting `ProductCard`'s own `withBorder` shell inside that produced a visible "box within a box" around every card. `LeadCard` is only ever used inside the kanban board's `renderItem`, so GDS's `KanbanCard` border is now the only border rendered. **Confirmed fixed on a real device (production) as of 2.4.18.** Cards show a "ticket size" row (`getTicketSize()` in `app/constants.ts`) — the estimated deal value, direct for CogMap (`estimated_annual_revenue_usd`), summed from per-lead pricing blocks for Seyu (`pricingByCompany`).

### Kanban Board and Drag-and-Drop
As of 2.4.10, `app/kanban.tsx` renders via GDS's governed `KanbanBoard` (`@sovereignsquad/gds-core/client`) instead of a hand-rolled implementation. GDS handles layout (`useGdsKanbanOrientation` resolves stacked-vs-columns responsively, no app-level breakpoint logic needed) and an unconditionally-rendered keyboard/tap-accessible "Move to column" menu per card as the accessible fallback for moving between columns. Each lead is mapped to a `KanbanItem`/`KanbanColumnData` pair; `renderItem` renders the flat `LeadCard` inside GDS's governed `KanbanCard` shell. Two API constraints shaped the mapping: `KanbanColumnData.title` is a plain string (not `ReactNode`), so the per-column pipeline-weighted forecast (sourced from `GET /api/boards/[brand]`'s `forecast.pipeline[COLUMN]`) is encoded into the title as one line (e.g. `"Discovered (12) · $45,231 wtd"`) rather than a separate styled subtitle; `KanbanColumn` has no footer/pagination slot, so the cursor-based infinite-scroll "load more" sentinel is rendered inside the last card's `renderItem` output instead of as a column-level sibling. `onMoveItem` wraps the existing `handleMove()` (optimistic removal from the source column, reload both columns from the server).

**`enableDrag` is deliberately off (as of 2.4.17)**, reverting a 2.4.10–2.4.16 attempt to enable it. `enableDrag` activates GDS's real `@dnd-kit`-based pointer/touch/keyboard drag (fully encapsulated inside `gds-core`, never a direct app import) plus a per-card drag-handle icon — but it was also the one genuinely new runtime code path in the whole GDS 3.11.x adoption that had never actually executed in a successful production build (every earlier deploy attempt from this bump failed before reaching it) before a live "client-side exception" was reported. **Confirmed as the actual fix as of 2.4.18** (real-device production confirmation: no more crash, mobile portrait correctly shows no drag handle) — not just a hypothesis. The keyboard/tap "Move to column" menu is unconditional and unaffected, so moving cards between columns still works fully without pointer drag; the owner has explicitly accepted this trade-off rather than asking for `enableDrag` back. If it's ever re-enabled in the future, `onMoveItem`'s same-column no-op guard (below) becomes relevant again: GDS's `SortableContext` allows same-column reordering, which this app's PATCH API has no way to represent (no arbitrary drop-position concept; `sortOrder` is ignored entirely for the two ICE-sorted auto-managed columns) — `handleMoveItem` already explicitly no-ops that case.

### PWA and Zoom Lock
- `app/globals.css` — `touch-action: manipulation` on `html`/`body`, the CSS layer iOS Safari respects for pinch/double-tap zoom prevention (unlike the viewport meta tag's `maximum-scale`/`user-scalable`, which iOS Safari has ignored since iOS 10). Separately, as of 2.4.1: a global `input, select, textarea { font-size: 16px }` rule prevents iOS Safari's *other* zoom mechanism — force-zooming the whole page on focus of any input whose computed font-size is below 16px (Mantine's default small/xs input sizes render below that threshold) — a distinct behavior from pinch-zoom, unaffected by `touch-action` or the viewport meta tag. That rule didn't actually apply to Mantine's own inputs until 2.4.6: Mantine's compiled CSS sets font-size via a class selector (higher specificity than a bare element selector), so it always won regardless of source order — `!important` was added to force the override
- `app/globals.css` — `overflow-x: hidden` / `max-width: 100vw` on `html`/`body` (2.4.5): a safety net against any single element pushing the page wider than the viewport on narrow screens
- `app/components/PwaSetup.tsx` — client component mounted in `app/layout.tsx`; adds a JS-level `gesturestart`/`gesturechange` + multi-touch `touchmove` guard as a last-resort zoom-prevention layer, and registers `public/sw.js`
- `public/sw.js` — minimal service worker; precaches only the static app-shell assets (`manifest.json`, `icon-192.png`, `icon-512.png`) and passes every page navigation and every `/api/*` request straight through to the network — deliberately never caches live lead/pipeline data
- `public/manifest.json` + `public/icon-192.png`/`icon-512.png` — PWA manifest and icons (the icon files are a functional placeholder pending real brand assets)

---

## API Layer

### Leads
- `GET /api/leads?brand=<brand>` — list leads with region/column filters, tenant-aware queries, UI dedup by fingerprint. Two pagination modes: legacy `page`/`limit` (default, unchanged since before 2.4.7 — still what the external research-agent's one-shot `?limit=1000` listing call uses) and opt-in cursor pagination (`?cursor=<value>`, added 2.4.7) returning `hasMore`/`nextCursor`; both modes are present in every response so existing callers ignoring the new fields are unaffected
- `POST /api/leads?brand=<brand>` — create lead with normalization, dedup, quality gate, ICE scoring, and outcome logging
- `PATCH /api/leads?brand=<brand>&id=<id>` — action lead via shared `lead-actions` helper
- `GET /api/leads/[id]?brand=<brand>` — fetch single lead
- `DELETE /api/leads/[id]?brand=<brand>` — delete lead
- `PUT /api/leads/[id]?brand=<brand>` — update lead fields for enrichment without requiring action workflow; validated the same as `POST`, but only for fields present in the request
- `GET /api/leads/columns?brand=<brand>&column=<col>` — cursor-paginated (`cursor`/`hasMore`) per-column lead loading, used by the kanban board's lazy column loading

### Boards and Metrics
- `GET /api/boards` — available brand boards and config (brand-agnostic)
- `GET /api/boards/[brand]?tenantId=<id>` — single board's metadata: counts, region breakdown, and a revenue forecast including a per-column, pipeline-weighted breakdown (`forecast.pipeline[COLUMN]`) for both `cogmap` (direct revenue estimates) and, as of 2.4.0, `seyu` (summed per-lead pricing blocks)
- `GET /api/metrics?brand=<brand>&tenantId=<id>` — per-column and per-region lead counts for a brand
- `GET /api/settings` — pipeline-weight settings (the `pipeline_weights` document, or defaults) used by forecast calculations
- `GET /api/forecast/export?format=csv|json` — CogMap revenue forecast, exportable as CSV

### Health and Observability
- `GET /api/health` — database connectivity, latency, brand counts, last error; `?tenantId=<id>` adds an opt-in per-tenant breakdown
- `GET /api/admin/cron-status` — cron observability
- `GET /api/admin/data-hygiene` — malformed lead counts by brand
- `GET /api/stats` — totals and breakdowns by column and region

### Outreach
- `GET /api/outreach-templates?mode=analytics` — template analytics
- `POST /api/outreach-templates` — create template
- `GET /api/outreach-logs` — outreach activity logs
- `POST /api/outreach-logs` — create outreach log with routing enforcement

### Learning
- `GET /api/search-learning` — search memory and success metrics
- `POST /api/search-learning` — update search memory from operator feedback
- `GET /api/search?q=<query>` — full-text search across leads, deduped by fingerprint (newest wins) as of 2.4.1, matching `/api/leads`'s existing dedup. Response shape unified with `/api/leads`/`/api/leads/columns` as of 2.4.7: `leads` (renamed from `results`), a real `count`, and `hasMore`/`nextCursor` — cursor pagination works when a specific `brand` is given (the only mode the app's own search bar uses); querying across every brand at once has no single resumable cursor across the independently-sorted collections, so that mode stays a flat capped list (`hasMore` always `false`)

### Feedback / Audit
- `GET /api/outcome-logs` — outcome-log history
- `POST /api/outcome-logs` — record an outcome log entry

### Sales Settings (2.4.20, auth corrected 2.4.21)
- `GET /api/sales-settings/[brand]?tenantId=<id>` — public; returns the stored `company_settings` document for `{brand, tenantId}`, or `emptySalesSettings()` with `source: 'default'` on first visit; `503` if `MONGODB_URI` is unset
- `PUT /api/sales-settings/[brand]?tenantId=<id>` — runs the body through `sanitizeSalesSettings()` (`app/lib/sales-settings.ts`) and upserts `{brand, tenantId, ...sanitized fields, updatedAt}` keyed by `{brand, tenantId}`. **Not** protected via `requireApiKey` (corrected in 2.4.21 — it originally was, which meant the browser Save button on `/salessettings/[client]` had no way to authenticate and got a hard `401` in any environment with `SLG_API_KEY` set, since there's no login/session system in this app to hold the secret safely client-side). Matches the same precedent `/api/settings`'s PUT already established for its own browser-edited document; company settings carry no lead/contact PII, so an anonymous write's blast radius is limited to a company's own sales-context text.

---

## Data Model

### Lead
Stored in brand-aware collections:
- `leads` for `cogmap`
- `seyu_leads` for `seyu`

Canonical contact storage is `contacts[]`. Top-level contact fields are merged into `contacts[]` on write and cleared from responses where possible.

Key fields:
- `entity_name`, `url`, `region`, `country`
- `contacts[]` with `name`, `title`, `email`, `phone`, `linkedin`, `role`
- Organization-agnostic pros/cons (as of 2.3.0): `pro_for_organization`, `con_for_organization` — one shared field name across every brand/tenant, not brand-specific (`PRO_FIELD`/`CON_FIELD` in `app/lib/brand.ts`)
- `kanbanColumn`, `sortOrder`
- `fingerprint` — SHA1 of `url + entity_name + region`
- `ice.impact`, `ice.confidence`, `ice.ease`
- `scoreProfile` — blended scoring dimensions
- `tenantId` — optional tenant scoping
- `feedbackScore`, `declineCount`, `acceptanceCount`
- `manualLaneOverrideAt`, `manualLaneCooldownUntil`, `manualLaneFloorColumn`

Indexes (created by `scripts/migrate-check-schema.js`, not verified against the live Atlas cluster from this environment):
- `fingerprint`
- `kanbanColumn`, `sortOrder`
- `region`, `kanbanColumn`

Note: a text index on `entity_name`/`industry`/`sport_or_sector` was previously listed here but no `createIndex` call for one exists anywhere in this repo, and current search (`GET /api/search`) implements matching via `$regex`, not `$text` — removed rather than stated as fact without a way to verify it against Atlas from this environment.

### Outcome Log
Collection: `outcomelogs` (lowercase) — used by `app/api/leads/route.ts`, `app/lib/lead-actions.ts`, `app/api/admin/cron-status/route.ts`, and (as of 2.2.3) `app/api/outcome-logs/route.ts`. All outcome-log readers/writers now agree on this one collection.

Records mutations with before/after state, actor, teaching weight, and tenant.

### Outreach Template and Log
Collections: `outreach_templates`, `outreach_logs`

Templates are organization-agnostic and scoped by `tenantId` and `brand`. Logs enforce channel routing rules at write time.

### Search Learning
Collection: `searchlearnings`

Tracks query success, accepted/declined counts, top terms, and top domains.

### Company Settings (2.4.20)
Collection: `company_settings` — one document per `{brand, tenantId}` (see `app/lib/sales-settings.ts`'s `SalesSettings` type for the full shape: company basics, repeatable `products[]` with per-product buyer/pricing/predictability fields, deal size, purchase frequency, upsell, sales cycle, an example customer, and seasonality). Written only via `PUT /api/sales-settings/[brand]`'s upsert; read by both the settings page and, going forward, the OpenClaw/KiloClaw research agent alongside the static `agent-runtime/tenants.json` config.

---

## Request and Response Flows

### List Leads
1. Frontend calls `GET /api/leads?brand=<brand>&limit=500` — as of 2.4.7, with `cursor=<nextCursor>` on subsequent requests, looping until `hasMore` is `false` (no more hard-capped single fetch)
2. Route builds tenant-aware filter; legacy docs without `tenantId` are included for `default`
3. Without `cursor`: legacy path, sorts by `kanbanColumn`, `sortOrder`, `createdAt`, paginated via `page`/`skip`. With `cursor`: sorts by `createdAt desc, _id desc` (matching the dedup step's final order below) and paginates via the cursor instead
4. Response dedups by fingerprint client-side and strips top-level contact fields
5. Frontend normalizes and renders kanban or table view

### Create Lead
1. Frontend or agent calls `POST /api/leads?brand=<brand>`
2. `requireApiKey` enforces auth
3. Request body is validated
4. Contact fields and address are normalized
5. Brand-aware pros/cons are normalized
6. Duplicate detection uses fingerprint match across tenant and legacy docs
7. ICE score is calculated from impact, confidence, and ease
8. Quality gate rejects low-confidence/ease leads without verified contact
9. Lead is inserted with `sortOrder = count * 100`
10. Outcome log records creation

### Action Lead
1. Frontend calls `PATCH /api/leads?brand=<brand>&id=<id>` with action payload
2. `requireApiKey` enforces auth
3. `executeLeadAction` loads lead, validates patch, applies action-specific updates
4. Supported actions: ACCEPT, DECLINE, MODIFY, PIN, REQUEST_REFRESH, COLUMN_MOVE
5. Outcome log records mutation with before/after state
6. Response returns normalized lead

### Update Lead
1. Frontend or agent calls `PUT /api/leads/[id]?brand=<brand>` with field updates
2. `requireApiKey` enforces auth
3. Request body is validated via `validateLeadPayload(body, brand, { partial: true })` — the same rules `POST` enforces (URL format, ICE range, forbidden cross-brand vocabulary), but only for whichever fields are actually present in the partial update, not required unconditionally
4. Route updates allowed fields without requiring the ACCEPT/DECLINE/etc. action workflow
5. **Auto-reclassification (2.4.4):** if the update includes `ice` and does *not* also explicitly include `kanbanColumn`, and the lead's current `kanbanColumn` is `DISCOVERED` or `QUALIFIED` (`isAutoManagedColumn()`), the route recomputes the ICE score from the new `ice` values and sets `kanbanColumn = deriveKanbanColumn(newIceScore)`. A lead that has been moved to `ENGAGED`/`PROPOSAL`/`WON`/`LOST` (by drag-and-drop or an action) is never auto-moved again regardless of later score changes.
6. **`ice` is coerced to real numbers before storing (2.4.8):** unlike `POST` (which runs the whole body through `normalizeLead()`'s `ensureNumber()`), this route previously copied `body.ice` verbatim — `validateLeadPayload` only range-checks it via `Number()`, it never mutates the stored value. A request with numerically valid but string-typed ICE fields would pass validation yet persist as strings, which then broke the sort aggregation below (`$multiply` throws on a string operand). Fixed to match `POST`'s guarantee.
7. Response returns updated lead

### Kanban Column Chunk (auto-classification and sort rule, 2.4.4)
`GET /api/leads/columns?column=<COLUMN>` is the kanban board's sole read path (cursor-paginated, `CHUNK_SIZE = 50`) — sorting happens entirely in this server-side aggregation, never client-side; the frontend renders whatever order the response returns. Its sort behavior branches by column:
- **`DISCOVERED`** (ICE < 500) and **`QUALIFIED`** (ICE ≥ 500) are auto-managed: leads are placed here purely by computed ICE score, and the column always sorts high → low by that score. There is no stored, denormalized sort field for these two columns — the route runs an aggregation pipeline (`$addFields` using `ICE_SCORE_AGGREGATION_EXPR`, then `$sort: { _iceScore: -1, _id: -1 }`), and cursor pagination is encoded as `<iceScore>|<id>` instead of `sortOrder`. As of 2.4.8, the expression reads each ICE field via `$convert` (`to: 'double'`, safe `onError`/`onNull` fallback to 0) rather than a bare `$multiply` on the raw stored value — this recovers the real number from an already-corrupted numeric-string field instead of throwing and failing the whole column fetch.
- **`ENGAGED`, `PROPOSAL`, `WON`, `LOST`** remain exclusively user-managed: unchanged `sortOrder`-based sort (`{ sortOrder: -1, createdAt: -1 }`), cursor encoded as `<sortOrder>|<id>`. A lead only reaches one of these columns via an explicit action (drag-and-drop `COLUMN_MOVE`, `ACCEPT`, `PIN`, etc.) and is never auto-moved out of it by a score change.

Placement rule: a lead moves between `DISCOVERED`/`QUALIFIED` automatically whenever its `ice` score is updated (see "Update Lead" above) or at creation (`deriveKanbanColumn` in `POST /api/leads`). Moving a card out to any of the 4 manual columns (drag-and-drop or an action) changes `kanbanColumn` explicitly, which permanently opts that lead out of auto-classification.

### Outreach
1. Frontend posts to `/api/outreach-logs` with lead context and channel
2. Routing rules evaluate channel eligibility
3. If allowed, log is persisted with routing metadata
4. Analytics endpoint aggregates logs by template and channel

---

## Module and Responsibility Map

### `app/api/*/route.ts`
HTTP handlers for leads, health, outreach, learning, search, stats, and boards.

### `app/lib/*`
- `brand.ts` — brand config and resolver
- `normalize-lead.ts` — lead normalization, warning extraction
- `lead-actions.ts` — canonical mutation logic and outcome logging
- `metrics.ts` — scoring and quality metrics
- `outreach/routing-rules.ts` — channel routing enforcement
- `outreach/default-templates.ts` — default template definitions
- `request-id.ts` — request tracing

### `lib/*`
- `mongodb.ts` — MongoDB client promise, `isMongoConfigured()`
- `api-auth.ts` — API key enforcement
- `validate-lead.ts` — shared validation (`validateLeadPayload`, with a `{ partial: true }` mode for updates; `validatePatchPayload` for action-envelope patches)
- `fingerprint.ts` — dedup hash (`SHA1(url + entity_name + region)`), used by `app/api/leads/route.ts`
- `kanban-column.ts` — ICE-score → kanban-column mapping (2-tier, 500 threshold), `isAutoManagedColumn()`, and `ICE_SCORE_AGGREGATION_EXPR` (Mongo aggregation mirroring `getIceScore()`); shared by `app/api/leads/route.ts` (creation), `app/api/leads/[id]/route.ts` (reclassify-on-update), and `app/api/leads/columns/route.ts` (ICE-based column sort)
- `pipeline-weights.ts` — pipeline-weight forecast defaults + `settings`-collection lookup, shared by `stats`, `boards/[brand]`, and `forecast/export` routes
- `tenant.ts` — `getTenantId()`/`tenantFilter()`, shared by `stats`, `boards/[brand]`, and `health` routes
- `public-data.ts` — fallback public data
- `quality-registry.ts` — quality ceiling enforcement
- `request-retry.ts` — retry helper

---

## Auth, Middleware, CORS, and Security

### Middleware
- Matches `/api/:path*`
- Sets CORS headers for allowed origins
- Sets security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
- Handles OPTIONS preflight

### API Key Auth
- `requireApiKey` guards write and admin endpoints
- Read endpoints are public
- Key is passed via `x-api-key` header
- When `SLG_API_KEY` is set, a request is rejected (401) unless it sends the exact matching header — a missing header is rejected identically to a wrong one. When `SLG_API_KEY` is unset entirely, all requests are allowed through (documented fail-open behavior for local/dev use)

### Input Validation
- POST, PUT, and PATCH payloads are all validated before processing (`validateLeadPayload`, with `{ partial: true }` for `PUT`'s partial updates; `validatePatchPayload` for action-envelope `PATCH`es)
- Brand-aware field normalization prevents cross-tenant writes
- Schema mapper/validator blocks forbidden cross-brand vocabulary in free-text fields (e.g. `value_proposition`). The pro/con fields themselves stopped being brand-specific in 2.3.0 — there's nothing left to forbid cross-brand there, since every brand shares one generic field

---

## Deployment and Environment

- Vercel production deployment
- `MONGODB_URI` is required for database access
- Type checking via `tsc --noEmit` recommended in memory-limited environments
- Health and stats endpoints provide runtime observability

---

## Tenant Isolation

- Each brand maps to its own MongoDB collection
- `tenantId` scopes queries; default includes legacy docs without `tenantId`
- Pros/cons fields are generic and shared across brands (2.3.0) — isolation between brands comes from the separate `leads`/`seyu_leads` collections, not from field naming
- Outreach templates and logs are tenant-scoped
