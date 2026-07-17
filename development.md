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
- Expanded `/api/health` with `dbLatencyMs`, `leadCounts`, `lastError`
- New `/api/admin/cron-status` endpoint for observability
- Pre-POST research-agent validation helper in `lib/lead-validator.ts`
- Single PATCH mutation path in `/api/leads/route.ts`
- Removed dead public-data fallback branches and unused `source` field
- Optional `tenantId` scoping for leads, outcome logs, health, and admin routes
- Frontend pipeline accepts `tenantId` from query params and UI
- One-click outreach templates with brand-specific defaults (CogMap/Seyu)
- `/api/outreach-templates` and `/api/outreach-logs` endpoints
- Outreach compose modal with channel-aware send rules

### Remaining Gaps
- Dedicated CORS/security headers middleware
- Test coverage
- Retry/batch verification in active research-agent runner

---

## 1. Make Kanban Actions End-to-End Reliable

**Goal:** Ensure every visible action in the UI actually succeeds, fails safely, and updates the UI consistently.

### Segment 1.1 — Frontend Action Audit
- Review `handleAction`, `handleMove`, `handleDelete` in `app/sales/[brand]/page.tsx`
- Ensure all mutations call the same canonical update endpoint
- Add disabled/busy states during requests
- Add optimistic UI updates with rollback on failure
- Replace silent catches with user-visible error messages

### Segment 1.2 — Backend Action Contract
- Choose one canonical mutation path
- Standardize response shape: `{ success, lead, error }`
- Return 400/404/409 with actionable messages instead of generic 500
- Keep outcome log writes atomic with lead updates

### Segment 1.3 — Verification
- Manual verification matrix: ACCEPT, DECLINE, PIN, REQUEST_REFRESH, COLUMN_MOVE, DELETE
- Verify old `/cogmapsales` and `/seyusales` redirects still work after changes

---

## 2. Harden Lead Data Normalization

**Goal:** Prevent malformed pros/cons or brand fields from reaching the database or breaking the UI.

### Segment 2.1 — Normalizer Hardening
- Add unit tests for `app/lib/normalize-lead.ts`
- Make `ensureArrayField()` defensive against `null`, `undefined`, numbers, nested arrays, empty strings
- Add server-side normalization in `POST /api/leads` and `PATCH /api/leads/[id]`

### Segment 2.2 — Data Hygiene
- Add an admin or health-check route that reports malformed lead counts by brand
- Optionally add a one-time cleanup migration for existing bad documents

---

## 3. Improve Error Handling and User Feedback

**Goal:** Make failures understandable and recoverable for users.

### Segment 3.1 — Global Error UX
- Add toast/notification provider in `app/layout.tsx`
- Replace `alert()` and silent catches with Mantine notifications or sonner
- Add retry affordances for transient failures

### Segment 3.2 — Structured Logging
- Add request ID middleware or helper
- Log errors with brand, leadId, action, and request ID
- Keep sensitive data out of logs

---

## 4. Strengthen Security and Access Control

**Goal:** Prevent unauthorized access while keeping the current deployment model simple.

### Segment 4.1 — API Key Auth
- Add API key validation for write endpoints
- Support read-only public access for `GET /api/leads`
- Add rate limiting middleware

### Segment 4.2 — CORS and Headers
- Configure CORS on API routes
- Add security headers where appropriate

### Segment 4.3 — Documentation
- Document API key setup in README
- Add example curl commands for authenticated requests

---

## 5. Improve Data Validation and Schema Safety

**Goal:** Reject bad input before it touches MongoDB.

### Segment 5.1 — Request Validation
- Add Zod schemas for lead creation and update payloads
- Validate required fields: `entity_name`, `url`, `region`, `kanbanColumn`
- Validate `ice` component ranges: 1–10
- Sanitize strings to prevent injection

### Segment 5.2 — Mongoose Tightening
- Enforce required fields at schema level where safe
- Add schema-level normalization hooks as a second safety layer

---

## 6. Add Observability and Monitoring

**Goal:** Know when the system is unhealthy without tailing logs manually.

### Segment 6.1 — Health Endpoint Expansion
- `/api/health` should report DB latency, lead counts by brand, and last error timestamp
- Add readiness and liveness semantics if needed

### Segment 6.2 — Metrics Collection
- Track daily leads created, acceptance rate, decline reasons, average ICE by brand
- Store aggregated metrics in a dedicated collection or compute on demand

### Segment 6.3 — Cron Monitoring
- Track last run timestamp, success/failure, leads posted, errors
- Surface cron status in README or admin endpoint

---

## 7. Clean Up Duplicated Code Paths

**Goal:** Remove maintenance burden and inconsistent behavior.

### Segment 7.1 — Single Update Path
- Remove duplicate PATCH handler
- Update frontend to use one canonical URL pattern
- Extract shared action behavior into `app/lib/lead-actions.ts`

### Segment 7.2 — Remove Dead Code
- Remove unused branches, fallback paths, and outdated comments
- Keep only active brand paths in docs and code

---

## 8. Improve Research Agent Quality and Reliability

**Goal:** Make automated lead discovery more robust and less wasteful.

### Segment 8.1 — Retry and Verification
- Add retry with backoff for transient API failures
- Add batch verification after POST: confirm all leads exist before reporting success
- Add timeout guards per run

### Segment 8.2 — Learning Feedback
- Record rejected duplicate queries/domains to reduce repeat attempts
- Log query success/failure rates per brand
- Use outcome logs to inform future search selection

### Segment 8.3 — Pre-POST Validation
- Validate required fields before POST
- Normalize arrays before submission
- Calculate and validate ICE before sending

---

## 9. Prepare for Multi-Tenant / Workspace Expansion

**Goal:** Make it safe to add more brands or workspace isolation later.

### Segment 9.1 — Tenant Awareness
- Add `tenantId` or `workspaceId` to leads, outcome logs, and search learning
- Update queries to filter by tenant + brand
- Add tenant-aware indexes

### Segment 9.2 — Migration Path
- Document how to migrate existing data into tenant-aware structure
- Keep backward compatibility for current single-tenant usage

---

## Cross-Cutting Concerns

### Performance
- Keep list endpoints paginated
- Preserve MongoDB indexes: `fingerprint`, `kanbanColumn`, `region`, `createdAt`
- Avoid N+1 queries in list/detail paths

### Security
- Never expose raw API keys or connection strings
- Validate all external input
- Log auth failures without leaking secrets

### Observability
- All mutations should be traceable via request ID
- Errors should include enough context to reproduce, but not sensitive data

### Testing
- Unit tests for normalizer, scoring, validation
- Integration tests for API routes
- E2E checks for critical flows: create lead → move columns → delete lead
