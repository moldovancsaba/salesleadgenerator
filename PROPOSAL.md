# SLG App — Improvement Proposal

**Version:** 2.1.0

## Purpose

This document tracks proposed improvements against the current shipped state. Completed or superseded workstreams are marked accordingly.

---

## Completed Workstreams

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
- PWA zoom refinement
- Table view density/readability tuning
- Country filter backfill/mapping from `region` when `country` is missing

### Test Coverage
- API/route tests beyond validation smoke tests

---

## Priority Order

1. Mobile UX polish
2. Research agent reliability
3. Multi-tenant hardening