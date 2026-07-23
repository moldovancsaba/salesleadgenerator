# SLG App — Improvement Proposal

**Version:** 2.2.2

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

### Kanban UX and Mobile Pipeline
- Responsive kanban layout with vertical stacking on narrow screens
- Pointer-based drag-and-drop with ghost preview and cleanup
- Collapsible kanban columns
- Live column lead counts in headers
- Won/Lost header color treatment
- Country-based filter UI in pipeline
- ICE/name sort controls with asc/desc in kanban and table view
- Table view mobile simplification and contrast fix
- Detail modal full-screen on mobile
- Header/filter wrapping for narrow viewports
- PWA manifest and mobile layout fixes

### Lead Actions and Feedback
- Canonical PATCH mutation path extracted to `app/lib/lead-actions.ts`
- Frontend uses loading/disabled states and toast feedback
- Actions verified: ACCEPT, DECLINE, PIN, REQUEST_REFRESH, COLUMN_MOVE, DELETE
- Shared retry utility for transient API failures
- Validation smoke tests via `npm run test:smoke`

### Lead Data Normalization
- Server-side normalization in `POST /api/leads`
- Brand-aware normalization for `pro_for_*` and `con_for_*`
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
- Real-device zoom-lock verification: **confirmed fixed** (2026-07-23) on a real device.
- Real-device PWA-installability verification: owner reports it's still not behaving as expected as of 2026-07-23; specifics (which platform, which symptom) not yet gathered — see open question in `deployment.md`.
- Table view density/readability tuning
- Country filter backfill/mapping from `region` when `country` is missing

### Test Coverage
- API/route tests beyond validation smoke tests (unit coverage of shared `lib/*` logic has grown substantially in 2.2.0, but full route-level integration tests remain TODO)

### Data Integrity Decisions Needed
- `outcomeLogs`/`outcomelogs` MongoDB collection-name split — needs a database check before a code fix ships
- Unused Mongoose models (`models/*`) — needs an owner decision: delete, or repair as a migration path
- Pagination-shape unification across `/api/leads`, `/api/search`, `/api/leads/columns` — API-contract change requiring a coordinated frontend update (note: the misleading `total` field naming trap within `/api/leads` was fixed in 2.2.2; the broader 3-shape unification is still open)

---

## Priority Order

1. Data integrity decisions (collection-name split, Mongoose models)
2. Mobile UX polish
3. Research agent reliability
4. Multi-tenant hardening