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

### Remaining Gaps
- Test coverage
- Global toast/notification UX for action failures
- Retry/batch verification in active research-agent runner
