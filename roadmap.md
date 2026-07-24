# Roadmap — Sales Lead Generator

**Version:** 2.4.23

---

## Shipped

### Sales Settings Save Button 401 Fix (2.4.21)
- 🔴 Owner reported the new Save button (2.4.20) failing with "Unauthorized" in production. Root cause: `PUT /api/sales-settings/[brand]` required `requireApiKey`, but the browser form has no way to safely hold that secret (no login system exists in this app) — guaranteed to fail whenever `SLG_API_KEY` is set in the deployment environment.
- ✅ Removed the `requireApiKey` guard from this route, matching `/api/settings`'s existing precedent for its own browser-edited document — no lead/contact PII is at risk here, only a company's own sales-context text.
- ✅ Also added the missing `PUT` entry to `middleware.ts`'s CORS `Access-Control-Allow-Methods` allow-list, a related latent gap (harmless for same-origin calls, but would silently block a cross-origin `PUT`).
- ✅ Verified with a real dev server running with `SLG_API_KEY` set: a header-less `PUT` (matching the browser's actual request) now passes the auth check and reaches the `503`-when-unconfigured branch instead of `401`.

### Company Setup / Sales Settings Page (2.4.20)
- ✅ Owner asked for a per-brand page where a company can record what it sells and how customers buy it, so the research agent (OpenClaw/KiloClaw) can refine lead scoring and revenue forecasts — with an explicit constraint to avoid financial/accounting terminology and instead follow how a small company already thinks about its business. Full spec tracked in GitHub issue #24.
- ✅ New route `/salessettings/[client]`, twelve-section questionnaire (company basics; repeatable products with per-product buyer/customer-size/pricing-model/predictability fields; deal size; purchase frequency; upsell; sales cycle; example customer; seasonality; notes), built with plain Mantine primitives rather than GDS Admin wrappers (no equivalent there for repeatable rows/checkbox groups, and avoids more GDS integration surface area after this session's 3.11.x issues).
- ✅ New `company_settings` MongoDB collection keyed by `{brand, tenantId}`, served via `GET`/`PUT /api/sales-settings/[brand]` (`GET` public with a safe empty default on first visit, `PUT` protected via `requireApiKey`).
- ✅ `sanitizeSalesSettings()` normalizes every field before it's written — enum filtering, string trimming, and numeric-string coercion for price/quantity fields, the same defensive pattern already proven for leads (2.4.8's ICE-field fix).
- ⚠️ **Disclosed limitation**: this sandbox has no `MONGODB_URI`, so the route's actual Mongo upsert/read-back could not be integration-tested here — verified as far as the `503`-when-unconfigured path (real dev server) and the sanitizer's unit tests.

### Brand-Specific Browser Tab Titles (2.4.19)
- ✅ Owner asked for CogMap's and Seyu's pages to have distinguishable browser tab titles to tell them apart between tabs. `/sales/[brand]/page.tsx` now exports `generateMetadata()` returning the brand's display label from the existing `BRAND_CONFIG`; the root layout's title became a `{ template, default }` object so Next.js composes them as `"CogMap · Sales Lead Generator"` / `"Seyu · Sales Lead Generator"` — brand name first, since browser tabs truncate from the end.
- ✅ Verified with the real rendered `<title>` tag from a running dev server, not just inferred from code.

### Real-Device Confirmation: 2.4.17 Fixes All Verified Working (2.4.18)
- ✅ Owner confirmed on a real device (production, mobile portrait): PWA works, the lead detail modal works, the double-bordered kanban cards are fixed, and the iOS zoom-on-focus problem is fixed.
- ✅ Confirms `enableDrag: false` was the actual fix for the "client-side exception" crash, not just a reasoned hypothesis — the real `@dnd-kit` code path was the real cause.
- ✅ Confirms GDS's theme-level `Input.vars` zoom-guard genuinely works on real iOS Safari, not just in this sandbox's Chromium-based emulation (which can't reproduce WebKit's actual auto-zoom heuristic).
- ✅ Drag-and-drop is confirmed off on mobile portrait, as expected — owner explicitly accepts this trade-off rather than requesting `enableDrag` be re-enabled.

### Double-Bordered Kanban Cards + Drag-Handle Chrome Rolled Back (2.4.17)
- 🔴 Owner reported (screenshot) every kanban card showing a visible "box within a box," plus a drag-handle icon and a second icon flanking each card — separately from a "client-side exception" crash report on the live production URL.
- ✅ Root-caused precisely via GDS's real source: `KanbanCard` always wraps `renderItem`'s output in its own bordered `Paper` (alongside the drag-handle and Move-menu icons); `ProductCard` *always* renders `withBorder` too, no variant removes it. `app/card.tsx`'s `LeadCard` was nesting `ProductCard`'s own border inside `KanbanCard`'s already-bordered shell.
- ✅ Rewrote `LeadCard` to render flat, borderless content (no `ProductCard`) — GDS's `KanbanCard` `Paper` is now the only border per card.
- ✅ Turned off `enableDrag` on the kanban board — removes the drag-handle icon (one of the "boxes"), and deactivates the one genuinely new runtime code path in this whole GDS 3.11.x bump (real `@dnd-kit`) that had never actually executed in a successful production build before the crash was reported. The keyboard/tap "Move to column" menu still works unconditionally.
- ⚠️ Neither fix could be visually confirmed locally — GDS packages are `any`-typed stubs here that render `null`, and the live production URL is unreachable from this sandbox (same network policy blocking `github.com`). The double-border fix rests on GDS's real fetched source; the `enableDrag` rollback is a reasoned hypothesis about the crash, not a confirmed root cause.

### Proactive Sweep for Similar GDS Type Gaps (2.4.16)
- ✅ Owner asked to check for similar errors rather than wait for a fifth Vercel build. Grepped every `@sovereignsquad/*` import across the whole repo (8 usages) and checked each one not already fixed this incident against real 3.11.1 source: `AdminModal`/`AdminDetailDrawer`/`AdminTextarea`/`InfoCard`/`ProductCard` all match what's actually passed; `AdminDataTable` is generic over `T` (unlike `KanbanBoard`'s fixed interfaces), so it's structurally immune to the same contravariance bug.
- ✅ Found one more real gap: `app/search-learning.tsx`'s `AdminResourceCard` usage had an explicit `record={{...} as any}` cast that fully suppressed type-checking for that call. The object already satisfied the real `AdminResourceRecord` shape exactly — removed the unnecessary cast, upgraded the local stub with `AdminResourceCard`'s real, verified type, confirmed clean via `tsc` without the cast.
- ✅ Grepped every remaining `as any` in `app/` — the rest are unrelated to GDS (MongoDB driver typing quirks, dynamic field access, an action-string cast), not the same class of unverified-external-contract bug. Left alone.

### KanbanBoard renderItem Type Mismatch, Fixed (2.4.15)
- 🔴 A fourth real failure from the same GDS bump: `app/kanban.tsx:235` — `renderItem`'s parameter types (`LeadKanbanItem`/`LeadKanbanColumn`, which require a `lead` field) don't satisfy the real, fixed `KanbanItem`/`KanbanColumnData` contract `KanbanBoard` actually calls it with — a genuine contravariant function-parameter mismatch, correctly rejected by real `gds-core` types but invisible against the local `any`-typed stub.
- ✅ Fixed `renderItem` to accept the real base types and cast internally (`item as LeadKanbanItem`) to reach `.lead`, which the constructed objects genuinely carry at runtime.
- ✅ Upgraded the local `gds-core` stub for real: `KanbanItem`/`KanbanColumnData`/`KanbanOrientation`/`OnMoveItem` and a properly-typed `KanbanBoard`, transcribed from the real source already read this session. Confirmed effective the same way as 2.4.14 — reverted, re-ran `tsc`, watched it correctly re-flag the same error, restored the fix.
- ⚠️ Four distinct real production failures from one GDS bump (2.4.12–2.4.15), each only catchable by a real `npm install` + `tsc` against the real package. The two GDS components this app actually imports (`AdminSelect`, `KanbanBoard`) now carry real, verified stub types — closing the gap for this app's actual surface area, though anything newly imported from GDS in the future needs the same treatment before it can be trusted locally.

### AdminSelect onChange Type Mismatch, Fixed (2.4.14)
- 🔴 2.4.13's `@dnd-kit` fix let `npm install` and webpack module resolution succeed, but a third real failure surfaced on Vercel: a genuine `tsc` type error in `app/detail.tsx` — `AdminSelect`'s real `onChange` is typed `(value: string | null) => void` (matching Mantine's own `Select`), but the app's handler was typed `(value: string) => void`.
- ✅ Root cause: invisible to every local check all along, since this sandbox's local `gds-admin` is an `any`-typed stub — this was the first time this code path was ever type-checked against the real package, because it's the first time in this bump cycle `npm install` actually succeeded end-to-end in production.
- ✅ Fixed the handler to accept `string | null`, confirmed the real signature by fetching `packages/gds-admin/src/AdminForms.tsx` from `gds-v3.11.1` directly.
- ✅ Closed part of the underlying gap: the local stub's `AdminSelect` now carries its real, verified prop type instead of `any` — confirmed by reverting the fix and re-running `tsc`, which correctly re-flagged the same error locally this time.
- ⚠️ Three real, different production failures surfaced back-to-back from one GDS version bump (2.4.12/2.4.13/2.4.14), each only catchable by an actual successful `npm install`/type-check against the real package — something this sandbox cannot fully do. Every "verified" claim this session proves the code against stub types, never the real compiled package's actual contract; that limit is now explicit in-repo.

### Missing @dnd-kit Transitive Dependencies, Fixed (2.4.13)
- 🔴 2.4.12's GDS 3.11.1 bump fixed the tarball-404 problem — `npm install` succeeded on Vercel — but `next build` then failed on `Module not found: Can't resolve '@dnd-kit/core'` (and `sortable`/`utilities`), imported from `gds-core`'s compiled bundle via `app/kanban.tsx`.
- ✅ Root cause: `gds-core@3.11.1` declares these as real `dependencies` (confirmed by reading its actual `package.json`), but this repo's `package-lock.json` has been out of sync with the true dependency tree for a long time — independent of anything this session's GDS work did (confirmed identical at a commit well before it) — so Vercel's `npm install` (trusting a restored build cache rather than fully re-resolving) never discovered the new transitive subtree.
- ✅ Fixed by declaring `@dnd-kit/core`/`sortable`/`utilities` as direct dependencies, added via a **real `npm install`** against `registry.npmjs.org` (confirmed reachable from this sandbox) — real resolved URLs and `integrity` hashes, not hand-edited. This also incidentally expanded the lockfile from ~220 to ~530 tracked packages, closing a pre-existing gap.
- ⚠️ **Disclosed limit**: this sandbox's local GDS packages remain hand-written stubs with no `dist/` bundle, so the specific failure class (webpack resolving imports inside the real compiled `gds-core`) can't be reproduced or re-verified locally — confidence rests on reading `gds-core`'s real `package.json` and matching Vercel's exact error, not on a local build passing (which it always would regardless).

### GDS 3.11.1 — Verified Re-adoption After the 3.11.0 Incident (2.4.12)
- ✅ Owner reported 3.11.1 fixes the tarball-publish bug. Verified independently before shipping, learning from the 2.4.10/2.4.11 mistake: `WebFetch` (a different network path than this sandbox's blocked `curl`/`Bash`) followed each of the 3 `gds-v3.11.1` release-asset URLs through GitHub's real `302` signed-redirect and downloaded the actual tarball bytes — not just confirmed a git tag exists.
- ✅ All 3 tarballs confirmed as real gzip archives (`file`), extracted, and `package/package.json` read directly — each correctly reports `version: "3.11.1"`. SHA-512 `integrity` computed twice independently (OpenSSL, Node `crypto`) with matching results, now recorded for real in `package-lock.json`.
- ✅ Fetched `gds-v3.11.1`'s own `CHANGELOG.md` for the root-cause confirmation: the `3.11.0` tag was cut before a same-day fix to GDS's own release-automation workflow (`GITHUB_TOKEN` anti-recursion protection blocking the tarball-publish job) — 3.11.1 is a pure re-cut, "no functional/code change beyond the version-bump surfaces."
- ✅ No application code changes needed — 2.4.10's theme-level zoom fix and GDS-governed `KanbanBoard` (`enableDrag`) now get the newer pointer/touch drag behavior they were originally written for.

### Production Build Broken by an Unverified GDS 3.11.0 Tarball, Reverted (2.4.11)
- 🔴 2.4.10 bumped the GDS dependency URLs to 3.11.0 on the strength of the `gds-v3.11.0` git tag being readable — but a git tag existing is not proof a GitHub Release with attached tarball assets was published. Vercel's real `npm install` hit a genuine `404` on the `gds-theme` tarball, breaking every deploy from `main` until this fix. This sandbox's `github.com`/`api.github.com` block returns the same 403 whether a resource is real or missing, so the tarball URL was never actually confirmed reachable before shipping — an assumption, not a verified fact, exactly what should have been caught.
- ✅ Reverted `@sovereignsquad/gds-admin`/`gds-core`/`gds-theme` to 3.10.0 in `package.json`/`package-lock.json`, restored byte-for-byte (URLs, versions, `integrity` hashes) from the last commit confirmed to have deployed successfully.
- ✅ All 2.4.10 code (theme-level `Input.vars` zoom fix, GDS-governed `KanbanBoard`) is kept — none of it requires a 3.11.0-only export; `KanbanBoard` and its keyboard move-menu are already in 3.10.0, only the newer pointer/touch `enableDrag` behavior is unavailable until a real 3.11.0 release is confirmed to exist from outside this sandbox.

### GDS 3.11.0 Adoption — Theme-Level Zoom Guard, Governed Accessible Kanban (2.4.10)
- ✅ Replaced the `!important` CSS zoom-guard hack (2.4.6) with GDS 3.11.0's own theme-level fix: `gdsTheme`'s `Input.vars` component override, which floors Mantine input font-size to ≥16px via the `--input-fz` CSS variable Mantine's own size resolver reads — no specificity fight needed. Only this one override was extracted into this app's theme, not GDS's full `gdsTheme` object (which also carries color/Card/Button defaults this app doesn't want).
- ✅ Replaced `app/kanban.tsx`'s hand-rolled pointer-events drag-and-drop with GDS's governed `KanbanBoard` (`enableDrag`), gaining accessible `@dnd-kit`-based pointer/touch/keyboard drag with a live-region-announced `DragOverlay` and an unconditional keyboard "Move to column" menu fallback per card — neither of which the old implementation had.
- ✅ `useGdsKanbanOrientation` now handles stacked-vs-columns responsive layout automatically; removed the app's own `mode` prop and the `sales-page-client.tsx` `matchMedia`/`isMobile`/`saleslayoutMode` plumbing it made obsolete.
- ⚠️ Two disclosed trade-offs from GDS's fixed `KanbanBoard` API: the per-column forecast subtitle is now a single-line string (`KanbanColumnData.title` isn't a `ReactNode`); the cursor-pagination "load more" sentinel is now nested inside the last card's render output (`KanbanColumn` has no footer slot).
- 🔴 **The GDS package version bump to 3.11.0 broke the production build** — see the 2.4.11 entry above. The `package-lock.json` `integrity`-hash gap flagged here was never actually the risk that materialized; the real problem was that 3.11.0 wasn't installable at all.

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

### Dead Sort Button Removed (2.4.3)
- ✅ Removed the header's "Asc ↑"/"Desc ↓" sort button — investigation confirmed it never sorted anything: `sortOrder` state only toggled the button's own label, never passed to `KanbanBoard` or `TableView`, and `sortKey` was set once and never read anywhere. This predated the 2.4.0 header rework (already non-functional in the original header) and was carried forward unaudited when the two filter dropdowns were removed. Removed the button and the dead `sortKey`/`sortOrder` state.
- **Note**: `CHANGELOG.md`'s 2.4.3 entry states "Corrected two more false 'shipped' claims in `roadmap.md`'s UX history ('ICE-score sort controls for kanban and list view', 'Kanban ICE/name ascending/descending sort behavior')" — but this document never actually got that correction (nor a 2.4.3 entry of any kind) until now; this entry closes that gap. The unversioned "UX" list below currently contains no such claims.

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
- ✅ PWA installability: confirmed working on a real device (production, mobile) as of 2.4.18 — closes the open question raised the same day.

### Pagination Field Fix (2.2.2)
- ✅ Fixed `/api/leads`'s misleadingly-named `total` field (issue #21's low-risk sub-fix) to reflect the real total across all pages instead of the current page's count; per-page count moved to a new `returned` field. No frontend consumer read the old field, so this shipped with zero UI changes needed.

### Outcome-Logs Collection Fix (2.2.3)
- ✅ Resolved issue #11 via a temporary production diagnostic endpoint: `outcomeLogs` (camelCase) held 0 documents, `outcomelogs` (lowercase) held 2,276 with same-day activity. `/api/outcome-logs` now reads/writes `outcomelogs`, matching every other call site. Diagnostic endpoint deleted after use.

### Generic Organization Fields (2.3.0)
- ✅ Resolved the organization-genericness complaint (owner-requested, not a tracked GitHub issue — this predates the audit-remediation epic's #20/#21 numbering, which is unrelated): `pro_for_cogmap`/`pro_for_seyu` (and the `con_` equivalents) replaced with one shared `pro_for_organization`/`con_for_organization` pair used by every brand — hard cutover, no fallback. All 900 existing production documents were migrated in place via a temporary endpoint before the code shipped, so there was no gap where pros/cons appeared empty.

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
| Country filter | No country/region filter UI currently exists in the frontend (the Region/Status dropdowns were removed entirely in 2.4.0 — see `CHANGELOG.md`); `country` is only ever shown as a display badge (`app/detail.tsx`) and a table column (`app/table.tsx`), never as something a user can filter by. Earlier entries in this doc describing a "country filter" as shipped were incorrect and have been removed. If country-based filtering is still wanted, it needs to be built as new work, not assumed present |
| Table view PWA polish | Core mobile table implemented; additional density/readability tuning may be needed |

Real-device confirmation for the iOS focus-zoom fix and PWA installability both landed in 2.4.18 (see "Shipped" above) — removed from this table as no longer open. The orphaned `lead-feeder-agent.js`/`scripts/migrate-check-schema.js` drift, flagged here since 2.4.4, was resolved in 2.4.22 by deleting both files — see "Shipped" above.

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
