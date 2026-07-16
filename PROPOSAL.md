# SLG App — Next Improvement Proposal

## Current State Assessment

The app is now a unified, brand-parameterized sales lead generator. It builds, deploys, and loads leads. However, several operational, quality, and scalability gaps remain before it can be considered production-hardened.

## Issues Broken Down Into Deliverable Tasks

### 1. Make Kanban Actions End-to-End Reliable

**Problem:** The UI exposes Accept, Decline, Pin, Refresh, drag-to-move, and Delete. Some of these paths are fragile because the action contract is split across two PATCH handlers, and the frontend does not consistently wait for confirmation or handle partial failures.

**Tasks:**
- Audit frontend `handleAction`, `handleMove`, and `handleDelete` in `app/sales/[brand]/page.tsx`.
- Audit backend action handlers in `app/api/leads/route.ts` and `app/api/leads/[id]/route.ts`.
- Unify the action contract: frontend calls `/api/leads/[id]?brand=...` for all mutations, or `/api/leads?id=...&brand=...` consistently.
- Add explicit response shape: `{ success, lead, error }`.
- Add optimistic UI + rollback on failure.
- Add loading/disabled states during mutation.
- Verify all actions with automated checks: ACCEPT, DECLINE, PIN, REQUEST_REFRESH, COLUMN_MOVE, DELETE.

**Priority:** P0 — blocks real usage.

---

### 2. Harden Lead Data Normalization

**Problem:** `pro_for_*` and `con_for_*` fields arrive as strings or arrays from different sources. The normalizer handles this, but edge cases remain around empty strings, `null`, nested objects, and brand mismatches.

**Tasks:**
- Add unit tests for `app/lib/normalize-lead.ts`.
- Make `ensureArrayField()` defensive against `null`, `undefined`, numbers, and nested arrays.
- Add server-side normalization in both `POST /api/leads` and `PATCH /api/leads/[id]` so bad data never reaches MongoDB.
- Add a health-check endpoint or admin route that scans for malformed leads and reports counts.

**Priority:** P1 — prevents data corruption.

---

### 3. Improve Error Handling and User Feedback

**Problem:** Errors are logged to console but often not surfaced to the user. Network failures show generic messages. There is no toast/notification system wired to API failures.

**Tasks:**
- Add a global error boundary or toast provider in `app/layout.tsx`.
- Replace `alert()` and silent catches with Mantine notifications or sonner.
- Add retry logic for transient failures in `fetchLeads`, `handleAction`, `handleMove`.
- Show actionable messages: “Failed to save. Retry?”, “Lead moved but sync is delayed.”
- Log structured errors in API routes with request IDs.

**Priority:** P1 — directly affects perceived reliability.

---

### 4. Strengthen Security and Access Control

**Problem:** The API is currently open. There is no authentication, rate limiting, or CORS policy. Any client can read/write/delete leads.

**Tasks:**
- Add API key authentication for write endpoints (`POST`, `PATCH`, `DELETE`).
- Add read-only public access option for `GET /api/leads`.
- Add rate limiting middleware for public endpoints.
- Add CORS configuration on API routes.
- Add request logging with IP, user agent, and API key hash.
- Document the API key setup in README.

**Priority:** P2 — required before external/team use.

---

### 5. Improve Data Validation and Schema Safety

**Problem:** The Mongoose schema is loose in places. `pro_for_cogmap` and `con_for_cogmap` accept arrays of strings, but the API does not validate length, content, or encoding. There is no input sanitization.

**Tasks:**
- Add Zod or equivalent validation middleware for all API request bodies.
- Validate `entity_name`, `url`, `region`, `kanbanColumn`, `ice` ranges.
- Sanitize string inputs to prevent injection.
- Add schema-level defaults and required fields enforcement.
- Return 400 with field-level error details on invalid input.

**Priority:** P2 — prevents bad data and downstream UI breaks.

---

### 6. Add Observability and Monitoring

**Problem:** There is no alerting on API failures, no metrics dashboard, and no visibility into cron job health or lead quality trends.

**Tasks:**
- Add `/api/health` expansion: DB latency, lead count, error rate, last cron run status.
- Add structured logging with request IDs across API routes.
- Add a simple metrics collection for: leads created per day, acceptance rate, decline reasons, average ICE score.
- Add cron job monitoring: track last run timestamp, success/failure, leads posted.
- Optionally integrate with Sentry or similar for error tracking.

**Priority:** P2 — needed for operational confidence.

---

### 7. Clean Up Duplicated Code Paths

**Problem:** Two PATCH handlers exist (`app/api/leads/route.ts` and `app/api/leads/[id]/route.ts`). Both implement similar action logic but with slight differences. This creates maintenance burden and inconsistent behavior.

**Tasks:**
- Choose one canonical update path: either `/api/leads/[id]?brand=...` or `/api/leads?id=...&brand=...`.
- Remove the duplicate handler.
- Update frontend calls to use the chosen path consistently.
- Extract shared action logic into `app/lib/lead-actions.ts`.

**Priority:** P2 — reduces bugs.

---

### 8. Improve Research Agent Quality and Reliability

**Problem:** The research agent posts leads but has no structured retry, no partial-failure handling, and limited verification beyond a single GET after POST.

**Tasks:**
- Add retry with backoff for transient API failures.
- Add batch verification: after posting N leads, verify all N exist before reporting success.
- Add agent run logging: queries used, orgs found, leads posted, failures, reasons.
- Add duplicate-detection feedback loop: if a lead is rejected as duplicate, record the query/domain to avoid repeating it.
- Add validation before POST: ensure required fields are present, arrays are normalized, ICE is calculated.

**Priority:** P3 — improves data quality over time.

---

### 9. Prepare for Multi-Tenant / Workspace Expansion

**Problem:** The system is currently single-tenant in practice, even though it has a `brand` concept. If you want to add a third brand or allow workspace-level isolation, the data model needs preparation.

**Tasks:**
- Add `workspaceId` or `tenantId` to leads, outcome logs, and search learning.
- Update all queries to filter by tenant in addition to brand.
- Add tenant-aware indexes.
- Document the multi-tenant migration path.

**Priority:** P3 — future-proofing.

---

## Recommended Execution Order

1. **P0:** Fix kanban actions end-to-end.
2. **P1:** Harden normalization + error handling/feedback.
3. **P2:** Security, validation, observability, deduplicate code paths.
4. **P3:** Research agent improvements + multi-tenant prep.

Each task is independently shippable. No task requires a full rewrite.
