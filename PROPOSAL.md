# SLG App — Improvement Proposal

**Version:** 2.4.12

## Purpose

This document tracks proposed improvements against the current shipped state. Completed or superseded workstreams are marked accordingly.

---

## Completed Workstreams

### Security, Dependency, and Code-Quality Remediation (2.2.0)
- API-key auth bypass fixed: a missing `x-api-key` header is now rejected identically to a wrong one when `SLG_API_KEY` is set
- Missing API-key check added to `/api/outcome-logs` POST
- Next.js upgraded 14.2.18 → 15.5.13+ (14 CVEs resolved), including the async `params` API migration for dynamic route handlers and the `app/sales/[brand]` page split into Server + Client Components
- Working ESLint configuration established (was previously non-functional), then migrated ESLint 8 → 9 flat config
- `PUT /api/leads/:id` now validates partial updates with the same rules `POST` enforces
- Duplicated fingerprint, kanban-column-derivation, `isMongoConfigured()`, and pipeline-weight logic consolidated into shared `lib/*` modules
- 3 orphaned/dead modules removed (a duplicate validator, an unwired-and-broken AI-scoring module, an agent-side validator disagreeing with the real one)
- `Lead.region` frontend type corrected to match real backend values, fixing a live UI badge-color bug in the same change

### PWA and Zoom Fix (2.2.1)
- Fixed pinch-zoom still working despite 3 prior attempts, root-caused to the viewport meta tag alone never being sufficient (iOS Safari has ignored `user-scalable=no`/`maximum-scale` since iOS 10) — added `touch-action: manipulation` CSS plus a JS-level gesture/multi-touch guard
- Fixed the app never behaving as an installable PWA, root-caused to referenced icon files (`icon-192.png`, `icon-512.png`) not existing at all — added real icons and a minimal service worker precaching only the static shell
- Confirmed fixed on a real device (2026-07-23): pinch-zoom lock verified working live

### Pagination Field Fix (2.2.2)
- Fixed the misleading `total` field in `GET /api/leads` (issue #21's low-risk sub-fix): now the real grand total across all pages, matching `totalPages`; per-page count moved to a new `returned` field. The larger 3-endpoint pagination-shape unification remains explicitly out of scope pending a dedicated design pass.

### Outcome-Logs Collection Fix (2.2.3)
- Resolved issue #11: a temporary, unauthenticated read-only diagnostic endpoint deployed to production confirmed `outcomeLogs` (camelCase) held 0 documents while `outcomelogs` (lowercase) held 2,276 documents with same-day activity — settling which collection is real. `/api/outcome-logs`'s GET and POST handlers now point at `outcomelogs`, matching the other 4 call sites across the codebase. Diagnostic endpoint removed after use.

### Generic Organization Fields (2.3.0)
- Resolved the organization-genericness complaint (owner-requested, not a tracked GitHub issue — this predates the audit-remediation epic's #20/#21 numbering, which covers unrelated topics): the value-proposition fields were brand-specific (`pro_for_cogmap`/`pro_for_seyu`), which doesn't scale to onboarding a new organization without a code change. Replaced with one shared, organization-agnostic field pair (`pro_for_organization`/`con_for_organization`) used identically by every brand — hard cutover, no fallback, no dual-read. All 900 existing production documents (408 in `leads`, 492 in `seyu_leads`) were migrated to the new field names via a temporary one-time endpoint before the code shipped, so there was no window where any lead's pros/cons appeared empty. The obsolete "forbidden cross-brand pro/con field" validation rule was removed (nothing left to forbid — there's only one field name now); the separate forbidden-vocabulary check on `value_proposition` text is untouched. `models/Lead.ts`'s field names were also corrected to match at the time (that file — along with `OutcomeLog.ts`/`SearchLearning.ts` — was later deleted entirely in 2.4.7, see issue #20). The `agent-runtime/` artifacts (the OpenClaw research agent's own config, added to this repo) were updated to match the same generic fields: `tenants.json`'s `brandFields`, `qualityGate.requiredFields`, and the now-obsolete `forbiddenFields` cross-brand pair; `schema-mapper.js`'s field-remapping logic simplified since there's no longer a per-tenant name mismatch to reconcile; `unified-enrichment-prompt.md`'s Seyu priority list.

### Kanban Card Image Placeholder Fix (2.3.1 / 2.3.2)
- Kanban cards previously always reserved an empty media/thumbnail box (`AdminResourceCard`), even though `Lead` has no image/logo field at all — there's currently no case where a lead has one. Switched `LeadCard` to `ProductCard` (`@sovereignsquad/gds-core`), whose `media`/`icon` props are optional `ReactNode`s rendered bare — omitted entirely, they render nothing. The real component source was read directly from `sovereignsquad/general-design-system` (this sandbox can't install the real package, but `raw.githubusercontent.com` was reachable) to confirm the contract before writing the fix, rather than guessing at prop names.
- The placeholder was still visible afterward on `app/search-learning.tsx`'s "Top Queries" cards — a second, separate `AdminResourceCard` usage the first fix never touched. Reading `AdminResourceCard`'s real source revealed a `hideWhenNoMedia?: boolean` prop, explicitly documented as omitting the placeholder for no-media records and defaulting to `false`. Added it.

### Kanban Board UX Overhaul (2.4.0)
- View-mode selector pinned to the header's top-right (no longer wraps below the title); Region/Status filter dropdowns removed from the UI and dead-code-cleaned from `sales-page-client.tsx`.
- New predictive search bar (top-center under the header) using GDS's `SearchableSelect`, backed by the existing `/api/search` endpoint; selecting a result opens the lead detail modal.
- Kanban drag-and-drop between columns rebuilt entirely — it was fully absent from the code (not merely buggy) despite changelog/roadmap history describing it as shipped. Pointer-events-based with a long-press arm gesture (so scrolling/tapping still work), ghost preview, drop-target highlight, optimistic removal from the source column, and cleanup on cancel.
- Ticket size (estimated deal value) shown on each lead card, and a pipeline-weighted ("discounted") forecast shown on each kanban column header — extended to Seyu, which previously had no per-column forecast breakdown at all.

### Search Bar and Focus-Zoom Fixes (2.4.1)
- Fixed the page force-zooming on search-input focus — a separate iOS Safari mechanism from pinch-zoom (zooms when a focused input's font-size is below 16px); added a global 16px minimum for all inputs/selects/textareas.
- Replaced the 2.4.0 search bar's `SearchableSelect` (a closed combobox picker whose real typing field was hidden and didn't look like an input) with a plain always-editable text input and a custom predictive dropdown — the component was simply the wrong fit for a live search bar.
- Fixed duplicate results in `/api/search` — it never applied the fingerprint-based dedup `/api/leads` already uses; added it.

### PATCH /api/leads Actions Actually Working (2.4.2)
- All `PATCH /api/leads` actions (ACCEPT, DECLINE, PIN, REQUEST_REFRESH, MODIFY, COLUMN_MOVE) were silently failing until this release — the client never sent the `id` the route's documented contract requires as a URL param, only in the JSON body. Reported as "drag and drop looks like it moves, then snaps back"; fixed in both call sites (`handleAction`, `handleMove`).

### Dead Sort Button Removed (2.4.3)
- The header's Asc/Desc sort button: removed — it never actually sorted anything, in the current code or historically; the state it toggled was never read by the kanban board or table view. Corrected the same false "shipped" claim in `roadmap.md`'s own UX history.

### Kanban Auto-Classification and ICE Sort Rule (2.4.4)
- Owner specified an exact business rule: `DISCOVERED`/`QUALIFIED` are auto-managed purely by ICE score (500 threshold, always sorted high to low, no other sort); every other column is exclusively user-managed once a lead is moved there. `lib/kanban-column.ts` was rewritten from a 3-tier 480/720 rule (which also auto-promoted to `ENGAGED`) to the correct 2-tier rule. `PUT /api/leads/[id]` now reclassifies a lead's column on ICE-score change, but only while it's still in an auto-managed column. `GET /api/leads/columns` now sorts the two auto-managed columns by a computed-ICE aggregation instead of `sortOrder`, with cursor pagination re-encoded around the score. The already-declared-but-unused `ICE_QUALIFIED_THRESHOLD` constant and the incorrect 480/720 test fixtures were both cleaned up in the same change.

### Header Overflow, Desktop Detail Panel, and Stuck Drag-Ghost Fixes (2.4.5)
- A live device screenshot review surfaced 3 real bugs. (1) The header/search bar overflowed the screen on narrow viewports: a `wrap="nowrap"` row combining verbose 3-line header text with the view-mode selector was wider than the viewport with nothing able to shrink or wrap, so the selector (and potentially content below it) rendered off-screen instead of clipping. Compacted the header to two rows and dropped the verbose timestamp/"weighted" wording per the owner's requested terse format; added a global `overflow-x: hidden` CSS safety net. (2) The desktop/tablet-width (≥1280px) lead detail panel — `AdminDetailDrawer` in `app/detail.tsx` — was missing its entire body (ICE score, contacts, pros/cons, every action button) because the call site only ever passed `metadata`, never `content`, unlike the mobile `AdminModal` branch; confirmed against `AdminDetailDrawer`'s real source (`packages/gds-admin/src/AdminOverlays.tsx`) that it renders `{media}`, `{metadata}`, `{children}` and simply never received the last one. Fixed by passing `{content}` as children. (3) A quick tap on a kanban card could leave a permanently stuck drag-ghost and dimmed card: the drag-arm timer in `app/kanban.tsx` was cancelled only on excess pointer movement, never on `pointerup`/`pointercancel`, so an ordinary quick tap still let the 200ms timer fire after the pointer had already lifted, with no future `pointerup` on that pointerId ever arriving to clear it. Fixed by cancelling the timer on release too.

### Mantine Inputs Still Force-Zooming on iOS Safari (2.4.6)
- The 2.4.1 focus-zoom fix (`input, select, textarea { font-size: 16px }`) never actually applied to Mantine's own components — Mantine's compiled CSS sets font-size via a class selector, which has higher specificity than a bare element selector and always won regardless of source order. Confirmed by inspecting Mantine's actual shipped stylesheet rather than guessing. Added `!important`, which unconditionally wins the cascade; widened the header's view-mode `Select` (132px → 168px) to fit its longest label at the now-correctly-enforced 16px font. Real-device confirmation still recommended — this is an iOS-Safari-only behavior with no headless/desktop equivalent to screenshot.

### Mongoose Models Deleted, Pagination Unified on Cursors (2.4.7)
- Resolved the two remaining "flag only" decisions from the second audit pass. Issue #20: `models/Lead.ts`/`OutcomeLog.ts`/`SearchLearning.ts` deleted (zero importers, drifted schemas, no signal anywhere of an intended future Mongoose migration — `mongoose` itself stays as a dependency, used only as a connection helper in `scripts/*.js`). Issue #21: `/api/leads`, `/api/search`, and `/api/leads/columns` now share one pagination contract (`hasMore`/`nextCursor`). `/api/leads` added cursor support as a purely additive, opt-in mechanism — its legacy `page`/`limit`/`totalPages` fields and default sort are completely untouched, since the external research agent's one-shot `?limit=1000` listing call is a consumer this repo doesn't control and couldn't safely audit further. `/api/search` (frontend-only consumer, fully controlled) was changed more directly: `results` renamed to `leads`, a real `count` added, and cursor pagination wired for its single-brand mode. The table view's fetch was switched from one hard-capped `limit=5000` request to a cursor loop.

### PUT /api/leads/[id] Silently Corrupting ICE Fields, Breaking the Sort (2.4.8)
- Owner reported the ICE-score kanban sort was "still not working" and asked where the computation runs, concerned about heavy client-side work. Confirmed the sort is entirely server-side (a MongoDB aggregation in `GET /api/leads/columns`) and the client never re-sorts — `getIceScore()` client-side is only a trivial per-card display value. Investigation found a real bug: `PUT /api/leads/[id]` stored `ice` fields straight from the request body with no numeric coercion (unlike `POST`, which runs through `normalizeLead()`), so a request with numerically-valid but string-typed values would pass validation yet get persisted as strings — which then made the sort aggregation's `$multiply` throw, failing the whole column's fetch silently. Fixed both the write path (coerce `ice` to numbers before storing) and the read path (`ICE_SCORE_AGGREGATION_EXPR` now uses `$convert` with a safe fallback instead of a bare `$multiply`, self-healing any already-corrupted historical document without a migration).

### GDS 3.11.1 — Verified Re-adoption After the 3.11.0 Incident (2.4.12)
- Owner reported 3.11.1 fixes the tarball-publish bug behind 2.4.11's revert. This time, before touching any config, the release tarballs were independently verified rather than inferred from a git tag: `WebFetch` (which resolves through a different network path than this sandbox's blocked `curl`/`Bash`) followed each of the 3 `gds-v3.11.1` release-asset URLs through GitHub's real signed redirect and retrieved the actual bytes; each was confirmed as a genuine gzip archive whose extracted `package.json` reports the correct name and `version: "3.11.1"`; SHA-512 hashes were computed twice independently (OpenSSL and Node's `crypto`, matching) and recorded as the real `integrity` values in `package-lock.json`. Also fetched GDS's own `gds-v3.11.1` `CHANGELOG.md`, which independently confirms the root cause: the `3.11.0` tag was cut before a same-day fix to their release-automation workflow, so its tarball never actually published; `3.11.1` is a pure re-cut with no functional change. No application code changes were needed.

### Production Build Broken by an Unverified GDS 3.11.0 Tarball, Reverted (2.4.11)
- 2.4.10's GDS version bump to 3.11.0 broke every deploy from `main`: Vercel's `npm install` returned a real `404` on the `gds-theme` release tarball. The bump had been made on the strength of the `gds-v3.11.0` git tag being readable via `raw.githubusercontent.com` — but a readable git tag does not prove a GitHub Release with attached binary assets was ever published; that distinction was missed, and the sandbox's blanket 403 on `github.com`/`api.github.com` (identical whether a resource is real or missing) made it impossible to tell the difference from inside this sandbox. Reverted `gds-admin`/`gds-core`/`gds-theme` to 3.10.0 in `package.json`/`package-lock.json`, restored byte-for-byte from the last commit confirmed to have deployed successfully — not re-derived. All 2.4.10 application code (the theme-level zoom fix, the GDS-governed `KanbanBoard` adoption) was kept, since none of it depends on a 3.11.0-only export.

### GDS 3.11.0 Adoption — Theme-Level Zoom Guard, Governed Accessible Kanban (2.4.10)
- Adopted GDS 3.11.0's theme-level `Input.vars` zoom-guard override (replacing the 2.4.6 `!important` CSS hack) and its new `KanbanBoard` (`enableDrag`), which provides accessible `@dnd-kit`-based pointer/touch/keyboard drag-and-drop with a keyboard "Move to column" menu fallback, replacing the hand-rolled pointer-events implementation in `app/kanban.tsx` entirely. `useGdsKanbanOrientation` now handles the stacked-vs-columns responsive layout that `sales-page-client.tsx`'s own `mode`/`isMobile`/`matchMedia` plumbing previously did (removed as dead code). Trade-offs: the per-column forecast subtitle is now a single-line string (`KanbanColumnData.title` isn't a `ReactNode`); the "load more" pagination sentinel is nested inside the last card's render output (`KanbanColumn` has no footer slot). **The GDS package version bump itself broke the production build — see the 2.4.11 entry above; the `package-lock.json` integrity-hash gap noted here was not the risk that actually materialized.**

### Kanban UX and Mobile Pipeline
- Responsive kanban layout with vertical stacking on narrow screens
- Pointer-based drag-and-drop with ghost preview and cleanup — note: an earlier version of this doc's history claimed this shipped well before 2.4.0, but per `CHANGELOG.md`'s 2.4.0 entry, the gesture was entirely absent from the code at that point and had to be rebuilt from scratch; what's described here is the 2.4.0 rebuild, still current
- Collapsible kanban columns
- Live column lead counts in headers
- Won/Lost header color treatment
- Table view mobile simplification and contrast fix
- Detail modal full-screen on mobile
- Header/filter wrapping for narrow viewports
- PWA manifest and mobile layout fixes

### Lead Actions and Feedback
- Canonical PATCH mutation path extracted to `app/lib/lead-actions.ts`
- Frontend uses loading/disabled states and toast feedback
- Shared retry utility for transient API failures
- Validation smoke tests via `npm run test:smoke`

### Lead Data Normalization
- Server-side normalization in `POST /api/leads`
- Generic normalization for `pro_for_organization`/`con_for_organization` (shared across brands as of 2.3.0)
- Duplicate fingerprint prevention on write
- Quality gate enforcement for low-confidence leads

### Observability
- `/api/health` expanded with `dbLatencyMs`, `leadCounts`, `lastError`
- `/api/admin/cron-status` endpoint
- `/api/admin/data-hygiene` endpoint
- `/api/stats` totals and breakdowns
- Outcome logging for mutations

### Security and Access Control
- `requireApiKey` guards write/admin endpoints
- CORS and security headers in `middleware.ts`
- Public read access for listings and health

### Data Validation
- Request validation for POST/PATCH via `lib/validate-lead.ts`
- Pre-POST validation helper for research agent

---

## Remaining Work

### Research Agent Improvements
- Retry with backoff for transient failures
- Batch verification after lead creation
- Run logging and duplicate-detection feedback loop

### Multi-Tenant Hardening
- Workspace isolation beyond brand scoping
- Tenant-aware indexes and migration path

### Mobile UX Polish
- Real-device PWA-installability verification: owner reports it's still not behaving as expected as of 2026-07-23; specifics (which platform, which symptom) not yet gathered — see open question in `deployment.md`.
- Real-device confirmation of the iOS focus-zoom fix — now GDS 3.11.0's theme-level `Input.vars` mechanism (2.4.10), superseding the 2.4.6 `!important` CSS hack — could not be verified from this sandbox (no headless/desktop equivalent to screenshot); see the "GDS 3.11.0 Adoption" workstream above.
- Table view density/readability tuning
- No country/region filter UI currently exists at all (see roadmap.md) — if this is still wanted, it needs to be built as new work, including backfill/mapping `country` from `region` where missing, not assumed to already be partially built

### Test Coverage
- API/route tests beyond validation smoke tests (unit coverage of shared `lib/*` logic has grown substantially since 2.2.0 and continued growing through 2.4.4's kanban-column rewrite, but full route-level integration tests remain TODO)

### Orphaned Standalone Scripts
- `lead-feeder-agent.js` and `scripts/migrate-check-schema.js` each contain their own, separate ICE→column derivation with different (older) thresholds than the real `lib/kanban-column.ts`; neither is wired into any `npm` script or the running app — flagged as of 2.4.4, not yet resolved (see `roadmap.md`)

---

## Priority Order

1. Mobile UX polish
2. Research agent reliability
3. Multi-tenant hardening
4. Orphaned standalone scripts cleanup

This priority order covers only the near-term items above. Longer-horizon, larger-scope features (auto-enrichment pipeline, team workspaces, AI scoring calibration, CRM sync, attribution, analytics dashboard, client API/webhooks, advanced enrichment) are tracked separately in `roadmap.md`'s phased "Planned" table and aren't repeated here.