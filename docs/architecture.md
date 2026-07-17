# Architecture — Sales Lead Generator

## System Overview

Sales Lead Generator is a Next.js app + API for managing sports sales leads across multiple brands. It runs on Vercel and stores data in MongoDB Atlas.

```
┌─────────────┐     ┌───────────────┐     ┌────────────────────┐
│  Frontend   │────▶│  API Routes   │────▶│  MongoDB Atlas     │
│  /sales/[brand]│   │  /api/leads   │     │  leads / seyu_leads │
└─────────────┘     └───────────────┘     └────────────────────┘
                             │
                             ▼
                   ┌───────────────────┐
                   │  Research Agent   │
                   │  OpenClaw cron    │
                   └───────────────────┘
```

## Frontend

- Next.js 14 App Router page at `/sales/[brand]`
- Kanban board: horizontal columns, vertical card scroll
- Table view toggle
- Detail modal for lead actions

## API Layer

- `/api/leads` → list + create leads
- `/api/leads/[id]` → get + update + delete lead
- `/api/health` → readiness + DB latency + counts
- `/api/admin/cron-status` → observability for automated runs
- `/api/search-learning` → search memory/feedback
- `/api/outcome-logs` → outcome tracking
- `/api/outreach-templates` → list + create templates, analytics mode
- `/api/outreach-logs` → outreach activity logs

Auth is enforced on write/admin endpoints via `requireApiKey`.

## Data Model

- Brand-aware collections: `leads` and `seyu_leads`
- Fingerprint dedup: SHA1 of url + entity_name + region
- Outcome logs in `outcomelogs`

## Observability

- Health endpoint: `status`, `dbLatencyMs`, `leadCounts`, `lastError`
- Admin cron status: per-brand run stats, error rate, leads created

## Deployment

- Vercel production deployment
- MongoDB Atlas for persistence
