# Sales Lead Generator

**Version:** 2.2.2  
**Production:** https://salesleadgenerator.vercel.app

Sales Lead Generator is a Next.js sales intelligence app for managing sports organization leads across multiple brands on a kanban board. It supports lead discovery, enrichment, ICE scoring, outreach, and operator feedback learning.

---

## What This Repo Contains

- Next.js 15 app with API routes
- Mobile-first kanban board and table view
- Lead detail actions and outreach compose flow
- Outreach template management UI
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

Deploy to Vercel:

```bash
vercel deploy --prod
```

Required environment variable: `MONGODB_URI`

---

## Versioning

Current app version is **2.2.2**.

Single source of truth: `package.json`

All docs and release notes should reference this version until the next intentional bump.

---

## Documentation

This README is the single source of truth for documentation paths and descriptions. All other docs should link back here rather than duplicating this index.

### Primary Documentation

| Path | Description |
|------|-------------|
| `README.md` | Onboarding, quick start, and documentation index |
| `CLAUDE.md` | Mandatory operating rules for any Claude session working in this repo (quality gate, issue-driven workflow, DoD, branch/push authorization) |
| `CHANGELOG.md` | Version history, shipped features, and known limitations |
| `PIPELINE_ARCHITECTURE.md` | Pipeline stages, ICE scoring, dedup, and research agent behavior |
| `PROPOSAL.md` | Improvement proposal with completed and remaining workstreams |
| `roadmap.md` | Phased roadmap with shipped, in-progress, and planned items |

### Detailed Documentation

| Path | Description |
|------|-------------|
| `docs/ARCHITECTURE.md` | System overview, request flows, data flow, module map, and deployment diagram |
| `docs/OPERATOR_GUIDE.md` | Daily workflow, filters, outreach, known issues, and admin usage |
| `docs/STACK_AND_DEPENDENCIES.md` | Runtime, framework, UI, DB, hosting, agent/runtime stack |
| `docs/INDEX.md` | Documentation index |
| `docs/DOC_LINT.md` | Doc lint checklist for maintaining documentation quality |
| `deployment.md` | Deployment log — recent commits, build status, files changed |

### Archived Documentation

| Path | Description |
|------|-------------|
| `_archived/BUILD_STATUS.md` | Historical build status |
| `_archived/STACK_DECISION.md` | Historical stack decision |
| `_archived/architecture.md` | Historical architecture doc |
| `_archived/user-guide.md` | Historical user guide |

---

## API Overview

Public read access is available for listings and health. Write and admin endpoints require API key auth.

Key endpoints:
- `GET /api/leads?brand=<brand>` — list leads
- `POST /api/leads?brand=<brand>` — create lead
- `PATCH /api/leads?brand=<brand>&id=<id>` — action lead
- `GET /api/health` — service health
- `GET /api/admin/cron-status` — cron observability
- `GET /api/outreach-templates?mode=analytics` — outreach analytics

See `docs/OPERATOR_GUIDE.md` for workflow guidance and API examples.

---

## License
