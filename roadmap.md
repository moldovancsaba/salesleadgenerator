# Roadmap — Sales Lead Generator

Organized by delivery phase. Each phase is independently shippable.

---

## Phase 1 — Quick Wins (2–4 weeks)

**Goal:** Deliver immediate user value with minimal engineering effort.

| # | Feature | Deliverable Segments | Impact |
|---|---------|----------------------|--------|
| 3 | One-Click Outreach Templates | 3.1, 3.2, 3.3 | High — turns viewer into worker |
| 6 | Smart Alerts & Notifications | 6.1, 6.2, 6.3 | High — drives retention |
| 7 | Saved Views & Custom Filters | 7.1, 7.2, 7.4 | Medium — improves daily UX |

**Milestone:** Users can draft outreach in one click, get notified of hot leads, and save favorite filters.

---

## Phase 2 — Core Platform (1–2 months)

**Goal:** Make the platform data-rich and team-ready.

| # | Feature | Deliverable Segments | Impact |
|---|---------|----------------------|--------|
| 2 | Auto-Enrichment Pipeline | 2.1, 2.2, 2.3, 2.5, 2.6 | High — reduces manual research |
| 8 | Team Workspaces | 8.1, 8.2, 8.3, 8.4 | High — expands from personal to company tool |
| 1 | AI-Powered Lead Scoring | 1.1, 1.2, 1.3, 1.4, 1.5 | High — improves lead quality over time |

**Milestone:** Leads auto-enrich on discovery, teams can share pipelines, AI score appears alongside ICE.

---

## Phase 3 — Scale & Enterprise (2–4 months)

**Goal:** Integrate with existing enterprise toolchains.

| # | Feature | Deliverable Segments | Impact |
|---|---------|----------------------|--------|
| 4 | CRM Sync (Read + Write) | 4.1, 4.2, 4.3, 4.4 | High — enterprise readiness |
| 5 | Lead Source & Campaign Attribution | 5.1, 5.2, 5.3 | Medium — proves ROI |
| 9 | Pipeline Analytics Dashboard | 9.1, 9.2, 9.3 | High — justifies the service |

**Milestone:** Leads sync to CRM, attribution shows which sources convert, analytics dashboard proves pipeline health.

---

## Phase 4 — Strategic Bets (3–6 months)

**Goal:** Open the platform for power users and ecosystem integration.

| # | Feature | Deliverable Segments | Impact |
|---|---------|----------------------|--------|
| 10 | Client API & Webhooks | 10.1, 10.2, 10.3, 10.4 | High — self-serve + integration |
| 1 (continued) | AI Scoring Calibration | 1.6 | Medium — model trust |
| 2 (continued) | Advanced Enrichment | 2.4 | Medium — richer contact data |

**Milestone:** External teams can pull leads via API, receive webhooks, and build custom integrations.

---

## Sequencing Principles

1. **Each phase must be independently deployable.** Do not block Phase 2 on all of Phase 1.
2. **User feedback loops first.** Outreach templates and alerts create immediate "aha" moments.
3. **Data before intelligence.** Enrichment feeds the AI scoring model; build enrichment first.
4. **Enterprise features last.** CRM sync and team workspaces require mature data models.
5. **AI scoring is additive.** ICE remains the default sort. AI Score is a second indicator. No breaking changes to existing UX.

---

## Current State

- ✅ CogMap kanban at `/cogmapsales`
- ✅ Seyu kanban at `/seyusales`
- ✅ Landing page at `/`
- ✅ Unified API structure: `/api/cogmapsales/leads`, `/api/seyusales/leads`
- ✅ Contact depth: primary + secondary contacts with email/phone
- ✅ Value props include CogMap + Seyu second-screen angle
- 🚧 Phase 1 ready to start
