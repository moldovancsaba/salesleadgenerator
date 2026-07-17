# README — Sales Lead Generator

**AI-powered sales intelligence for sports franchises, clubs, and federations.**

- **Live kanban board:** https://salesleadgenerator.vercel.app
- **App version:** 2.1.0

---

## What This Does

1. **Discovers** sports organizations (clubs, federations, franchises) across US, CEE, and MENA.
2. **Enriches** each lead with decision-maker contacts, ICE scores, pros/cons, and value propositions.
3. **Scores** leads using ICE = Impact × Confidence × Ease (max 1000).
4. **Feeds** the kanban board where the agent manages DISCOVERED → QUALIFIED, and the user manages QUALIFIED → ENGAGED → PROPOSAL → WON/LOST.
5. **Learns** from user feedback (acceptances, declines) to improve future research.
6. **Outreach** — organization-agnostic templates with channel rules, compose modal, and usage analytics.
7. **Multi-brand** — works for any number of organizations via dynamic `brand` scoping.

---

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Type check only (build may OOM in limited environments)
npx tsc --noEmit

# Deploy to Vercel
vercel deploy --prod
```

---

## Architecture

### Pipeline Flow

```
DISCOVERED → QUALIFIED → ENGAGED → PROPOSAL → WON / LOST
     ↑            ↑
  Agent       Agent (only when criteria met)

  User manages: QUALIFIED → ENGAGED → PROPOSAL → WON / LOST
```

### Research Agent

Runs on a schedule via OpenClaw cron. For each run:

1. Selects a region/brand and rotates through target markets.
2. Searches for 3–5 real organizations.
3. Researches decision makers, contacts, pros/cons, value propositions.
4. Calculates ICE score and kanban column.
5. POSTs to `/api/leads?brand=...` with deduplication fingerprint.
6. Promotes to QUALIFIED when criteria are met.

### Frontend

- `/sales/[brand]` — pipeline kanban board + table view.
- `/detail` route or card modal — lead details and actions.
- `/outreach/templates` — template management UI.

### Backend

- `/api/leads` — list + create.
- `/api/leads/[id]` — get + delete.
- `/api/leads` `PATCH` — canonical action path: ACCEPT, DECLINE, MODIFY, PIN, REQUEST_REFRESH, COLUMN_MOVE.
- `/api/health` — readiness, DB latency, counts, last error.
- `/api/admin/cron-status` — observability for automated runs.
- `/api/outreach-templates` — list/create templates; analytics via `?mode=analytics`.
- `/api/outreach-logs` — outreach activity logs with enforced channel routing.

---

## Data Model

### Collections

| Collection | Purpose |
|-----------|---------|
| `leads` | CogMap leads |
| `seyu_leads` | Seyu leads |
| `outcomelogs` | mutation/action audit trail |
| `outreach_templates` | outreach templates |
| `outreach_logs` | outreach activity logs |

### Fields

- **Brand-aware fields** for pros/cons: `pro_for_cogmap`, `con_for_cogmap`, `pro_for_seyu`, `con_for_seyu`.
- **Tenant scoping:** optional `tenantId`. Default queries include legacy docs with missing `tenantId`.
- **Fingerprint dedup:** SHA1 of `url` + `entity_name` + `region`.

---

## Multi-Brand / Multi-Organization Behavior

- The pipeline URL pattern is `/sales/[brand]`.
- Each brand maps to its own collection via `BRAND_CONFIG`.
- Outreach templates are organization-agnostic and scoped at runtime by `brand`.
- Existing leads without `tenantId` are still visible for the default tenant path.

---

## Outreach

- Compose outreach from lead detail view.
- Supported channels: email and LinkedIn.
- Server-side routing rules persist the selected channel in outreach logs.
- Template analytics are available through `/api/outreach-templates?mode=analytics`.

---

## API Reference

### `GET /api/leads?brand=<brand>`

Public read access.

**Query params:** `brand`, `tenantId`, `region`, `kanbanColumn`, `limit`, `page`

**Response:**
```json
{
  "leads": [...],
  "brand": "cogmap",
  "tenantId": "default",
  "total": 48,
  "page": 1,
  "totalPages": 5
}
```

### `POST /api/leads?brand=<brand>`

Create lead. Requires API key auth.

**Body:**
```json
{
  "entity_name": "Example Club",
  "url": "https://example.com",
  "region": "US",
  "sport_or_sector": "Soccer",
  "size": "Medium",
  "decision_maker_name": "Jordan Smith",
  "decision_maker_title": "Academy Director",
  "decision_maker_contact": "jordan@example.com",
  "contact_phone": "+1 555 0100",
  "address": "New York, NY",
  "value_proposition": "SLG can help...",
  "pro_for_cogmap": ["Benefit 1", "Benefit 2"],
  "con_for_cogmap": ["Objection 1"],
  "kanbanColumn": "QUALIFIED"
}
```

### `PATCH /api/leads?brand=<brand>&id=<id>`

Action a lead. Requires API key auth.

Allowed actions: `ACCEPT`, `DECLINE`, `MODIFY`, `PIN`, `REQUEST_REFRESH`, `COLUMN_MOVE`.

**Response:**
```json
{
  "success": true,
  "lead": { ... },
  "requestId": "..."
}
```

### `GET /api/leads/[id]?brand=<brand>`

Fetch a single lead by ID.

### `DELETE /api/leads/[id]?brand=<brand>`

Delete a lead by ID. Requires API key auth.

### `GET /api/health`

Public health check.

```json
{
  "status": "ok",
  "database": "cogmap",
  "dbLatencyMs": 94,
  "leadCounts": {
    "cogmap": 280,
    "seyu": 114
  },
  "lastError": null,
  "timestamp": "..."
}
```

### `GET /api/admin/cron-status`

Auth required. Returns per-brand cron health.

### `GET /api/outreach-templates?mode=analytics`

Auth required. Returns template usage analytics.

---

## API Key Auth

Write and admin endpoints require the header:

```
x-api-key: <key>
```

Set via Vercel environment variable.

### Example curl

```bash
# Read
curl "https://salesleadgenerator.vercel.app/api/leads?brand=cogmap"

# Create
curl -X POST "https://salesleadgenerator.vercel.app/api/leads?brand=cogmap" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ***" \
  -d '{"entity_name":"Test FC","url":"https://test.example.com","region":"US"}'

# Action
curl -X PATCH "https://salesleadgenerator.vercel.app/api/leads?brand=cogmap&id=<id>" \
  -H "Content-Type: application/json" \
  -H "x-api-key: ***" \
  -d '{"action":"ACCEPT"}'

# Admin
curl "https://salesleadgenerator.vercel.app/api/admin/cron-status" \
  -H "x-api-key: ***"
```

---

## Mobile UX

- **Horizontal scroll** between columns with native scroll-snap.
- **Vertical scroll** within each column for overflow cards.
- **Tap card** → opens detail modal with full info.
- **Drag** → move card to another column.
- **Filters** behind a toggle button.
- **PWA** — installable, standalone mode.

---

## Database

- **MongoDB Atlas** cluster.
- **Database:** `cogmap`
- **Collections:** `leads`, `seyu_leads`, `outcomelogs`, `outreach_templates`, `outreach_logs`
- **Indexes:** `fingerprint`, `kanbanColumn`, `region`, `iceScore`, `tenantId`

---

## License
