# Development Specs — Sales Lead Generator

This file describes the current implementation and the next deliverable improvements. Each segment is sized to be implemented, tested, and shipped independently.

---

## Current Implementation State

### Implemented
- Unified brand-parameterized API: `/api/leads?brand=cogmap|seyu`
- Single frontend pipeline page: `/sales/[brand]`
- Kanban board with mobile-first horizontal scroll and pointer drag
- Table view toggle
- Lead detail modal with Accept, Decline, Pin, Refresh, Modify, Delete actions
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
- Backward-compatible tenant queries for legacy leads without tenantId
- CORS and security headers middleware
- Removed dead public-data fallback branches and unused `source` field
- Action feedback toasts for mutations in lead detail modal
- Shared retry utility for transient API failures
- Mobile/PWA fixes:
  - Pipeline page uses `minHeight: 100dvh` with `overflow: auto`
  - Kanban board switches to vertical stack on narrow screens
  - Lead detail modal opens full-screen on mobile via `matchMedia`
  - Wrapped header/filter controls for narrow viewports
  - PWA manifest aligned with app metadata
  - Note: PWA launches on mobile; pinch-zoom behavior still needs tightening

### Remaining Gaps
- Test coverage
- Global toast/notification UX for action failures
- Retry/batch verification in active research-agent runner
- List/table view is not mobile-ready
- Pinch-zoom is still enabled in the PWA experience
- Kanban card drag-and-drop touch target is too small
- Kanban columns are not collapsible for mobile navigation
- Filters are global-area based instead of country based
- No view ordering by ICE score in kanban/table view
- TenantId/default input field is still present in the UI
- Kanban column titles do not show live lead counts

### Next Steps
- T-1: Tighten mobile zoom behavior for PWA: disable accidental zoom while keeping accessibility-friendly tap targets
- T-2: Make list/table view responsive for mobile: card-style rows, horizontal scroll, readable density
- T-3: Enlarge kanban drag affordance: make the whole card the drag target and improve touch pointer behavior
- T-4: Add collapsible kanban columns: per-column expand/collapse control to reduce mobile clutter
- T-5: Replace global-area filters with country-based filters: derive countries from lead data or a static list
- T-6: Add ICE-score sort order controls for kanban and list view
- T-7: Remove tenantId/default input field from the pipeline UI
- T-8: Show live lead counts in kanban column titles, e.g. `Discovered (258)`
- T-9: Add basic API/route tests for list, mutation, and health endpoints
