# Sales Lead Generator

**Version:** 2.1.0  
**Production:** https://salesleadgenerator.vercel.app

Sales Lead Generator is a Next.js sales intelligence app for managing sports organization leads across multiple brands on a kanban board. It supports lead discovery, enrichment, ICE scoring, outreach, and operator feedback learning.

---

## What This Repo Contains

- Next.js 14 app with API routes
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

Deploy to Vercel:

```bash
vercel deploy --prod
```

Required environment variable: `MONGODB_URI`

---

## Versioning

Current app version is **2.1.0**.

Single source of truth: `package.json`

All docs and release notes should reference this version until the next intentional bump.

---

## Docs

- `docs/ARCHITECTURE.md` — system overview, request flows, data flow, module map, and deployment diagram
- `docs/OPERATOR_GUIDE.md` — daily workflow, filters, outreach, known issues, and admin usage
- `CHANGELOG.md` — version history, shipped features, and known limitations
- `documentationtasks.md` — documentation backlog and deliverables

---

## Docs

- `docs/ARCHITECTURE.md` — system overview, request flows, data flow, module map, and deployment diagram
- `docs/OPERATOR_GUIDE.md` — daily workflow, filters, outreach, known issues, and admin usage
- `CHANGELOG.md` — version history, shipped features, and known limitations
- `PIPELINE_ARCHITECTURE.md` — pipeline stages, ICE scoring, dedup, and research agent behavior
- `PROPOSAL.md` — improvement proposal with shipped/remaining workstreams
- `roadmap.md` — phased roadmap and milestones
- `documentationtasks.md` — documentation backlog and deliverables

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
