# Deployment Log

## Latest Deployment
- **Commit**: 494263b
- **Message**: feat: delete unused Mongoose models, unify lead-listing pagination on cursors
- **Build Status**: Verified via `tsc --noEmit` (0 errors), `eslint` (0 errors, 3 pre-existing warnings in untouched files carried forward), `vitest run` (35/35), smoke suite (5/5), and a real `next build`.
- **Context**: Owner picked up both remaining "flag only" decisions from the second audit pass (issues #20, #21 — both closed previously with only their low-risk sub-fixes shipped, the actual calls never made) via an explicit decision prompt. #20: delete `models/Lead.ts`/`OutcomeLog.ts`/`SearchLearning.ts` (re-verified zero importers; `mongoose` itself stays as a dependency, used only as a connection helper in `scripts/*.js`). #21: unify `/api/leads`, `/api/search`, `/api/leads/columns` on cursor pagination (`hasMore`/`nextCursor`). `/api/leads`'s cursor support is purely additive/opt-in — its legacy `page`/`limit` path is untouched, since it has a real external consumer (the research agent's one-shot `?limit=1000` call) this repo doesn't fully control. `/api/search` (frontend-only, fully controlled) was converted more directly: `results` renamed to `leads`, real `count` added, cursor pagination wired for single-brand mode. The table view's fetch switched from a hard-capped `limit=5000` single request to a cursor loop.
- **Files Changed**: `app/api/leads/route.ts`, `app/api/search/route.ts`, `app/sales/[brand]/sales-page-client.tsx`, `models/Lead.ts` (deleted), `models/OutcomeLog.ts` (deleted), `models/SearchLearning.ts` (deleted)
- **Note**: pushed to `claude/project-overview-kvj36v` (this session's designated branch) — not pushed to `main` this time, since the owner didn't say "push to main" for this specific change (the earlier `d18e981` push to main was an explicit one-off instruction, not a standing rule for every subsequent commit).

## Earlier Deployment 0e
- **Commit**: d18e981
- **Message**: fix: iOS focus-zoom fix never applied to Mantine inputs — add !important
- **Build Status**: Verified via `tsc --noEmit` (0 errors), `eslint` (0 errors, 3 pre-existing warnings in untouched files carried forward), `vitest run` (35/35), smoke suite (5/5), and a real `next build`.
- **Context**: Owner reported the header's view-mode dropdown was still force-zooming the whole PWA on iOS Safari despite the 2.4.1 fix. Root-caused by reading Mantine's actual compiled stylesheet (`node_modules/@mantine/core/styles.css`) rather than guessing: the 2.4.1 rule (`input, select, textarea { font-size: 16px }`) is a bare element selector (specificity 0-0-1), but Mantine sets each input's font-size via a class selector (`.m_8fb7ebe7 { font-size: var(--input-fz, ...) }`, specificity 0-1-0), which always wins the cascade regardless of source order — so the fix silently never applied to any Mantine input, only to plain native ones outside Mantine. Added `!important`, confirmed no competing `!important` rule exists in Mantine's CSS that could out-rank it. Also widened the view-mode Select (132px -> 168px) to fit its longest label at the now-correctly-enforced 16px font. This is an iOS-Safari-only rendering behavior with no headless/desktop equivalent, and Playwright itself couldn't be installed in this sandbox (re-triggers `npm install`, which fails on the private GDS tarballs) — verification was limited to confirming the compiled CSS served by a real `next dev`/`next build` contains the `!important` rule exactly as written; per the CSS spec this deterministically wins regardless of specificity, so no live-device render was needed to confirm the mechanism, but real-device confirmation is still recommended.
- **Files Changed**: `app/globals.css`, `app/sales/[brand]/sales-page-client.tsx`
- **Note**: merged cleanly and pushed directly to `main` (`d18e981`) per the owner's explicit "commit everything and push to origin main" instruction; `claude/project-overview-kvj36v` kept in sync at the same commit.

## Earlier Deployment 0d
- **Commit**: 3723432
- **Message**: fix: header overflow, missing desktop detail-panel body, stuck drag-ghost
- **Build Status**: Verified via `tsc --noEmit` (0 errors), `eslint` (0 errors, 3 pre-existing warnings in untouched `app/outreach/*` files carried forward as recorded), `vitest run` (35/35), smoke suite (5/5), and a real `next build`.
- **Context**: Live device screenshot review surfaced 3 real bugs. (1) Header/search bar overflowed the screen on narrow viewports — a `wrap="nowrap"` row combining 3 lines of verbose header text with the view-mode selector was wider than the viewport with nothing able to shrink/wrap, so the selector rendered off-screen; compacted to 2 rows and dropped the "· updated HH:MM:SS"/"Forecast:...weighted" wording per the owner's requested terse "N leads / $amount" format, plus a global `overflow-x: hidden` CSS safety net. (2) The desktop/tablet-width (>=1280px) `AdminDetailDrawer` lead-detail panel was missing its entire body — only `metadata` (name + 3 badges) was ever passed, never `content` (ICE score, contacts, pros/cons, every action button); confirmed against `AdminDetailDrawer`'s real source (`packages/gds-admin/src/AdminOverlays.tsx`) that it renders `{media}`/`{metadata}`/`{children}` and simply never received the last one — fixed by passing `{content}`. (3) A quick tap on a kanban card could leave a permanently stuck drag-ghost and dimmed card — the drag-arm timer in `app/kanban.tsx` was cancelled only on excess movement, never on `pointerup`/`pointercancel`, so an ordinary tap still let the 200ms timer fire after the pointer already lifted, with no future pointerup on that pointerId ever arriving to clear it.
- **Files Changed**: `app/sales/[brand]/sales-page-client.tsx`, `app/detail.tsx`, `app/kanban.tsx`, `app/globals.css`
- **Note**: pushed to `claude/project-overview-kvj36v` (this session's designated branch); not yet merged into `main`.

## Earlier Deployment 0c
- **Commit**: 2ca7879
- **Message**: feat: kanban auto-classification/sort rule — 500 ICE threshold, 2 tiers only
- **Build Status**: Verified via `tsc --noEmit` (0 errors — also fixed 4 pre-existing implicit-`any` errors in `app/detail.tsx`/`app/table.tsx` unrelated to this change), `eslint` (0 errors, 3 pre-existing warnings in untouched `app/outreach/*` files carried forward as recorded), `vitest run` (35/35), smoke suite (5/5), and a real `next build`.
- **Context**: Owner specified an exact business rule verbatim: DISCOVERED/QUALIFIED are auto-managed purely by ICE score (500 threshold, always sorted high to low, no other sort); every other column is exclusively user-managed once a lead is moved there, permanently. `lib/kanban-column.ts`'s `deriveKanbanColumn` was rewritten from an incorrect 3-tier 480/720 rule (which also auto-promoted to `ENGAGED`) to the correct 2-tier rule — corroborated by finding `ICE_QUALIFIED_THRESHOLD = 500` already declared in `app/constants.ts` but never referenced anywhere, strong evidence this was the original intended design that was never finished. `PUT /api/leads/[id]` now auto-reclassifies a lead still in DISCOVERED/QUALIFIED whenever its `ice` changes (unless `kanbanColumn` is also explicitly set in the same request). `GET /api/leads/columns` now sorts the two auto-managed columns via a Mongo aggregation on computed ICE score (`ICE_SCORE_AGGREGATION_EXPR`), cursor-paginated on that score; the 4 manual columns are untouched, still `sortOrder`-based. Flagged but not touched: `lead-feeder-agent.js` and `scripts/migrate-check-schema.js` contain their own older, now-drifted column logic, but neither is wired into the running app (same orphaned status as the already-tracked unused Mongoose models).
- **Files Changed**: `lib/kanban-column.ts`, `app/constants.ts`, `app/api/leads/[id]/route.ts`, `app/api/leads/columns/route.ts`, `app/detail.tsx`, `app/table.tsx`, `tests/lib/kanban-column.test.ts`
- **Note**: pushed to `claude/project-overview-kvj36v` (this session's designated branch) — `origin/main` has since moved to a separate, unrelated commit (`dfe9b4c`, "Add CogMap ICP guidance to discovery prompt") pushed outside this session; no PR exists yet for this branch, so it has not been merged into `main`.

## Earlier Deployment 0b
- **Commit**: c3a7140
- **Message**: fix: PATCH /api/leads was silently failing for every action, not just drag-and-drop
- **Build Status**: Verified via `tsc --noEmit` (pre-existing GDS-stub artifact only), `eslint` clean repo-wide, `vitest run` (33/33), smoke suite (5/5).
- **Context**: Owner reported "drag and drop not permanent, looks like move but immediately refresh and stays in the original." Root cause was significantly bigger than drag-and-drop: `PATCH /api/leads`'s own documented contract (`docs/OPERATOR_GUIDE.md`) requires the lead `id` as a URL query param, matching exactly what the route reads (`searchParams.get('id')`) — but both client call sites (`handleAction` in `sales-page-client.tsx`, used by every detail-modal action: Accept/Decline/Pin/Refresh/Modify; and `handleMove` in `kanban.tsx`, drag-and-drop) only ever sent `id` in the JSON body, never the URL. Every PATCH action has been silently 400ing since these call sites existed. For drag-and-drop, the failed request's catch block reloads the source column from the server (unchanged), which is exactly why the card visually moved then snapped back. Fixed by adding the missing `?id=` param to both call sites — no server-side change needed, since the route already matched its own documented contract.
- **Files Changed**: `app/kanban.tsx`, `app/sales/[brand]/sales-page-client.tsx`

## Earlier Deployment 0a
- **Commit**: 59eb72f
- **Message**: fix: force-zoom on input focus, wrong search component, duplicate search results
- **Build Status**: Verified via `tsc --noEmit` (pre-existing GDS-stub artifact only), `eslint` clean repo-wide, `vitest run` (33/33), smoke suite (5/5), and a real `next build`.
- **Context**: Owner reported 3 issues on a real device from the 2.4.0 search bar/kanban board, via screenshot: (1) the page force-zoomed on focusing the search input — a different iOS Safari mechanism than pinch-zoom, triggered by any focused input with computed font-size below 16px (Mantine's default sizes render below that); fixed with a global CSS floor. (2) "the input field is not the input field" — read GDS's `SearchableSelect` real source and confirmed it's a closed combobox picker (visible box is a button that only opens a dropdown; the real typing field is hidden inside, unstyled), the wrong component for a live search bar; replaced with a plain `TextInput` + custom debounced dropdown. (3) duplicate results in search (e.g. "Arsenal FC" appearing twice) — `/api/search` was missing the fingerprint-based dedup `/api/leads` already has; added it.
- **Files Changed**: `app/globals.css`, `app/sales/[brand]/sales-page-client.tsx`, `app/api/search/route.ts`

## Earlier Deployment 0
- **Commit**: e5c5ac9
- **Message**: feat: kanban board UX overhaul — header layout, search, drag-and-drop rebuild, forecast display (fixes #23)
- **Build Status**: Verified via `tsc --noEmit` (pre-existing GDS-stub artifact only), `eslint` clean repo-wide, `vitest run` (33/33), smoke suite (5/5), and a real `next build` (fails only on the same pre-existing GDS-stub artifact, confirmed present with the change stashed out too).
- **Context**: Owner screenshot review of the mobile pipeline header requested 5 changes, tracked as issue #23: (1) view-mode selector pinned to the header's top-right, Region/Status filter dropdowns removed entirely; (2) a new predictive search bar (GDS `SearchableSelect`, backed by the existing `/api/search`); (3) kanban drag-and-drop rebuilt from scratch — investigation found it wasn't buggy, it was completely absent from `app/kanban.tsx` despite changelog/roadmap history describing it as shipped (likely lost in an earlier rewrite to cursor-paginated columns); implemented with Pointer Events (long-press-to-arm, so scroll/tap keep working), ghost preview, drop-target highlight, optimistic UI; (4) ticket size (estimated deal value) on each card; (5) pipeline-weighted ("discounted") forecast per column header, extended to Seyu which had no per-column breakdown before. Real-device verification of the drag/search/layout interactions is flagged as outstanding in issue #23 — not verifiable from this environment.
- **Files Changed**: `app/sales/[brand]/sales-page-client.tsx`, `app/kanban.tsx`, `app/card.tsx`, `app/constants.ts`, `app/types.ts`, `app/api/boards/[brand]/route.ts`

## Earlier Deployment
- **Commit**: 26c3ea1
- **Message**: fix: add hideWhenNoMedia to the remaining AdminResourceCard usage in search-learning
- **Build Status**: Verified via `tsc --noEmit` (pre-existing GDS-stub artifact only), `eslint` clean, `vitest run` (33/33), smoke suite (5/5).
- **Context**: The owner reported the image placeholder was still showing after `4169b22` shipped. That commit only touched the kanban `LeadCard` (switched to `ProductCard`) — it never touched `app/search-learning.tsx`'s separate `AdminResourceCard` usage in its "Top Queries" cards, which is almost certainly what the owner was still seeing. Read `AdminResourceCard`'s real source (`packages/gds-admin/src/AdminResourceManager.tsx`, via the same `raw.githubusercontent.com` path used for `ProductCard`) instead of guessing: it wraps `MediaPreviewCard` and exposes `hideWhenNoMedia?: boolean`, documented inline as *"Omit the media area entirely for records with no media, instead of a placeholder block"* — defaulting to showing the placeholder unless a consumer opts in. Neither `AdminResourceCard` usage in this repo (the old `LeadCard`, now replaced, and `search-learning.tsx`) ever passed it. Added `hideWhenNoMedia` to `search-learning.tsx`'s usage. Also read `app/table.tsx`'s `AdminDataTable` source to rule it out as another source of the same symptom — confirmed its mobile-card path has no media/placeholder chrome around the fully custom `renderMobileCard` prop.
- **Files Changed**: `app/search-learning.tsx`

## Earlier Deployment 2
- **Commit**: 4169b22 — supersedes the partial fix in `96356f3`
- **Message**: fix: switch LeadCard from AdminResourceCard to ProductCard, removing the image placeholder
- **Build Status**: Verified via `tsc --noEmit` (pre-existing GDS-stub artifact only), `eslint` clean, `vitest run` (33/33), smoke suite (5/5).
- **Context**: The owner asked for kanban cards to stop showing an image placeholder when a lead has no image (which is always — `Lead` has no image field in the data model at all). An earlier attempt (`96356f3`) just stopped passing empty `mediaSrc`/`thumbnailSrc` props to the existing `AdminResourceCard` component, but that component's real source isn't accessible from this sandbox (`@sovereignsquad/gds-admin` is a private, GitHub-tarball-installed package), so there was no way to confirm whether it still reserved placeholder space regardless. The owner pointed at `ProductCard` from `@sovereignsquad/gds-core` instead. This sandbox couldn't reach the design-system's docs site (`sovereignsquad.github.io`, blocked) or the release tarball (blocked, same constraint as always) or add the repo to the session (declined), but `raw.githubusercontent.com` turned out to be reachable — the real `ProductCard.tsx` source was read directly from `sovereignsquad/general-design-system` to confirm its contract: `media`/`icon` are optional `ReactNode` props rendered bare (`{media}`), so omitting them renders nothing at all, no placeholder. `app/card.tsx` rewritten to use `ProductCard` with `density="compact"`, `variant="compact"`, `size="sm"` (the design system's dedicated tight-list contract), no `media`/`icon` props, and a plain Mantine `Button` for the preview action (not `SemanticButton`, since that hook depends on `GdsProvider`/theme context this app doesn't wrap itself in). A local stub for `@sovereignsquad/gds-core`/`gds-core/client` was added under `node_modules/` (gitignored, sandbox-only, matching the existing `gds-admin` stub pattern) so this environment's `tsc`/`eslint`/`vitest` can run — Vercel installs the real package.
- **Files Changed**: `app/card.tsx`

## Previous Deployment (not separately logged until now)
- **Commit**: 481e287
- **Message**: fix: update agent-runtime prompts/config for the generic organization fields
- **Context**: Updated the OpenClaw research agent's `agent-runtime/tenants.json` and `schema-mapper.js` (added to this repo by KiloClaw's earlier direct push to `main`) to use the same `pro_for_organization`/`con_for_organization` fields shipped in 2.3.0, since the agent's config still referenced the removed brand-specific field names.

## Earlier Deployment
- **Commit**: 55efdba (field-rename cutover), c7d2029 (merged in KiloClaw's agent-runtime/ addition, de-duplicated a redundant service-worker registration it introduced in `app/layout.tsx`)
- **Message**: fix: generic pro_for_organization/con_for_organization fields, hard cutover (fixes #20)
- **Build Status**: Verified via `tsc --noEmit` (pre-existing GDS-stub artifact only, confirmed identical with this change stashed out), `eslint` clean on every touched file, `vitest run` (33/33, including 2 tests rewritten to match the new generic-field behavior), smoke suite (5/5). A real `next build` was also attempted; it fails on the same pre-existing GDS-stub artifact confirmed present identically with this change stashed out (unrelated to this change).
- **Context**: The owner asked for the value-proposition fields to work for any organization, not just the two hardcoded brands — `pro_for_seyu` doesn't generalize. Sequenced as a two-step hard cutover to avoid any window of missing data: (1) a temporary migration endpoint (`GET /api/admin/migrate-pro-con-fields?confirm=migrate`, this sandbox couldn't trigger it directly for the same MongoDB/Vercel reachability reasons as issue #11, so the owner opened it once) renamed the field in-place across both collections — 408 docs in `leads`, 492 in `seyu_leads`, verified zero remaining with the old names; (2) only after that migration was confirmed did the code ship reading/writing exclusively the new `pro_for_organization`/`con_for_organization` names, with the old brand-templated names removed everywhere (`app/lib/brand.ts`'s `proField`/`conField` per-brand config, `lib/validate-lead.ts`'s brand-templated field computation and its now-obsolete forbidden-cross-brand-field check, `app/lib/normalize-lead.ts`'s `brand`-templated lookup — the now-unused `brand` parameter was dropped from `normalizeLead()` entirely, `app/detail.tsx`, `app/api/leads/route.ts`, `app/api/leads/[id]/route.ts`, `app/lib/lead-actions.ts`, `app/api/admin/data-hygiene/route.ts`, `app/api/boards/route.ts`, `app/types.ts`, `models/Lead.ts`). The migration endpoint was deleted in the same commit as the code cutover.
- **Files Changed**: `app/lib/brand.ts`, `app/lib/normalize-lead.ts`, `app/detail.tsx`, `app/api/leads/route.ts`, `app/api/leads/[id]/route.ts`, `app/lib/lead-actions.ts`, `app/api/admin/data-hygiene/route.ts`, `app/api/boards/route.ts`, `lib/validate-lead.ts`, `app/types.ts`, `models/Lead.ts`, `tests/lib/validate-lead.test.ts`, `tests/smoke/validate-lead.smoke.ts`; `app/api/admin/migrate-pro-con-fields/route.ts` added then removed within this deployment sequence.

## Previous Deployment
- **Commit**: f83bc1d
- **Message**: fix: point /api/outcome-logs at the real outcomelogs collection (fixes #11)
- **Build Status**: Verified via `tsc --noEmit` (pre-existing GDS-stub artifact only), `eslint` clean, `vitest run` (33/33), smoke suite (4/4).
- **Context**: Issue #11 required a real production-database check before any fix, since `outcomeLogs` (camelCase) and `outcomelogs` (lowercase) both existed as MongoDB collections and no code path proved which was authoritative. This sandbox cannot reach MongoDB Atlas directly (DNS resolution for `*.mongodb.net` fails under this environment's egress policy) nor reach the live Vercel deployment (proxy returns a 403 policy denial for `salesleadgenerator.vercel.app`). Deployed a temporary, unauthenticated, read-only diagnostic endpoint (`GET /api/admin/diag-outcome-logs`) to production instead; the owner opened it once from their phone and reported: `outcomeLogs` = 0 documents, `outcomelogs` = 2,276 documents with same-day activity. That settled it. `/api/outcome-logs`'s GET and POST handlers now use `outcomelogs`, matching every other call site. The diagnostic endpoint was deleted in the same change.
- **Files Changed**: `app/api/outcome-logs/route.ts`; `app/api/admin/diag-outcome-logs/route.ts` added then removed within this deployment sequence.

## Previous Deployment
- **Commit**: 3b513d5
- **Message**: fix: correct misleading `total` field in GET /api/leads (fixes #21 sub-fix)
- **Build Status**: Verified via `tsc --noEmit` (only the pre-existing, unrelated GDS-stub sandbox artifact remains — confirmed present identically with this change stashed out), `eslint`, `vitest run` (33/33), and the smoke suite (4/4), all clean.
- **Context**: Issue #21 documented `/api/leads`'s `total` field as actively misleading — it held the count of leads returned on the current page (post-dedup), not the real total across all pages, even though the adjacent `totalPages` field was already computed correctly from the real total. Checked every frontend consumer (`app/sales/[brand]/sales-page-client.tsx`, `app/kanban.tsx`, `app/table.tsx`, `app/search-learning.tsx`, `app/metrics.tsx`) before changing the field — none read `.total` from this endpoint's response, so the rename is a safe, zero-impact fix. `total` now holds the real grand total; the per-page count moved to a new `returned` field.
- **Files Changed**: `app/api/leads/route.ts`

## Open question raised by the owner (2026-07-23, not yet resolved)
Zoom-lock fix (2.2.1) confirmed working on a real device. However, the owner reports the app is "not available as I expected" as a PWA — meaning some install/PWA behavior still isn't matching expectations, but the specific symptom (no install prompt at all on Android? no "Add to Home Screen" option? installs but doesn't launch standalone? testing on iOS, which has no automatic prompt by design?) hasn't been gathered yet. `manifest.json`, `app/layout.tsx`, `public/sw.js`, and both icon files were re-verified in this session (valid PNGs at correct dimensions, no manifest/service-worker collisions in `next.config.js` or `middleware.ts`) and show no structural defect. Needs specifics from the owner before further code changes are justified — flagged rather than guessed at.

## Previous Deployment
- **Commit**: 96b0bb0
- **Message**: fix: add missing PWA icons + service worker, lock zoom via CSS/JS not just viewport meta (fixes #22)
- **Build Status**: Verified locally via a real `next build` (compiled successfully, same single known GDS-stub sandbox artifact as always) prior to push; live Vercel confirmation pending.
- **Context**: reported live on `/sales/seyu` — pinch-zoom still worked despite 3 prior fix attempts, and the app never behaved as an installable PWA. Root-caused: `manifest.json`/`layout.tsx` referenced `/icon-192.png` and `/icon-512.png`, neither of which existed in `public/` (fails installability outright); no service worker existed anywhere; and zoom lock relied solely on the viewport meta tag, which iOS Safari has ignored (`user-scalable=no`/`maximum-scale`) since iOS 10. Added real icons, a minimal shell-only service worker, CSS `touch-action: manipulation`, and a JS-level gesture/multi-touch guard. Real-device verification (actual iOS Safari, Android Chrome) still pending.
- **Files Changed**: `app/layout.tsx`, `app/globals.css` (new), `app/components/PwaSetup.tsx` (new), `public/sw.js` (new), `public/icon-192.png` (new), `public/icon-512.png` (new)

## Earlier Deployment
- **Commit**: 22312b4
- **Message**: fix: split sales page into async Server Component + Client Component (fixes Vercel build failure)
- **Vercel Build**: `iad1`, Node build machine (2 cores, 8 GB)
- **Build Status**: **Succeeded** — confirmed by a full Vercel build log: `next build` compiled successfully, type-checking passed, deployment completed.
- **Context**: this commit fixed a build failure introduced by the Next.js 15 upgrade (commit `bdd9d6f`) — `app/sales/[brand]/page.tsx` kept synchronous `params` access on the assumption that Next 15 preserves backward-compatible sync access for Client Component pages. That assumption was wrong specifically for the build's own generated `PageProps` type constraint, which requires `params: Promise<{...}>` on the page's exported component regardless of client/server boundary. Fixed by splitting the file into an async Server Component wrapper (`page.tsx`) and a new Client Component (`sales-page-client.tsx`) receiving the resolved `brand` as a plain prop — no React 19 upgrade needed.
- **Files Changed**: `app/sales/[brand]/page.tsx`, `app/sales/[brand]/sales-page-client.tsx` (new)

## Preceding Commits in This Deployment (2.2.0 security/dependency/code-quality remediation)
- `76ebb8c` — fix: align search-learning error responses to the standard `{error, details}` shape
- `114c2e4` — fix: correct `Lead.region` type to match real backend values (+ live badge-color bug fix)
- `9a91612` — refactor: consolidate triplicated pipeline-weight forecast math
- `24db5fe` — fix: use proper `tenantFilter()` semantics for health's `tenantLeadCounts`
- `1d7bbbf` — fix: add missing API-key check to outcome-logs POST
- `c00389d` — fix: wire lead validation into `PUT /api/leads/:id`
- `cee8531` — fix: consolidate 4x duplicated `isMongoConfigured()`
- `1b20ce4`/`2a8748e` — fix/docs: remove orphaned dead scaffolding (`ai-scoring`, `lead-validator.ts`)
- `605e53b`/`b1d4bba` — fix: migrate ESLint 8 → 9 flat config
- `bdd9d6f` — fix: upgrade Next.js off vulnerable 14.2.x line, add ESLint config
- `c6fc2e5` — refactor: extract shared kanban-column and fingerprint helpers
- `a0f8133` — fix: reject requests with missing x-api-key header
- `d6f5794` — fix: define missing `columnWidth` in KanbanBoard

## Historical Deployments
- `cf88474` — fix: allow null lead prop in LeadDetailModal to resolve build type error
- `545b57e` — fix: wire modal opening reliably and stop defaulting unknown region to US
- `af833d2` — fix: harden PWA preview path and remove zoom-forcing viewport
- `05ec8ac` — refactor: zero-client-calc UI, board metadata API, lazy columns, metrics endpoint
- `507d281` — fix: resolve build errors in api settings/forecast and metrics missing imports
