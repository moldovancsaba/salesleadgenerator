# Architecture — Sales Lead Generator

**Version:** 2.1.0

---

## System Context

```
┌─────────────────────────────────────────────────────┐
│                     Frontend                         │
│  /sales/[brand]  /outreach/templates  detail modal  │
└───────────────────────┬─────────────────────────────┘
                        │ HTTPS
                        ▼
┌─────────────────────────────────────────────────────┐
│                   API Routes                         │
│  /api/leads  /api/health  /api/admin/*  outreach*   │
└───────────────────────┬─────────────────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
┌──────────────┐ ┌──────────────┐ ┌───────────────────┐
│   MongoDB    │ │  Outcome +   │ │  Research Agent   │
│   Atlas      │ │  Outreach    │ │  OpenClaw cron    │
│              │ │  Logs        │ │                   │\�──────────────┘ └──────────────┘ └───────────────────┘
```

---

## Frontend

- `/sales/[brand]` — pipeline page with kanban and table view
- `/outreach/templates` — template management UI
- Detail modal — lead actions, outreach compose, feedback

### Key client behavior
- Fetches all pages from `GET /api/leads?brand=<brand>` and normalizes locally
- Uses `handleAction` for mutations: ACCEPT, DECLINE, PIN, REQUEST_REFRESH, COLUMN_MOVE, DELETE
- Uses `handleMove` for drag-to-column moves
- Shows Mantine notifications for success/failure
- Filters by country and search text client-side
- Sort state is kept in page state and passed into kanban and table view
- Detail modal is full-screen on mobile via `matchMedia`

---

## API Layer

### Leads
- `GET /api/leads?brand=<brand>` — list leads with pagination, region/column filters, tenant-aware queries, UI dedup by fingerprint
- `POST /api/leads?brand=<brand>` — create lead with normalization, dedup, quality gate, ICE scoring, and outcome logging
- `PATCH /api/leads?brand=<brand>&id=<id>` — action lead via shared `lead-actions` helper
- `GET /api/leads/[id]?brand=<brand>` — fetch single lead
- `DELETE /api/leads/[id]?brand=<brand>` — delete lead
- `PUT /api/leads/[id]?brand=<brand>` — update lead fields for enrichment without requiring action workflow

### Health and Observability
- `GET /api/health` — database connectivity, latency, brand counts, last error
- `GET /api/admin/cron-status` — cron observability
- `GET /api/admin/data-hygiene` — malformed lead counts by brand
- `GET /api/stats` — totals and breakdowns by column and region
- `GET /api/boards` — available brand boards and config

### Outreach
- `GET /api/outreach-templates?mode=analytics` — template analytics
- `POST /api/outreach-templates` — create template
- `GET /api/outreach-logs` — outreach activity logs
- `POST /api/outreach-logs` — create outreach log with routing enforcement

### Learning
- `GET /api/search-learning` — search memory and success metrics
- `POST /api/search-learning` — update search memory from operator feedback
- `GET /api/search?q=<query>` — full-text search across leads

---

## Data Model

### Lead
Stored in brand-aware collections:
- `leads` for `cogmap`
- `seyu_leads` for `seyu`

Canonical contact storage is `contacts[]`. Top-level contact fields are merged into `contacts[]` on write and cleared from responses where possible.

Key fields:
- `entity_name`, `url`, `region`, `country`
- `contacts[]` with `name`, `title`, `email`, `phone`, `linkedin`, `role`
- Brand-aware pros/cons: `pro_for_cogmap`, `con_for_cogmap`, `pro_for_seyu`, `con_for_seyu`
- `kanbanColumn`, `sortOrder`
- `fingerprint` — SHA1 of `url + entity_name + region`
- `ice.impact`, `ice.confidence`, `ice.ease`
- `scoreProfile` — blended scoring dimensions
- `tenantId` — optional tenant scoping
- `feedbackScore`, `declineCount`, `acceptanceCount`
- `manualLaneOverrideAt`, `manualLaneCooldownUntil`, `manualLaneFloorColumn`

Indexes:
- `fingerprint`
- `kanbanColumn`, `sortOrder`
- `region`, `kanbanColumn`
- Text index on `entity_name`, `industry`, `sport_or_sector`

### Outcome Log
Collection: `outcomelogs`

Records mutations with before/after state, actor, teaching weight, and tenant.

### Outreach Template and Log
Collections: `outreach_templates`, `outreach_logs`

Templates are organization-agnostic and scoped by `tenantId` and `brand`. Logs enforce channel routing rules at write time.

### Search Learning
Collection: `searchlearnings`

Tracks query success, accepted/declined counts, top terms, and top domains.

---

## Request and Response Flows

### List Leads
1. Frontend calls `GET /api/leads?brand=<brand>&limit=500&page=<n>`
2. Route builds tenant-aware filter; legacy docs without `tenantId` are included for `default`
3. MongoDB query sorts by `kanbanColumn`, `sortOrder`, `createdAt`
4. Response dedups by fingerprint client-side and strips top-level contact fields
5. Frontend normalizes and renders kanban or table view

### Create Lead
1. Frontend or agent calls `POST /api/leads?brand=<brand>`
2. `requireApiKey` enforces auth
3. Request body is validated
4. Contact fields and address are normalized
5. Brand-aware pros/cons are normalized
6. Duplicate detection uses fingerprint match across tenant and legacy docs
7. ICE score is calculated from impact, confidence, and ease
8. Quality gate rejects low-confidence/ease leads without verified contact
9. Lead is inserted with `sortOrder = count * 100`
10. Outcome log records creation

### Action Lead
1. Frontend calls `PATCH /api/leads?brand=<brand>&id=<id>` with action payload
2. `requireApiKey` enforces auth
3. `executeLeadAction` loads lead, validates patch, applies action-specific updates
4. Supported actions: ACCEPT, DECLINE, MODIFY, PIN, REQUEST_REFRESH, COLUMN_MOVE
5. Outcome log records mutation with before/after state
6. Response returns normalized lead

### Update Lead
1. Frontend or agent calls `PUT /api/leads/[id]?brand=<brand>` with field updates
2. `requireApiKey` enforces auth
3. Route updates allowed fields without requiring action workflow
4. Forbidden brand fields are blocked by schema mapper
5. Response returns updated lead

### Outreach
1. Frontend posts to `/api/outreach-logs` with lead context and channel
2. Routing rules evaluate channel eligibility
3. If allowed, log is persisted with routing metadata
4. Analytics endpoint aggregates logs by template and channel

---

## Module and Responsibility Map

### `app/api/*/route.ts`
HTTP handlers for leads, health, outreach, learning, search, stats, and boards.

### `app/lib/*`
- `brand.ts` — brand config and resolver
- `normalize-lead.ts` — lead normalization, warning extraction
- `validate-lead.ts` — request validation for POST/PATCH
- `lead-actions.ts` — canonical mutation logic and outcome logging
- `metrics.ts` — scoring and quality metrics
- `outreach/routing-rules.ts` — channel routing enforcement
- `outreach/default-templates.ts` — default template definitions
- `request-id.ts` — request tracing
- `request-retry.ts` — retry utility for transient failures

### `models/*`
- `Lead.ts` — Mongoose schema, fingerprint helper, indexes
- `OutcomeLog.ts` — outcome log schema
- `SearchLearning.ts` — search learning schema

### `lib/*`
- `mongodb.ts` — MongoDB client promise
- `api-auth.ts` — API key enforcement
- `validate-lead.ts` — shared validation
- `lead-validator.ts` — agent-side validation
- `public-data.ts` — fallback public data
- `quality-registry.ts` — quality ceiling enforcement
- `request-retry.ts` — retry helper

---

## Auth, Middleware, CORS, and Security

### Middleware
- Matches `/api/:path*`
- Sets CORS headers for allowed origins
- Sets security headers: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
- Handles OPTIONS preflight

### API Key Auth
- `requireApiKey` guards write and admin endpoints
- Read endpoints are public
- Key is passed via `x-api-key` header

### Input Validation
- POST and PATCH payloads are validated before processing
- Brand-aware field normalization prevents cross-tenant writes
- Schema mapper/validator blocks forbidden fields

---

## Deployment and Environment

- Vercel production deployment
- `MONGODB_URI` is required for database access
- Type checking via `tsc --noEmit` recommended in memory-limited environments
- Health and stats endpoints provide runtime observability

---

## Tenant Isolation

- Each brand maps to its own MongoDB collection
- `tenantId` scopes queries; default includes legacy docs without `tenantId`
- Brand-aware pros/cons fields prevent cross-brand writes
- Outreach templates and logs are tenant-scoped
