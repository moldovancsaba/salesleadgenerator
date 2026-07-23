# Deployment Log

## Latest Deployment
- **Commit**: (this session's fix; hash recorded after push)
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
