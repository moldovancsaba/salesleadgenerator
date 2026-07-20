# Development Specs — Sales Lead Generator

**Version:** 2.1.0

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

### Design System Baseline
- GDS package: `@doneisbetter/gds` v3.4.3 installed locally in `node_modules`
- GDS theme preset in use: `oceanic`
- Current GDS usage is limited to provider setup in `app/components/gds-provider.tsx`
- Mantine remains the primary UI toolkit; GDS is available but underused
- Available GDS local modules:
  - `@doneisbetter/gds-theme`
  - `@doneisbetter/gds-core`
  - `@doneisbetter/gds-admin`

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
- Design system cleanup: many hard-coded colors, spacing, typography, radii, and breakpoints
- GDS is installed but not meaningfully integrated beyond root providers

### Next Steps

#### Mobile and UX
- T-1: Tighten mobile zoom behavior for PWA: disable accidental zoom while keeping accessibility-friendly tap targets
- T-2: Make list/table view responsive for mobile: card-style rows, horizontal scroll, readable density
- T-3: Enlarge kanban drag affordance: make the whole card the drag target and improve touch pointer behavior
- T-4: Add collapsible kanban columns: per-column expand/collapse control to reduce mobile clutter
- T-5: Replace global-area filters with country-based filters: derive countries from lead data or a static list
- T-6: Add ICE-score sort order controls for kanban and list view
- T-7: Remove tenantId/default input field from the pipeline UI
- T-8: Show live lead counts in kanban column titles, e.g. `Discovered (258)`
- T-9: Add basic API/route tests for list, mutation, and health endpoints

#### Design System and GDS Integration
- D-1: Audit GDS theme exports and identify replacements for inline color/spacing/typography usage
- D-2: Replace inline styles in `app/card.tsx`, `app/kanban.tsx`, `app/sales/[brand]/page.tsx`, `app/detail.tsx`, `app/table.tsx`, `app/search-learning.tsx`, `app/page.tsx`, and shared UI components with GDS/Mantine theme tokens/props
- D-3: Introduce shared local design tokens for spacing, radii, typography, and semantic colors
- D-4: Extract reusable components: `Pill/Chip`, `CardShell`, `ColumnHeader`, `BoardLayout`, `FilterBar`
- D-5: Replace hard-coded status colors in kanban with semantic theme colors
- D-6: Centralize breakpoints: replace repeated `767px` checks with shared breakpoint helper or Mantine/GDS breakpoints
- D-7: Evaluate GDS components for high-value replacements: cards, tables, shells, filter chips, notifications, confirmations, theme toggle
- D-8: Audit and remove dead style paths that duplicate theme capability
