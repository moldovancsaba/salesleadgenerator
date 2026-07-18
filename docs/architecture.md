# Architecture — Sales Lead Generator

## System Overview

Sales Lead Generator is a Next.js app + API for managing sports sales leads across multiple brands. It runs on Vercel and stores data in MongoDB Atlas.

```
┌─────────────┐     ┌───────────────┐     ┌────────────────────┐
│  Frontend   │────▶│  API Routes   │────▶│  MongoDB Atlas     │
│ /sales/[brand]│   │  /api/leads   │     │  leads / seyu_leads │
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
- `/outreach/templates` for template management
- Kanban board: horizontal columns, vertical card scroll
- Table view toggle
- Detail modal for lead actions and outreach compose

## API Layer

- `/api/leads` → list + create leads
- `/api/leads/[id]` → get + delete lead
- `/api/leads` `PATCH` → canonical action endpoint
- `/api/health` → readiness + DB latency + counts
- `/api/admin/cron-status` → observability for automated runs
- `/api/admin/data-hygiene` → malformed lead counts by brand
- `/api/stats` → lead counts by brand, kanban column, and region
- `/api/search` → search/suggest
- `/api/search-learning` → search analytics
- `/api/boards` → brand/board config
- `/api/outreach-templates` → template CRUD + analytics
- `/api/outreach-logs` → outreach activity logs with routing enforcement
- `/api/outcome-logs` → outcome logs for feedback learning

Auth is enforced on write/admin endpoints via `requireApiKey`.

## Data Model

- Brand-aware collections: `leads` and `seyu_leads`
- Tenant-aware filtering via optional `tenantId`
- Backward compatibility: default queries include legacy docs with missing `tenantId`
- Fingerprint dedup: SHA1 of `url` + `entity_name` + `region`
- Outcome logs in `outcomelogs`

## Observability

- Health endpoint: `status`, `database`, `dbLatencyMs`, `leadCounts`, `lastError`, `timestamp`
- Admin cron status: per-brand run stats, error rate, leads created
- Admin data hygiene: malformed lead counts by brand
- Stats endpoint: lead totals and breakdowns by kanban column and region
- Outreach template analytics via `?mode=analytics`

## Deployment

- Vercel production deployment
- MongoDB Atlas for persistence
- TypeScript verified via `tsc --noEmit` due to local memory limits
