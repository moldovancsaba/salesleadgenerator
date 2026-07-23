# Roadmap — Sales Lead Generator

**Version:** 2.2.0

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
| Mobile zoom refinement | Zoom behavior tightened but may still need further PWA-specific tuning |
| Table view PWA polish | Core mobile table implemented; additional density/readability tuning may be needed |
| `outcomeLogs`/`outcomelogs` collection split | Needs a direct database check (which collection, if either, holds real data) before a code fix ships |
| Unused Mongoose models decision | `models/Lead.ts`, `OutcomeLog.ts`, `SearchLearning.ts` are unused and schema-drifted; needs an owner decision — delete, or repair as a migration path |
| Pagination shape unification | 3 lead-listing endpoints use 3 different pagination contracts; needs a coordinated frontend+backend design pass, not a drive-by fix |

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
