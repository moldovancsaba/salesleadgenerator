# Roadmap — Sales Lead Generator

**Version:** 2.4.8

---

## Shipped

### PUT /api/leads/[id] Silently Corrupting ICE Fields, Breaking the Sort (2.4.8)
- ✅ Confirmed the ICE-score sort's architecture is correct as designed: sorting is entirely server-side (a MongoDB aggregation in `GET /api/leads/columns`), never re-sorted client-side; the client only computes ICE scores for display (a trivial per-card multiply), not for ordering.
- ✅ Found and fixed the real bug behind "sort still not working": `PUT /api/leads/[id]` stored `ice.impact`/`confidence`/`ease` straight from the request body with no numeric coercion (unlike `POST`, which runs through `normalizeLead()`'s `ensureNumber()`). A request with numerically-valid but string-typed ICE values would pass validation and get persisted as strings, which then made MongoDB's `$multiply` throw during the sort aggregation — failing the *entire* column's fetch (not just the one bad document), silently, with no visible error. Fixed by coercing `ice` to real numbers before storing.
- ✅ Made `ICE_SCORE_AGGREGATION_EXPR` resilient regardless: reads each field via `$convert` (numeric-string recovery, safe fallback to 0 instead of throwing) — self-heals any already-corrupted historical document without a data migration.

### Mongoose Models Deleted, Pagination Unified on Cursors (2.4.7)
- ✅ Resolved issue #20: `models/Lead.ts`, `OutcomeLog.ts`, `SearchLearning.ts` deleted — zero importers anywhere (re-verified), schemas had drifted from reality, and nothing in the codebase signaled an intended future Mongoose migration path (`mongoose` itself remains a real dependency, used only as a connection helper in `scripts/*.js` maintenance scripts). `docs/STACK_AND_DEPENDENCIES.md` updated to match.
- ✅ Resolved issue #21: `/api/leads`, `/api/search`, and `/api/leads/columns` now share one pagination contract (`hasMore`/`nextCursor`, cursor-paginated). `/api/leads` keeps its legacy `page`/`limit`/`totalPages` fields working exactly as before — `cursor` is opt-in, so the research agent's existing one-shot `?limit=1000` listing call (a consumer this repo doesn't control) is completely unaffected. `/api/search` renamed `results` → `leads` and added a real `count`; cursor pagination applies when a specific `brand` is given (the only mode the app's own search bar uses), and stays an honest flat capped list when searching every brand at once (no single resumable cursor across independently-sorted collections). The table view's frontend fetch switched from a single hard-capped `limit=5000` request to looping on `hasMore`/`nextCursor`, removing a silent-truncation risk for any brand that ever exceeds 5000 leads.

### Mantine Inputs Still Force-Zooming on iOS Safari (2.4.6)
- ✅ The 2.4.1 focus-zoom fix (`input, select, textarea { font-size: 16px }`) never actually applied to Mantine's own inputs — Mantine's compiled CSS sets font-size via a class selector with higher specificity than a bare type selector, so it silently won every time regardless of source order. The header's view-mode dropdown (and potentially the Mantine search `TextInput`) kept force-zooming as a result. Added `!important`, which unconditionally wins the cascade; widened the view-mode `Select` (132px → 168px) to fit its longest label at the now-enforced 16px font.
- ⚠️ Real-device (iOS Safari) confirmation still recommended — this is a browser behavior with no headless/desktop equivalent to screenshot, so verification here was limited to confirming the compiled CSS and CSS-cascade semantics, not a live rendering.

### Header Overflow, Desktop Detail Panel, and Stuck Drag-Ghost Fixes (2.4.5)
- ✅ Header no longer overflows the screen on narrow viewports — compacted to brand name + view selector on one row, then a single terse leads-count / weighted-forecast line, dropping the verbose "· updated HH:MM:SS" and "Forecast:"/"weighted" wording; added a global `overflow-x: hidden` safety net in `app/globals.css`.
- ✅ Fixed the desktop/tablet-width (≥1280px) lead detail panel silently missing its entire body — `AdminDetailDrawer` (`app/detail.tsx`) was only ever given `metadata` (name + 3 badges), never `content` (ICE score, contacts, pros/cons, value proposition, feedback history, and every action button), unlike the mobile `AdminModal` branch which always had it.
- ✅ Fixed a stuck drag-ghost and permanently-dimmed source card after an ordinary quick tap on a kanban card — `app/kanban.tsx`'s drag-arm timer was only cancelled on excess pointer movement, never on `pointerup`/`pointercancel`, so a normal tap-and-release still activated a "drag" ~200ms later with no matching pointerup left to clear it.

### Kanban Auto-Classification and ICE Sort Rule (2.4.4)
- ✅ `DISCOVERED` (ICE < 500) and `QUALIFIED` (ICE ≥ 500) are the only two auto-managed columns — placement and sort order both driven purely by computed ICE score, always high to low, no other sort. Replaces the old, never-quite-matching 3-tier 480/720 logic that also auto-promoted to `ENGAGED`.
- ✅ `PUT /api/leads/[id]` auto-reclassifies a lead still sitting in `DISCOVERED`/`QUALIFIED` whenever its `ice` score changes (and the request doesn't also explicitly set `kanbanColumn`).
- ✅ `GET /api/leads/columns` sorts the two auto-managed columns by a computed-ICE-score aggregation instead of `sortOrder`; the 4 manual columns (`ENGAGED`/`PROPOSAL`/`WON`/`LOST`) are untouched — a lead moved there via drag-and-drop or an action is never auto-reclassified again, and stays on its existing user-controlled `sortOrder`.
- ✅ Removed the now-superseded, always-unreferenced `ICE_QUALIFIED_THRESHOLD` constant from `app/constants.ts`.

### Security and Dependency Hardening (2.2.0)
- ✅ Fixed API-key auth bypass (missing `x-api-key` header was previously treated as success)
- ✅ Added missing API-key check to `/api/outcome-logs` POST
- ✅ Upgraded Next.js 14.2.18 (14 open CVEs) → 15.5.13+
- ✅ Migrated ESLint from no working config to a real, working ESLint 9 flat config
- ✅ Fixed `PUT /api/leads/:id` silently skipping validation that `POST` enforces
- ✅ De-duplicated fingerprint, kanban-column, `isMongoConfigured()`, and pipeline-weight logic into shared `lib/*` modules
- ✅ Removed 3 orphaned/dead modules (`app/lib/validate-lead.ts` duplicate, `app/lib/ai-scoring/`, `lib/lead-validator.ts`)
- ✅ Corrected `Lead.region`'s frontend type and a resulting live badge-color bug
- ✅ `CLAUDE.md` operating rules recorded for future sessions

### PWA and Zoom Fix (2.2.1)
- ✅ Root-caused and fixed pinch-zoom still working despite 3 prior attempts: the viewport meta tag alone was never sufficient, since iOS Safari has ignored `user-scalable=no`/`maximum-scale` since iOS 10. Added `touch-action: manipulation` CSS plus a JS-level gesture/multi-touch guard, the layers iOS Safari actually respects.
- ✅ Root-caused and fixed the app never behaving as an installable PWA: `manifest.json`'s referenced icon files (`icon-192.png`, `icon-512.png`) didn't exist at all. Added real icons plus a minimal service worker (precaches only the static shell — manifest/icons — never live lead data).
- ✅ Real-device zoom-lock verification: confirmed working on a real device (2026-07-23).
- ⚠️ PWA installability: reported by the owner as still not behaving as expected on a real device (2026-07-23) — specifics not yet gathered, tracked as an open question.

### Pagination Field Fix (2.2.2)
- ✅ Fixed `/api/leads`'s misleadingly-named `total` field (issue #21's low-risk sub-fix) to reflect the real total across all pages instead of the current page's count; per-page count moved to a new `returned` field. No frontend consumer read the old field, so this shipped with zero UI changes needed.

### Outcome-Logs Collection Fix (2.2.3)
- ✅ Resolved issue #11 via a temporary production diagnostic endpoint: `outcomeLogs` (camelCase) held 0 documents, `outcomelogs` (lowercase) held 2,276 with same-day activity. `/api/outcome-logs` now reads/writes `outcomelogs`, matching every other call site. Diagnostic endpoint deleted after use.

### Generic Organization Fields (2.3.0)
- ✅ Resolved issue #20's organization-genericness complaint: `pro_for_cogmap`/`pro_for_seyu` (and the `con_` equivalents) replaced with one shared `pro_for_organization`/`con_for_organization` pair used by every brand — hard cutover, no fallback. All 900 existing production documents were migrated in place via a temporary endpoint before the code shipped, so there was no gap where pros/cons appeared empty.

### Kanban Card Image Placeholder Fix (2.3.1 / 2.3.2)
- ✅ Kanban cards no longer show an empty image placeholder — switched `LeadCard` from `AdminResourceCard` to `ProductCard` (`@sovereignsquad/gds-core`), whose media/icon slots render nothing when omitted, matching the fact that leads have no image field at all. Verified against the real design-system source rather than guessed.
- ✅ Found and fixed a second, separate `AdminResourceCard` usage in `app/search-learning.tsx`'s "Top Queries" cards, which the 2.3.1 fix didn't touch: `AdminResourceCard` has a `hideWhenNoMedia` prop (documented as omitting the placeholder for no-media records) that neither usage in this repo ever set, defaulting to showing it. Added the prop.

### Kanban Board UX Overhaul (2.4.0)
- ✅ Header layout: view selector pinned top-right; Region/Status filter dropdowns removed entirely.
- ✅ Predictive lead search bar (top-center, under the header), backed by the existing `/api/search` endpoint.
- ✅ Rebuilt kanban drag-and-drop from scratch — it was completely absent from the code despite being listed as historically shipped. Pointer-events-based, long-press-to-arm, ghost preview, drop-target highlight, optimistic UI, full cleanup on cancel.
- ✅ Ticket size shown on each lead card (CogMap: direct revenue estimate; Seyu: summed from per-lead pricing blocks).
- ✅ Discounted (pipeline-weighted) forecast shown on each kanban column header, for both brands.

### Search Bar and Focus-Zoom Fixes (2.4.1)
- ✅ Fixed page force-zoom on search-input focus (iOS Safari zooms below-16px focused inputs — separate from pinch-zoom) — global 16px minimum font-size for inputs/selects/textareas.
- ✅ Replaced the search bar's `SearchableSelect` (a closed combobox picker, wrong fit — real typing field was hidden and didn't look like an input) with a plain always-editable text input and custom predictive dropdown.
- ✅ Fixed duplicate results in `/api/search` — added the fingerprint-based dedup `/api/leads` already had.

### PATCH /api/leads Actions Actually Working (2.4.2)
- ✅ Found and fixed a serious bug affecting every kanban/detail-modal action, not just drag-and-drop: `PATCH /api/leads` requires `id` as a URL query param (matching its own documented contract), but the client only ever sent it in the JSON body — every action has been silently 400ing. Reported as "drag and drop looks like it moves, then snaps back"; root-caused and fixed in both `handleAction` and `handleMove`.

### Outreach and Pipeline
- ✅ One-click outreach templates with analytics (`/api/outreach-templates?mode=analytics`)
- ✅ Outreach routing enforcement in outreach logs
- ✅ Template management UI at `/outreach/templates`
- ✅ Canonical kanban action path with shared helper
- ✅ Backward-compatible tenant queries

### Observability
- ✅ `/api/health` expansion
- ✅ `/api/admin/cron-status`
- ✅ `/api/admin/data-hygiene`
- ✅ `/api/stats`

### Data Quality
- ✅ Server-side normalization and validation
- ✅ Fingerprint deduplication on write
- ✅ Quality gate for low-confidence leads

### UX
- ✅ Mobile-first kanban and table view toggle
- ✅ Detail modal actions with toast feedback
- ✅ Retry utility for transient failures
- ✅ Mobile/PWA usability and zoom tightening
- ✅ Responsive list/table view for mobile
- ✅ Enlarged kanban drag affordance
- ✅ Collapsible kanban columns
- ✅ Country-based filters
- ✅ Live kanban column lead counts
- ✅ Removed tenantId/default input field from pipeline UI
- ✅ Won column header = green
- ✅ Lost column header = red
- ✅ Kanban card drag-and-drop interaction with pointer events
- ✅ Card selection/drag state cleanup after drag
- ✅ Pointer-capture cleanup and ghost removal on cancel/interrupt
- ✅ Table view contrast fix: dark text on light background
- ✅ Table view simplified columns for mobile
- ✅ Validation smoke tests (`npm run test:smoke`)

---

## In Progress

| Item | Notes |
|------|-------|
| iOS focus-zoom real-device confirmation (2.4.6) | The `!important` fix is confirmed correct by CSS-cascade semantics and by inspecting the actual compiled/served stylesheet, but this sandbox has no way to reproduce iOS Safari's zoom-on-focus behavior itself (no headless/desktop equivalent) — a real-device check is still recommended |
| Available countries visibility | Country filter UI is implemented, but live lead data currently lacks populated `country` values, so the list may appear empty until data is backfilled or mapped from `region` |
| Table view PWA polish | Core mobile table implemented; additional density/readability tuning may be needed |
| Orphaned standalone scripts with drifted kanban-column logic | `lead-feeder-agent.js` and `scripts/migrate-check-schema.js` each contain their own, separate ICE→column derivation with different (older) thresholds than the real `lib/kanban-column.ts`; neither is wired into any `npm` script or the running app — flagged as of 2.4.4, not yet resolved |
| PWA installability real-device gap | Owner reports install behavior still not as expected on a real device; needs specifics (platform, symptom) before a further fix can be scoped |

---

## Planned

| Phase | Item | Target Outcome |
|-------|------|----------------|
| 2 | Auto-enrichment pipeline | Reduce manual research |
| 2 | Team workspaces | Multi-user pipelines |
| 2 | AI scoring calibration | Model trust and tuning |
| 3 | CRM sync | Enterprise readiness |
| 3 | Attribution | Prove ROI |
| 3 | Analytics dashboard | Pipeline health visibility |
| 4 | Client API and webhooks | External integration |
| 4 | Advanced enrichment | Richer contact data |

---

## Traceability

- Implementation details: `CHANGELOG.md`
- Architecture and data flow: `docs/ARCHITECTURE.md`
- Operator workflows: `docs/OPERATOR_GUIDE.md`
- Stack and dependencies: `docs/STACK_AND_DEPENDENCIES.md`
- Operating rules for Claude sessions: `CLAUDE.md`
