# Roadmap — Sales Lead Generator

**Version:** 2.4.1

---

## Shipped

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
- ✅ ICE-score sort controls for kanban and list view
- ✅ Live kanban column lead counts
- ✅ Removed tenantId/default input field from pipeline UI
- ✅ Won column header = green
- ✅ Lost column header = red
- ✅ Kanban ICE/name ascending/descending sort behavior
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
| Available countries visibility | Country filter UI is implemented, but live lead data currently lacks populated `country` values, so the list may appear empty until data is backfilled or mapped from `region` |
| Table view PWA polish | Core mobile table implemented; additional density/readability tuning may be needed |
| Unused Mongoose models decision | `models/Lead.ts`, `OutcomeLog.ts`, `SearchLearning.ts` remain unused (no importers); `Lead.ts`'s pro/con field names were corrected to the generic scheme in 2.3.0, but the broader decision — delete the files, or repair them fully as a migration path — is still open |
| Pagination shape unification | 3 lead-listing endpoints intentionally use 3 different pagination contracts (full page-list, capped search, cursor-paginated column); the misleading `total` field naming trap was fixed in 2.2.2, but full unification still needs a coordinated frontend+backend design pass, not a drive-by fix |
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
