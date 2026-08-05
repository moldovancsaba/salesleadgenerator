# Sales Lead Generator

**Version:** 2.4.170  
**Production:** https://salesleadgenerator.vercel.app

Sales Lead Generator is a Next.js sales intelligence app for managing sports organization leads across multiple brands on a kanban board. It supports lead discovery, enrichment, ICE scoring, outreach, and operator feedback learning.

---

## What This Repo Contains

- Next.js 16 app with API routes
- Mobile-first kanban board, table view, metrics dashboard, and search-learning panel
- Backlog board (`view=backlog`) for leads parked outside the main kanban flow
- Add Lead modal for manually creating leads (shares its contact editor with the detail-page edit form)
- Duplicate-lead review queue and merge UI (`/admin/duplicates`) — fuzzy near-duplicate detection with a conflict-resolution merge flow
- Lead detail actions and outreach compose flow
- Outreach template management UI
- Company Setup / Sales Settings page (`/salessettings/[client]`) — a plain-language questionnaire on what a brand sells, who buys it, and how, so the research agent can refine forecasts
- Research agent integration via OpenClaw cron
- MongoDB Atlas persistence with brand-aware collections

---

## Quick Start

```bash
npm install
npm run dev
```

Type check without building:

```bash
npx tsc --noEmit
```

Lint:

```bash
npm run lint
```

Run tests (required before any change ships, per `CLAUDE.md`'s quality gate):

```bash
npx vitest run
npm run test:integration
npm run test:smoke
npm run audit:gds-style
```

Deploy to Vercel:

```bash
vercel deploy --prod
```

Environment variables (all read via `process.env.*` in `app/` and `lib/` — see `docs/STACK_AND_DEPENDENCIES.md` for details):

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | Yes | Database connection |
| `SLG_API_KEY` | Yes | `x-api-key` auth for API clients (research agent, scripts) |
| `CRON_SECRET` | Yes | Auth for scheduled/cron-triggered admin routes |
| `CONTACT_STALENESS_THRESHOLD_DAYS` | No | Days before a contact is flagged stale (has a code default) |
| `SSO_BASE_URL` | For SSO | SSO provider base URL |
| `SSO_CLIENT_ID` | For SSO | SSO OAuth client ID |
| `SSO_CLIENT_SECRET` | For SSO | SSO OAuth client secret |
| `SSO_REDIRECT_URI` | For SSO | SSO OAuth callback URL |
| `SSO_SUPER_ADMIN_EMAILS` | For SSO | Comma-separated emails granted super-admin access |

---

## Versioning

Current app version is **2.4.170**. `package.json` remains the single source of truth per the line below — this line has drifted before (once to a stale `2.4.29`, corrected 2026-07-25) and needs updating on every version-stamp sync pass, not just when someone notices.

Single source of truth: `package.json`

All docs and release notes should reference this version until the next intentional bump.

---

## Documentation

This README is the single source of truth for documentation paths and descriptions. All other docs should link back here rather than duplicating this index.

### Primary Documentation

| Path | Description |
|------|-------------|
| `README.md` | Onboarding, quick start, and documentation index |
| `CLAUDE.md` | Mandatory operating rules for any AI coding assistant working in this repo (quality gate, issue-driven workflow, DoD, branch/push authorization) |
| `CHANGELOG.md` | Version history, shipped features, and known limitations |
| `roadmap.md` | Every real open GitHub issue, grouped by status — the standing substitute for a GitHub Projects board, which this session's tooling cannot reach (see `CLAUDE.md` Rule 2.5) |
| `docs/ISSUE_MANAGEMENT.md` | Canonical, detailed reference for how issues are created/labeled/sequenced, exactly which tools access GitHub, and the verified boundary of what a session can and can't reach (the project-board question in full) — read this before managing issues here |
| `docs/LESSONS_LEARNED.md` | Recurring mistake patterns, sandbox/verification limitations, and the "why" behind key architectural decisions |
| `docs/LEAD_ENRICHMENT_GUIDE.md` | Structured catalog of every enrichable lead field plus a ready-to-use AI research-agent prompt for ongoing lead enrichment |
| `docs/LEAD_TAXONOMY_MIGRATION_PLAN.md` | Plan for converting existing leads into the controlled sports-industry taxonomy schema (rulebook v1.0, 2.4.109) — now also the execution log for the in-progress backfill (issue #132) |

### Detailed Documentation

| Path | Description |
|------|-------------|
| `docs/ARCHITECTURE.md` | System overview, request flows, data flow, module map, and deployment diagram |
| `docs/OPERATOR_GUIDE.md` | Daily workflow, filters, outreach, known issues, and admin usage |
| `docs/STACK_AND_DEPENDENCIES.md` | Runtime, framework, UI, DB, hosting, agent/runtime stack |
| `docs/INDEX.md` | Documentation index |
| `docs/DOC_LINT.md` | Doc lint checklist for maintaining documentation quality |

### Archived Documentation

| Path | Description |
|------|-------------|
| `_archived/BUILD_STATUS.md` | Historical build status |
| `_archived/STACK_DECISION.md` | Historical stack decision |
| `_archived/architecture.md` | Historical architecture doc |
| `_archived/user-guide.md` | Historical user guide |
| `_archived/PIPELINE_ARCHITECTURE.md` | Historical pipeline architecture doc (superseded by `docs/ARCHITECTURE.md`) |
| `_archived/PROPOSAL.md` | Historical improvement proposal (superseded by `CHANGELOG.md`) |
| `_archived/roadmap.md` | Historical roadmap (superseded by `CHANGELOG.md`) |
| `_archived/deployment.md` | Historical deployment log (superseded by `CHANGELOG.md`) |

---

## API Overview

`/api/health` and `/api/lead-taxonomy` (added 2.4.111, serves the controlled sports-industry taxonomy vocabularies) are the only fully public endpoints — both serve non-sensitive, non-lead metadata. Every lead endpoint (listings included) requires either an `x-api-key` header or an authenticated browser session with access to the requested `brand` (issue #104) — there is no unauthenticated read path there. One exception within the lead endpoints: `PUT /api/leads/[id]` (the research agent's enrichment path) accepts `x-api-key` only, not a session — see `docs/OPERATOR_GUIDE.md`'s Auth section.

Key endpoints:
- `GET /api/leads?brand=<brand>` — list leads (page-based by default; cursor pagination via `?cursor=`)
- `GET /api/leads/columns?brand=<brand>&column=<col>` — cursor-paginated per-column kanban loading, ICE-score sorted for DISCOVERED/QUALIFIED
- `POST /api/leads?brand=<brand>` — create lead
- `PUT /api/leads/[id]?brand=<brand>` — update lead fields (enrichment, `x-api-key` only)
- `PATCH /api/leads?brand=<brand>&id=<id>` — action lead
- `GET /api/search?q=<query>&brand=<brand>` — predictive lead search
- `GET /api/health` — service health (no auth required)
- `GET /api/lead-taxonomy` — controlled sports-industry taxonomy vocabularies (no auth required)
- `GET /api/admin/cron-status` — cron observability
- `GET /api/outreach-templates?mode=analytics` — outreach analytics

See `docs/OPERATOR_GUIDE.md` for workflow guidance and API examples.

---

## License
