# Changelog — Sales Lead Generator

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
