# Changelog — Sales Lead Generator

## 2.4.7

Resolved the two "flag only" decisions left open from the second audit pass (GitHub issues #20 and #21) — both were closed previously with only their low-risk sub-fixes shipped, the actual decisions never made.

### Removed
- **`models/Lead.ts`, `models/OutcomeLog.ts`, `models/SearchLearning.ts` deleted** (issue #20, decision: delete). Re-verified zero importers anywhere in `app/`, `lib/`, or `scripts/`. Their schemas had drifted from reality (a `status` enum unrelated to the real `kanbanColumn` vocabulary, missing `seyu` field equivalents), and nothing in the codebase — no comment, no doc, no in-progress code — signaled an actual planned migration to Mongoose; the app has exclusively used the raw `mongodb` driver for all real reads/writes since before this repo's own tracked history. `mongoose` remains a legitimate direct dependency: several standalone maintenance scripts (`scripts/seed.js`, `scripts/check-db.js`, `scripts/audit-db.js`, `scripts/fix-*-region*.js`) use `mongoose.connect()` purely as a connection helper, then operate via the raw driver underneath (`mongoose.connection.db.collection(...)`) — none of them import the deleted model files. `docs/STACK_AND_DEPENDENCIES.md` updated to describe this accurately.

### Changed
- **Unified the three lead-listing endpoints' pagination shapes** (issue #21, decision: unify on cursor pagination). `/api/leads`, `/api/search`, and `/api/leads/columns` now all return `hasMore`/`nextCursor`.
  - `/api/leads`: cursor support added **additively and opt-in** — a request without `cursor` behaves exactly as before (same `page`/`limit`/`totalPages`/`total`/`returned` fields, same default sort), because this endpoint has a real external consumer this repo doesn't fully control: the research agent's one-shot `GET /api/leads?brand=<tenantId>&limit=1000` listing call (referenced in `agent-runtime/schema-mapper.js` and both discovery/enrichment prompts). Sending `cursor=<value>` switches to a `createdAt desc, _id desc` sort and returns `hasMore`/`nextCursor` for that request only.
  - `/api/search`: fully converted, since its only real consumer is this app's own predictive search bar (verified — no other in-repo or external caller found). `results` renamed to `leads`; the previous `total` field (which was actually just `results.length`, a smaller-scale version of the same naming trap `/api/leads` had before 2.2.2) replaced with a real `count` from `countDocuments`. Cursor pagination works when a specific `brand` is requested (the only mode the search bar uses); querying across every brand at once merges two independently-sorted collections with no single resumable cursor position, so that mode honestly stays a flat capped list (`hasMore` always `false`) rather than faking a cursor that couldn't actually resume correctly.
  - `sales-page-client.tsx`'s table-view fetch switched from a single hard-capped `limit=5000` request to looping on `hasMore`/`nextCursor` — removes a silent-truncation risk for any brand that ever exceeds 5000 leads, and the predictive search handler updated to read `data.leads` instead of the now-renamed `data.results`.

### Verification note
Confirmed via direct grep across `app/`, `lib/`, `agent-runtime/`, and `scripts/` that no in-repo code reads `/api/leads`'s `page`/`total`/`totalPages` fields (only the external research-agent integration touches this endpoint outside the frontend, and only to build the request URL, not parse pagination metadata from the response) — this is why the additive, non-breaking approach was chosen for `/api/leads` specifically rather than a hard cutover.

## 2.4.6

### Fixed
- **The header's view-mode dropdown (and, latently, every other Mantine input in the app) still force-zoomed on iOS Safari despite the 2.4.1 fix.** Root cause: the 2.4.1 fix added `input, select, textarea { font-size: 16px }` (a bare element selector, CSS specificity 0-0-1), but Mantine's own compiled stylesheet sets each input's font-size via a hashed class selector (`.m_8fb7ebe7 { font-size: var(--input-fz, ...) }`, specificity 0-1-0) — which always outranks a type selector regardless of source order. That rule silently never applied to any Mantine `Select`/`TextInput`/etc., only to plain native inputs outside Mantine, which is why the search bar (added later, also Mantine) may have been just as affected and the dropdown specifically was reported. Confirmed by inspecting Mantine's actual shipped CSS (`node_modules/@mantine/core/styles.css`) rather than guessing, and confirmed no existing `!important` font-size rule in Mantine's stylesheet that could out-rank a fix. Added `!important` to the global rule, which unconditionally wins the cascade.
- Widened the header's view-mode `Select` from 132px to 168px to comfortably fit "Search Learning" at the now-correctly-enforced 16px font (it was previously rendering at Mantine's much smaller "xs" font size, ~12px, before this fix took effect).

### Verification note
This is an iOS Safari-only rendering behavior with no equivalent in desktop/headless Chromium, so it cannot be visually screenshotted from this sandbox even with a working browser-automation setup (Playwright itself couldn't be installed here either — it re-triggers `npm install`, which fails on this repo's private GDS package tarballs, the same longstanding sandbox constraint noted elsewhere in this changelog). What *was* verified directly: the compiled CSS served by a real `next dev`/`next build` run contains the `!important` rule exactly as written, and per the CSS specification `!important` unconditionally overrides any non-`!important` declaration regardless of selector specificity or source order — this is deterministic, not something that requires a live device to confirm. Real-device (iOS Safari) confirmation is still recommended before considering this closed.

## 2.4.5

Three real bugs from a live device screenshot review of the header/search bar and a desktop-width lead detail panel.

### Fixed
- **Header and search bar overflowed the screen on narrow viewports.** The header `Group` used `wrap="nowrap"` with three lines of verbose dimmed text ("408 leads · updated 11:15:48 AM", "Forecast: $1,382,687 weighted") next to the view-mode `Select`; on a phone-width screen the combined row was wider than the viewport, and since neither side could shrink or wrap, the `Select` (and, once the page had any horizontal overflow, everything below it) rendered partly or fully off-screen instead of clipping safely. Reworked the header to two compact rows — brand name + view selector (selector now has a fixed, safe width and the title truncates instead of forcing width), then a single terse `<leads count>` / `<weighted forecast>` line, dropping the "· updated HH:MM:SS" and "Forecast:"/"weighted" wording entirely per the owner's requested format. Also added a global `overflow-x: hidden` safety net (`app/globals.css`) so a future stray element can't reproduce a screen-wide overflow again.
- **The desktop/tablet-width (≥1280px) lead detail panel was missing its entire body.** `LeadDetailModal` (`app/detail.tsx`) renders one of two GDS overlays depending on viewport width: `AdminModal` (mobile, <1280px) or `AdminDetailDrawer` (desktop/tablet, ≥1280px). The `AdminModal` call passed `{content}` (ICE score, contacts, pros/cons, value proposition, feedback history, and every action button/decline-reason/annotation field) as children — but the `AdminDetailDrawer` call only ever passed `metadata` (just the entity name and 3 badges), never `content`. Reading `AdminDetailDrawer`'s real source (`packages/gds-admin/src/AdminOverlays.tsx`, via `raw.githubusercontent.com`) confirmed it renders `{media}`, `{metadata}`, then `{children}` — so the drawer had been silently missing everything past the name/badges on any screen ≥1280px wide, with no way to Accept/Decline/Pin/Refresh/Delete a lead from that view at all. Added `{content}` as `AdminDetailDrawer`'s children, matching the `AdminModal` branch.
- **A quick tap on a card (or its Preview button) could leave a permanent, stuck drag-ghost.** `app/kanban.tsx`'s long-press-to-arm drag gesture starts a 200ms timer on `pointerdown`; the accompanying `pointerup`/`pointercancel` watcher only removed its own listeners, it never cancelled the pending timer. A normal quick tap releases the pointer well before 200ms elapses, so the timer still fired afterward and set `dragState` — with no future `pointerup` on that now-released `pointerId` ever going to arrive to clear it (each new touch gets its own `pointerId`). The result: the floating ghost label and the source card's dimmed (`opacity: 0.4`) state got stuck on screen indefinitely after ordinary taps, exactly as seen live (a stray "Liverpool FC" ghost label sitting over a permanently-dimmed card). Fixed by cancelling the arm timer on `pointerup`/`pointercancel`, not only on excess movement.

### Note
Same 3 pre-existing `react-hooks/exhaustive-deps` ESLint warnings remain in untouched `app/outreach/*` files, carried forward as recorded.

## 2.4.4

Owner-specified kanban auto-classification/sort business rule, previously only partially wired (a `deriveKanbanColumn` existed with the wrong thresholds and 3 tiers including an auto-`ENGAGED` promotion; `ICE_QUALIFIED_THRESHOLD = 500` was declared in `app/constants.ts` but never referenced anywhere — strong evidence this 500-threshold rule was the original intended design that never got finished).

### Changed
- **`lib/kanban-column.ts` rewritten to a strict 2-tier rule.** `DISCOVERED` = ICE score < 500, `QUALIFIED` = ICE score ≥ 500. The old 3-tier version (480/720 thresholds, auto-promoting to `ENGAGED`) is gone — `ENGAGED`/`PROPOSAL`/`WON`/`LOST` are never reached by automatic classification, only by an explicit user action (drag-and-drop, Accept, Pin, etc.). Added `AUTO_MANAGED_COLUMNS`/`isAutoManagedColumn()` and `ICE_SCORE_AGGREGATION_EXPR` (a Mongo aggregation expression computing the same score as `app/constants.ts`'s `getIceScore()`, for server-side sorting without a stored, denormalized field).
- **`PUT /api/leads/[id]` now auto-reclassifies on score change.** If a partial update includes `ice` and does not also explicitly set `kanbanColumn`, and the lead is currently in `DISCOVERED` or `QUALIFIED`, the route recomputes the ICE score and derives the new column. Leads already moved to any of the 4 manual columns are never touched by this — moving a lead out of the auto-managed pair is a one-way door, matching the owner's spec ("If a card scores changes in Discovery and Qualified columns they change sort and even columns automatically by the rules. All other columns are manually sorted by the user").
- **`GET /api/leads/columns` now sorts `DISCOVERED`/`QUALIFIED` by computed ICE score, high to low — no other sort.** Previously all 6 columns used the same `{ sortOrder: -1, createdAt: -1 }` sort, which meant the two auto-managed columns weren't actually score-ordered at all despite the intent. The route now branches: the two auto-managed columns run an aggregation (`$addFields` + `$sort` on the computed score) with cursor pagination re-encoded as `<iceScore>|<id>`; the 4 manual columns keep their original `sortOrder`-based query and `<sortOrder>|<id>` cursor, unchanged.
- `app/constants.ts`'s `COLUMNS` metadata descriptions rewritten to state the rule directly ("Auto-managed: ICE < 500, sorted high to low", etc.); the now-superseded, always-unused `ICE_QUALIFIED_THRESHOLD` constant was removed in favor of `lib/kanban-column.ts`'s `QUALIFIED_ICE_THRESHOLD`.
- `tests/lib/kanban-column.test.ts` rewritten for the new 2-tier thresholds (was still asserting the old 480/720/`ENGAGED` behavior) plus new coverage for `isAutoManagedColumn()`.

### Fixed (pre-existing, unrelated to this task, caught by the quality gate before pushing)
- `app/detail.tsx` (2 call sites) and `app/table.tsx` (2 call sites): implicit-`any` `tsc` errors on GDS admin-component callback parameters (`AdminSelect`/`AdminTextarea`/`AdminDataTable` are typed `any` in this sandbox's local stub packages, so inline callback parameters had no contextual type). Added explicit parameter types; no behavior change. These were already present on `main` prior to this change — not introduced by this task, but fixed here since the zero-tolerance gate covers whatever this push adds to `main`.

### Note
3 pre-existing ESLint warnings (`react-hooks/exhaustive-deps` in `app/outreach/compose-modal.tsx` and `app/outreach/templates/page.tsx`) remain, in files untouched by this change — carried forward as recorded, not fixed in this pass.

### Not in scope
`lead-feeder-agent.js` and `scripts/migrate-check-schema.js` contain their own, separate, older kanban-column-derivation logic (different thresholds, including direct writes to `ENGAGED`/`PROPOSAL`). Neither is wired into any `npm` script or the running app — same unused/orphaned status as the Mongoose models already tracked as an open decision in `roadmap.md`. Left untouched; flagging here so the drift is a recorded fact, not a silent gap.

## 2.4.3

### Fixed
- **Removed the header's "Asc ↑"/"Desc ↓" sort button — it never sorted anything.** Owner flagged it directly after the header decluttering made it more visible. Investigation confirmed `sortOrder` state only toggled the button's own label; it was never passed to `KanbanBoard` or `TableView`, and `sortKey` was set once and never read anywhere. This predates the 2.4.0 rework (it was already non-functional in the original header) — it was preserved rather than audited when the two filter dropdowns were removed. Removed the button and the dead `sortKey`/`sortOrder` state entirely, along with the now-unused `Button` import.
- Corrected two more false "shipped" claims in `roadmap.md`'s UX history ("ICE-score sort controls for kanban and list view", "Kanban ICE/name ascending/descending sort behavior") — same non-functional button, never actually true.

### Clarified (not a bug)
- Owner asked whether an "Arsenal FC" lead had been deleted, comparing a screenshot search result on Seyu's board against a later one on CogMap's board where it didn't appear. These are two different brands with entirely separate MongoDB collections (`leads` vs `seyu_leads`) — a lead existing for one brand and not the other is expected, not data loss. Confirmed the 2.4.1 dedup fix in `/api/search` is scoped per-brand (inside the per-`brandKey` loop) and is read-only regardless — it cannot delete or cross-contaminate data between brands.

## 2.4.2

### Fixed
- **Every `PATCH /api/leads` action — not just drag-and-drop — was silently failing.** Reported as "drag and drop not permanent, looks like move but immediately refreshes and stays in the original." Root cause: `PATCH /api/leads`'s documented contract (`docs/OPERATOR_GUIDE.md`) expects the lead `id` as a URL query parameter (`?id=<id>`), matching what the route handler actually reads (`searchParams.get('id')`) — but both client call sites, `handleAction` (`sales-page-client.tsx`, used by every detail-modal action: Accept, Decline, Pin, Refresh, Modify, Delete) and `handleMove` (`kanban.tsx`, drag-and-drop), only ever sent `id` in the JSON body, never the URL. Every PATCH request has been returning 400 "Missing id" since these call sites existed. For drag-and-drop specifically, the failed request's `catch` block reloads the source column from the server (where nothing had changed), which is exactly why the card visually moved (optimistic UI) then snapped back. Added `url.searchParams.set('id', leadId)` to both call sites, matching the route's actual, documented contract.
- Corrected the "Lead Actions and Feedback" section of `PROPOSAL.md`, which claimed "Actions verified: ACCEPT, DECLINE, PIN, REQUEST_REFRESH, COLUMN_MOVE, DELETE" — they were not actually working given the bug above; removed the false claim.

## 2.4.1

Three real bugs found on the freshly-shipped 2.4.0 search bar and kanban board, reported live from a device screenshot.

### Fixed
- **The whole page force-zoomed on focusing the search input.** A different mechanism from the pinch/double-tap zoom fixed in 2.2.1: iOS Safari zooms the entire viewport in when a focused input's computed font-size is below 16px, regardless of `touch-action` or the viewport meta tag. Mantine's default input sizes render below that threshold. Added a global `input, select, textarea { font-size: 16px }` rule in `app/globals.css` — the standard, root-cause fix for this specific iOS behavior.
- **"The input field is not the input field."** The 2.4.0 search bar used GDS's `SearchableSelect` (`@sovereignsquad/gds-core`), which turned out to be the wrong component for this job: reading its real source shows it's a closed combobox *picker* — the visible box is a button (`InputBase component="button"`) that only opens a dropdown, and the actual typing field is a separate, plain `Combobox.Search` element that only appears once the dropdown is open and doesn't look like an input (no visible border). This is correct for a "select one item from a searchable list" UI, not for an always-visible live search bar. Replaced with a plain, always-editable Mantine `TextInput` bound directly to the query, with a custom dropdown of results rendered below it as the user types — matching what was actually asked for.
- **Duplicate results in search** (e.g. "Arsenal FC — Sports" appearing twice). `GET /api/search` never applied the fingerprint-based dedup (`/api/leads`'s GET handler already does this — the underlying collections can contain duplicate-fingerprint documents). Added the identical dedup-by-fingerprint-newest-wins logic to `/api/search`.

### Documentation
`docs/ARCHITECTURE.md` updated to describe the new plain-input search bar (correcting the stale `SearchableSelect` reference from 2.4.0) and the new focus-zoom CSS fix.

## 2.4.0

Kanban board UX overhaul (issue #23), from an owner screenshot review of the pipeline header and mobile filter bar.

### Added
- **Predictive lead search**: a new search bar, centered directly under the page header, using GDS's `SearchableSelect` (`@sovereignsquad/gds-core`) — debounced, async-loaded against the existing `GET /api/search?q=&brand=` endpoint, with loading/empty/error states built in. Selecting a result opens the lead detail modal directly.
- **Drag-and-drop between kanban columns, rebuilt from scratch.** It did not exist in the code prior to this release — `handleMove()` was already correctly wired to `PATCH /api/leads` with `action: COLUMN_MOVE`, but nothing ever called it; no `draggable`, drag events, or pointer handlers were present anywhere in `app/kanban.tsx`. (Changelog/roadmap history describes "pointer-based drag-and-drop" as previously shipped; it isn't present in the code as it stood before this release, likely lost in an earlier rewrite to cursor-paginated columns.) Implemented with Pointer Events (not native HTML5 drag-and-drop, for touch support) using a 200ms long-press-to-arm gesture so normal scrolling and tap-to-preview keep working — only a deliberate hold-then-move starts a drag. Includes a floating ghost label following the pointer, a dashed-highlight drop-target column, optimistic card removal from the source column on drop, and full cleanup on pointer cancel/interrupt.
- **Ticket size on each lead card**: a new `getTicketSize()` helper (`app/constants.ts`) surfaces the estimated deal value — CogMap leads use `estimated_annual_revenue_usd` directly (USD); Seyu leads don't have a single per-lead figure in the schema, so it's derived by summing each of that lead's own `pricingByCompany` entries using the same `max(annual_fee_eur, monthly_eur*12 + upfront_eur)` formula the forecast endpoint already used server-side (EUR). Shown in the card's metadata row alongside Region/ICE/Size/Contact.
- **Discounted (pipeline-weighted) forecast per kanban column header**: `GET /api/boards/[brand]` already computed this for CogMap (`forecast.pipeline[COLUMN].weightedRevenue = rawRevenue × probability`, where probability comes from `lib/pipeline-weights.ts`) but only ever surfaced the aggregate total in the page header. Now shown per-column. Extended the same computation to Seyu, which previously had no per-column breakdown at all (only per-company) — a new aggregation groups each lead's own pricing-block value by `kanbanColumn` before applying the same weight table.

### Changed
- **Header layout**: the view-mode selector (Kanban/Table/Metrics/Search Learning) is now pinned to the header's top-right (`wrap="nowrap"`, so it can no longer wrap below the title on narrow viewports as it did before). The Region and Status filter dropdowns are removed entirely, from the UI and from the `filteredLeads` logic in `sales-page-client.tsx` that depended on them — the kanban board already groups by status via its columns, and the region filter had no other consumer.
- The page header's forecast text now shows `€` for Seyu (previously hardcoded `$` regardless of brand, which was wrong once Seyu forecasts existed).

### Documentation
`docs/ARCHITECTURE.md`, `roadmap.md`, `PROPOSAL.md` updated. Full deliverable breakdown and the CogMap/Seyu ticket-size ambiguity this shipped a default answer for: issue #23.

## 2.3.2

### Fixed
- **The image placeholder was still showing** on the "Top Queries" cards in `app/search-learning.tsx` after the 2.3.1 kanban-card fix, because that's a *second, separate* `AdminResourceCard` usage the 2.3.1 fix never touched (only the kanban `LeadCard` was switched to `ProductCard`). Investigated `AdminResourceCard`'s real source directly (`packages/gds-admin/src/AdminResourceManager.tsx`) rather than guessing why the earlier fix wasn't enough: it wraps `MediaPreviewCard` and has an explicit `hideWhenNoMedia?: boolean` prop, documented inline as *"Omit the media area entirely for records with no media, instead of a placeholder block"* — defaulting to showing the placeholder unless a consumer explicitly opts in. Neither `AdminResourceCard` usage in this repo ever passed it. Added `hideWhenNoMedia` to the `search-learning.tsx` card. Also verified `app/table.tsx`'s `AdminDataTable` mobile-card path has no media/placeholder chrome of its own around its fully custom `renderMobileCard` render prop — confirmed clean, not a source of this issue.

## 2.3.1

### Fixed
- **Kanban cards no longer show an empty image placeholder.** `LeadCard` (`app/card.tsx`) used `AdminResourceCard` (`@sovereignsquad/gds-admin/client`), which always reserved a media/thumbnail box even though `Lead` has no image/logo field anywhere in the data model — there is currently no case where a lead actually has an image. Switched to `ProductCard` (`@sovereignsquad/gds-core/client`), whose `media`/`icon` props are genuine optional `ReactNode`s rendered bare — omitting them renders nothing, no placeholder. Verified against the real component source (`packages/gds-core/src/ProductCard.tsx` in `sovereignsquad/general-design-system`), not guessed: this sandbox can't install the real `@sovereignsquad/gds-*` packages (same GitHub release-tarball network constraint documented elsewhere), but `raw.githubusercontent.com` was reachable, so the actual source was read directly to confirm the prop contract before writing this fix. Card density/variant set to `compact`/`sm` per the design system's dedicated tight-list contract.
- Fixed stale documentation in `docs/ARCHITECTURE.md`'s Outcome Log section, which still described issue #11 (the `outcomeLogs`/`outcomelogs` collection split) as an open known issue — it was actually resolved in 2.2.3 and the doc was never updated to say so.

## 2.3.0

### Changed — Breaking API/data contract change
- **Resolved issue #20's organization-genericness complaint**: the value-proposition fields were named per-brand (`pro_for_cogmap`/`con_for_cogmap` for CogMap, `pro_for_seyu`/`con_for_seyu` for Seyu), which doesn't generalize to onboarding a new organization without a code change. Both brands now read and write one shared, generic field pair: `pro_for_organization`/`con_for_organization`. This is a **hard cutover** — no fallback, no dual-read, old field names are no longer recognized anywhere in the app.
- To avoid any window where existing leads' pros/cons would appear empty, a temporary one-time migration endpoint was deployed to production *before* the code change shipped, renaming the field in-place across both live collections via MongoDB's `$rename`: 408 documents in `leads`, 492 in `seyu_leads` (900 total), verified afterward to have zero documents left with the old field names. The endpoint was deleted once the migration was confirmed.
- Removed the now-obsolete "forbidden cross-brand pro/con field" validation rule from `lib/validate-lead.ts` (`pro_for_seyu` was rejected on a `cogmap` payload and vice versa) — there's nothing left to forbid once both brands share the same field name. The separate, unrelated forbidden-vocabulary check on free-text `value_proposition` content is untouched.
- `models/Lead.ts` (unused Mongoose model) had its pro/con field names corrected to match; the file remains unimported dead code — whether to delete it entirely or repair it fully as a future migration path is still an open decision.
- Updated `tests/lib/validate-lead.test.ts` and `tests/smoke/validate-lead.smoke.ts`, which had asserted the old brand-forbidden behavior, to reflect the new generic-field reality.
- Updated the `agent-runtime/` artifacts (added to this repo by the OpenClaw research agent) to match: `tenants.json`'s `cogmap`/`seyu` `brandFields.pro`/`.con` now both point at `pro_for_organization`/`con_for_organization`, `cogmap`'s now-meaningless `forbiddenFields: [pro_for_seyu, con_for_seyu]` was removed, and `seyu`'s `qualityGate.requiredFields` updated to the generic names. `schema-mapper.js`'s `_mapCogmapSeyu()` dropped ~35 lines of now-unnecessary cross-brand field-name reconciliation (both tenants already use the same field name, so there's nothing left to remap), and `_mapClassScout()`'s `leadOnlyFields` strip-list updated to match. `unified-enrichment-prompt.md`'s Seyu priority list updated. Verified via a standalone script exercising `mapToApiPayload`/`validateForTenant` for both tenants.

## 2.2.3

### Fixed
- **Resolved issue #11**: `/api/outcome-logs` (both GET and POST) read/wrote the `outcomeLogs` (camelCase) MongoDB collection, while every other outcome-logging call site (`app/api/leads/route.ts`, `app/lib/lead-actions.ts`, `app/api/admin/cron-status/route.ts`, `scripts/pipeline-monitor.js`) used `outcomelogs` (lowercase). Confirmed via a temporary, unauthenticated, read-only diagnostic endpoint deployed to production (`GET /api/admin/diag-outcome-logs`, removed immediately after use) that `outcomeLogs` held 0 documents while `outcomelogs` held 2,276 with same-day activity. `/api/outcome-logs` now points at `outcomelogs`, matching the rest of the codebase; its GET response will now reflect the real outcome history for the first time.

### Known issues carried forward (still open, still requires an owner decision — not fixed in this release)
- #20 — unused Mongoose models (`models/Lead.ts`, `OutcomeLog.ts`, `SearchLearning.ts`): still requires an owner decision (delete vs. repair).

## 2.2.2

### Fixed
- Fixed a misleading `total` field in `GET /api/leads`'s response: it previously held the count of leads returned on the current page (post-dedup), not the real total across all pages — a name that actively invites a wrong assumption, even though `totalPages` next to it was already computed from the real count. `total` now reflects the true grand total (matching `totalPages`); the per-page count is exposed separately as `returned`. Verified no existing frontend consumer read the old `total` field before renaming (fixes #21's low-risk sub-fix; the larger 3-endpoint pagination-shape unification remains out of scope, tracked in #21).

### Known issues carried forward (unchanged, still open, still require owner input — not fixed in this release)
- #11 — `outcomeLogs`/`outcomelogs` MongoDB collection-name split: still requires a direct production-database check before any code change, per the issue's own explicit non-goal. No `MONGODB_URI` credentials are available in the development environment to perform that check.
- #20 — unused Mongoose models (`models/Lead.ts`, `OutcomeLog.ts`, `SearchLearning.ts`): still requires an owner decision (delete vs. repair) per the issue's own explicit non-goal.

## 2.2.1

PWA and zoom-lock fix, reported live on `/sales/seyu` in production.

### Fixed
- **PWA installability**: `manifest.json` and `app/layout.tsx` referenced `/icon-192.png` and `/icon-512.png`, but neither file existed in `public/` — a manifest with 404ing icons fails browser installability checks outright, which alone explains why the app never behaved as an installable PWA regardless of prior PWA-hardening work. Added real, valid PNG icons at both sizes (placeholder design: dark-navy background matching `theme_color`, centered accent shape within the maskable safe zone).
- **No service worker existed anywhere in the codebase.** Added a minimal one (`public/sw.js`) that only precaches the static app-shell assets (manifest, icons) and passes everything else — all page navigations and all `/api/*` calls — straight through to the network, so there's no risk of serving stale kanban/lead data from a cache.
- **Pinch-zoom still worked despite three prior fix attempts** (`8f97f44`, `396ea1e`, and earlier), because all of them relied solely on the `<meta name="viewport">` tag's `maximum-scale`/`user-scalable=no`. **iOS Safari has ignored those two viewport properties since iOS 10**, as a deliberate Apple accessibility decision — no amount of retuning that one meta tag was ever going to fully prevent pinch-zoom on iPhone. Added two additional layers that iOS Safari does respect: a global CSS `touch-action: manipulation` rule (`app/globals.css`), and a JS-level `gesturestart`/`gesturechange` + multi-touch `touchmove` guard (`app/components/PwaSetup.tsx`) for older/edge-case Safari behavior.

### Known limitation
Real-device verification (iOS Safari pinch behavior, Android Chrome install prompt) could not be performed from this environment — verified via `next build` + a manual Lighthouse/DevTools installability check only. Flagged explicitly rather than claimed as fully proven (tracked in issue #22).

## 2.2.0

Security, dependency, and code-quality remediation following a two-pass engineering audit (tracked in GitHub issues #1–#21). No breaking API/UI changes.

### Security
- Fixed an API-key authentication bypass: `requireApiKey` previously allowed any request through if the `x-api-key` header was simply omitted, even when `SLG_API_KEY` was configured — only a *wrong* key was rejected. Now a missing header is rejected identically to a wrong one.
- Added the missing `requireApiKey` check to `POST /api/outcome-logs`, which had no auth gate at all, unlike every sibling write endpoint.

### Fixed
- Fixed a build-breaking undefined `columnWidth` reference in `KanbanBoard` (`app/kanban.tsx`), derived from the existing `mode` prop.
- Fixed `PUT /api/leads/:id` silently skipping all validation that `POST` enforces — malformed URLs, out-of-range ICE scores, and forbidden cross-brand fields could previously be written on update. `validateLeadPayload` now accepts a `{ partial: true }` option for update-shaped payloads.
- Fixed `Lead.region`'s frontend type (`app/types.ts`), which listed values (`USA`, `APAC`, `LATAM`, `EUROPE`, `GLOBAL`, `AFRICA`) that don't match what the backend actually produces (`US`, `CEE`, `MENA`). Tightening the type surfaced a live bug: the lead detail modal's region-color badge compared against `'USA'` instead of `'US'`, so it always fell through to the default gray color for US-region leads — fixed in the same change.
- Fixed `search-learning`'s error responses, which exposed raw exception messages directly as the `error` field; aligned to the `{ error, details }` shape used elsewhere.
- Fixed a Next.js 15 build failure (`Type '{ params: {...} }' does not satisfy the constraint 'PageProps'`) on `app/sales/[brand]/page.tsx` by splitting it into an async Server Component (awaits `params`) and a new `sales-page-client.tsx` Client Component receiving `brand` as a plain prop — no React 19 upgrade required.

### Changed — Dependencies
- Upgraded Next.js from `14.2.18` (deprecated, 14 open CVEs including HTTP request smuggling and cache poisoning, no patch in the 14.x line) to `15.5.13`+, the minimum version resolving all listed advisories. Updated the two dynamic API route handlers using `params` for Next 15's async request API.
- Established a working ESLint configuration — `npm run lint` previously had no config or dependency at all and just launched an interactive setup wizard. Enabling it immediately surfaced a real Rules-of-Hooks violation in `LeadDetailModal` (conditional `useState`/`useEffect` calls), fixed in the same change.
- Migrated ESLint 8 (deprecated) to ESLint 9 with a flat config (`eslint.config.mjs`, bridging `eslint-config-next`'s legacy preset via `@eslint/eslintrc`'s `FlatCompat`). Also switched the `lint` script from the deprecated `next lint` wrapper to the plain `eslint .` CLI.

### Changed — Code quality / de-duplication
- Removed `app/lib/validate-lead.ts`, a byte-identical, unreferenced duplicate of the real `lib/validate-lead.ts`.
- Removed two orphaned, never-imported modules documented as integrated but actually dead: `app/lib/ai-scoring/` (also internally broken — it referenced a stale `pro_for_slg`/`con_for_slg` field that never existed) and `lib/lead-validator.ts` (disagreed with the real, live validator on several rules).
- Consolidated `buildFingerprint()` (dedup hash), `deriveKanbanColumn()` (ICE→column mapping, plus removed a dead branch that could never execute), `isMongoConfigured()` (previously duplicated in 4 files with drift — the duplicates checked two env vars, `MONGODB_URI_LEADS`/`MONGODB_URI_CLASSCOUT`, that the real connection never reads, risking a false-positive "configured" check), and the pipeline-weight forecast math (previously triplicated across `stats`, `boards/[brand]`, and `forecast/export` routes) into shared modules: `lib/fingerprint.ts`, `lib/kanban-column.ts`, `lib/pipeline-weights.ts`, `lib/tenant.ts`.
- Fixed a filter bug in `/api/health`'s opt-in `tenantLeadCounts`: it used a raw exact-match `{ tenantId }` filter instead of the `tenantFilter()` pattern (matching both `'default'` and documents with no `tenantId` field) used everywhere else, undercounting when a caller explicitly requested `?tenantId=default`.

### Documentation
- Added `CLAUDE.md`, recording mandatory operating rules for any Claude session working in this repo (zero-tolerance quality gate, work-from-issues, documentation-mandatory, DoD, verify-don't-guess, and branch/push authorization for `dev`/`preview`/`main`).
- Updated `README.md`, `docs/ARCHITECTURE.md`, `docs/STACK_AND_DEPENDENCIES.md`, `docs/OPERATOR_GUIDE.md`, `PIPELINE_ARCHITECTURE.md`, `roadmap.md`, `PROPOSAL.md`, and `deployment.md` to reflect the above and correct several pre-existing documentation/reality drifts found along the way (stale package references, a corrupted architecture diagram, broken cross-links to non-existent files, and a security description matching the pre-fix auth-bypass behavior).

### Known issues carried forward (tracked, not fixed — need owner/data input, not guessable)
- `outcomeLogs` vs `outcomelogs`: the dedicated `/api/outcome-logs` endpoint reads/writes a different-cased MongoDB collection than every other outcome-logging call site. Needs a direct database check before merging a fix, in case production data already exists in the wrong collection (tracked in issue #11).
- Three Mongoose models (`models/Lead.ts`, `OutcomeLog.ts`, `SearchLearning.ts`) are unused (the app exclusively uses the raw `mongodb` driver) and have schemas drifted from reality. Needs an owner decision: delete, or repair as a future migration path (issue #20).
- Three lead-listing endpoints (`/api/leads`, `/api/search`, `/api/leads/columns`) use three incompatible pagination shapes, one with a misleadingly-named `total` field. Unifying this is an API-contract change requiring a coordinated frontend update, not a drive-by fix (issue #21).

## 2.1.0

Current production version. Baseline for this documentation set.

### Added
- Brand-parameterized API: `/api/leads?brand=cogmap|seyu`
- Single frontend pipeline page: `/sales/[brand]`
- Mobile-first kanban board with responsive vertical stack on narrow screens
- Pointer-based drag-and-drop with ghost preview, pointer-capture cleanup, and opacity cleanup
- Collapsible kanban columns with per-column expand/collapse controls
- Live kanban column lead counts in headers, e.g. `Discovered (258)`
- Country-based filter UI derived from lead data
- ICE/name sort controls with asc/desc for kanban and table view
- Table view simplified to Name, Score, Status for mobile readability
- Table view contrast fix: dark text on light background
- Detail modal full-screen behavior on mobile via `matchMedia`
- Header/filter wrapping for narrow viewports
- PWA manifest alignment with app start URL and scope
- Mobile/PWA layout fixes: `minHeight: 100dvh`, `overflow: auto`, wrapped controls
- Action feedback toasts for mutations in lead detail modal
- Shared retry utility for transient API failures
- Validation smoke tests via `npm run test:smoke`

### Changed
- Tenant filter defaults to `default` and includes legacy docs without `tenantId`
- Lead contacts are canonical; top-level contact fields are merged into `contacts[]` on write, then cleared from list/detail responses where possible
- Drag affordance enlarged; whole card participates in pointer drag flow
- Card selection state is cleaned up after drag end/cancel
- Won/Lost column headers use green/red header treatment

### Known Issues
- Full `next build` may OOM in limited local environments; use `tsc --noEmit` for type verification
- PWA pinch-zoom behavior is tightened but may still need further refinement
- Table view mobile density/readability may still need additional tuning
- Country filter population depends on lead `country` data; sample data may be missing populated values
- Test coverage is limited to validation smoke tests; API route tests remain TODO

---

## Unreleased

Future work is tracked in `roadmap.md` and `PROPOSAL.md`.
