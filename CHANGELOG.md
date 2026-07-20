# Changelog — Sales Lead Generator

## 2.1.0

Current production version. Baseline for this documentation set.

### Added
- Brand-parameterized API: `/api/leads?brand=cogmap|seyu`
- Single frontend pipeline page: `/sales/[brand]`
- Mobile-first kanban board with horizontal column scroll and pointer drag
- Table view toggle
- Lead detail modal with Accept, Decline, Pin, Refresh, Modify, and Delete actions
- ICE scoring with automatic calculation on lead creation
- Brand-aware normalization for `pro_for_*` and `con_for_*`
- Outcome logging for mutations
- Pagination support on list endpoint
- MongoDB Atlas persistence per brand collection
- Write-endpoint auth gate via `requireApiKey`
- Lightweight request validation for POST/PATCH via `lib/validate-lead.ts`
- Pre-POST research-agent validation helper in `lib/lead-validator.ts`
- Expanded `/api/health` with `dbLatencyMs`, `leadCounts`, `lastError`
- `/api/admin/cron-status` endpoint for observability
- Canonical PATCH mutation path in `lib/lead-actions.ts` with requestId tracing
- Outreach templates with organization-agnostic defaults
- `/api/outreach-templates` with analytics mode and brand scoping
- `/api/outreach-logs` with server-side channel routing enforcement
- Outreach compose modal with channel-aware send rules
- Outreach template management UI at `/outreach/templates`
- Backward-compatible tenant queries for legacy leads without `tenantId`
- CORS and security headers middleware
- Action feedback toasts for mutations in lead detail modal
- Shared retry utility for transient API failures

### Changed
- Tenant filter defaults to `default` and includes legacy docs without `tenantId`
- Lead contacts are canonical; top-level contact fields are merged into `contacts[]` on write, then cleared from list/detail responses where possible

### Known Issues
- Full `next build` may OOM in limited local environments; use `tsc --noEmit` for type verification
- PWA pinch-zoom behavior still needs tightening
- List/table view is not mobile-ready
- Kanban drag affordance and touch target sizing need improvement
- Kanban columns are not collapsible for mobile navigation
- Filters are global-area based instead of country based
- No view ordering by ICE score in kanban/table view
- TenantId/default input field is still present in the pipeline UI
- Kanban column titles do not show live lead counts

---

## Unreleased

Future work is tracked in `roadmap.md` and `PROPOSAL.md`.
