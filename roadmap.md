# Roadmap — Sales Lead Generator

**Version:** 2.1.0

---

## Shipped

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

---

## In Progress

| Item | Notes |
|------|-------|
| Mobile UX polish | Table view responsiveness, drag affordance, collapsible columns, live counts, country filters, ICE sort controls |
| Research agent reliability | Retry/backoff, batch verification, run logging, duplicate feedback loop |

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
- Documentation backlog: `documentationtasks.md`
