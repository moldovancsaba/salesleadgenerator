# Deployment Log

## Latest Deployment
- **Commit**: 96b0bb0
- **Message**: fix: add missing PWA icons + service worker, lock zoom via CSS/JS not just viewport meta (fixes #22)
- **Build Status**: Verified locally via a real `next build` (compiled successfully, same single known GDS-stub sandbox artifact as always) prior to push; live Vercel confirmation pending.
- **Context**: reported live on `/sales/seyu` — pinch-zoom still worked despite 3 prior fix attempts, and the app never behaved as an installable PWA. Root-caused: `manifest.json`/`layout.tsx` referenced `/icon-192.png` and `/icon-512.png`, neither of which existed in `public/` (fails installability outright); no service worker existed anywhere; and zoom lock relied solely on the viewport meta tag, which iOS Safari has ignored (`user-scalable=no`/`maximum-scale`) since iOS 10. Added real icons, a minimal shell-only service worker, CSS `touch-action: manipulation`, and a JS-level gesture/multi-touch guard. Real-device verification (actual iOS Safari, Android Chrome) still pending.
- **Files Changed**: `app/layout.tsx`, `app/globals.css` (new), `app/components/PwaSetup.tsx` (new), `public/sw.js` (new), `public/icon-192.png` (new), `public/icon-512.png` (new)

## Previous Deployment
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
