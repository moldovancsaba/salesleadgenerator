# SLG App — Improvement Proposal

## Purpose

This document tracks proposed improvements against the current shipped state. Completed or superseded workstreams are marked accordingly.

---

## Completed Workstreams

### Kanban Actions Reliability
- Canonical PATCH mutation path extracted to `app/lib/lead-actions.ts`
- Frontend uses loading/disabled states and toast feedback
- Actions verified: ACCEPT, DECLINE, PIN, REQUEST_REFRESH, COLUMN_MOVE, DELETE

### Lead Data Normalization
- Server-side normalization in `POST /api/leads`
- Brand-aware normalization for `pro_for_*` and `con_for_*`
- Duplicate fingerprint prevention on write
- Quality gate enforcement for low-confidence leads

### Error Handling and User Feedback
- Mantine notifications wired to mutation outcomes
- Shared retry utility for transient API failures
- Request IDs for tracing

### Security and Access Control
- `requireApiKey` guards write/admin endpoints
- CORS and security headers in `middleware.ts`
- Public read access for listings and health

### Data Validation
- Request validation for POST/PATCH via `lib/validate-lead.ts`
- Pre-POST validation helper for research agent

### Observability
- `/api/health` expanded with `dbLatencyMs`, `leadCounts`, `lastError`
- `/api/admin/cron-status` endpoint
- `/api/admin/data-hygiene` endpoint
- `/api/stats` totals and breakdowns
- Outcome logging for mutations

### Code Path Cleanup
- Canonical PATCH path via `/api/leads?id=...&brand=...`
- Shared action logic in `app/lib/lead-actions.ts`

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
- Table view mobile responsiveness
- Kanban drag affordance and touch targets
- Collapsible columns and live counts
- Country-based filters
- ICE-score sort controls

---

## Priority Order

1. Mobile UX polish
2. Research agent reliability
3. Multi-tenant hardening