# Sales Lead Generator Pipeline

**AI-powered sales intelligence for sports franchises, clubs, and federations.**

SLG is a sales lead generation platform that discovers, enriches, and scores sales leads across multiple brands and regions. This repository contains the SLG pipeline — an automated research system that finds decision makers, calculates ICE scores, and feeds a kanban board for sales workflow.

- **Live kanban board:** https://salesleadgenerator.vercel.app
- **API:** `https://salesleadgenerator.vercel.app/api/leads?brand=cogmap`
- **App version:** 2.0.0

---

## What This Does

1. **Discovers** sports organizations (clubs, federations, franchises) across US, CEE, and MENA
2. **Enriches** each lead with decision-maker contacts, ICE scores, pros/cons, and value propositions
3. **Scores** leads using the ICE framework (Impact × Confidence × Ease, max 1000)
4. **Feeds** the kanban board where the agent manages DISCOVERED → QUALIFIED, and the user manages QUALIFIED → ENGAGED → PROPOSAL → WON/LOST
5. **Learns** from user feedback (acceptances, declines) to improve future research

---

## Quick Start

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Deploy to Vercel
vercel deploy --prod
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `MONGODB_URI` | MongoDB Atlas connection string (`salesleadgenerator` database) |

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

Runs on a schedule (every 2 hours via OpenClaw cron). For each run:

1. Selects a region/brand and rotates through target markets
2. Searches for 3–5 real organizations
3. Researches decision makers, contacts, pros/cons, value propositions
4. Calculates ICE score and kanban column
5. POSTs to `/api/leads?brand=...` with deduplication fingerprint
6. Promotes to QUALIFIED when criteria are met

### ICE Scoring

**ICE = Impact × Confidence × Ease (max 1000)**

| Dimension | Range | Factors |
|-----------|-------|---------|
| **Impact** | 1–10 | Org size (Enterprise=10, Large=8, Medium=5, Small=3), +2 federation, +1 first-team/elite, +1 S&C dept |
| **Confidence** | 1–10 | Base 5, +1 strong VP, +1 2+ pros, +1 cons, +1 verified email, +1 2+ sources, +1 org confirmed |
| **Ease** | 1–10 | Contact quality: no contact=1, general=2, named w/o details=3, named+address=4, named+email/phone=5, named+address+email/phone=6, all three=7, mobile=8, "I know them"=9, "my connection"=10 |

### Qualification Criteria

A lead moves from DISCOVERED to QUALIFIED when:
- It has a named decision maker with **email + name + title**, OR
- It has a named contact with **name + title + value proposition (>20 chars)**

### Deduplication

Fingerprint = SHA1(`url` + `entity_name` + `region`). Duplicate fingerprints are rejected on insertion.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Next.js 14 (App Router), React 18, Mantine UI 7 |
| **PWA** | Web manifest, standalone mode, touch-optimized |
| **Backend** | Next.js API routes (serverless functions) |
| **Database** | MongoDB Atlas (Mongoose ODM) |
| **Hosting** | Vercel (production + preview deployments) |
| **Research** | OpenClaw agent with web_search + web_fetch |
| **Scheduling** | OpenClaw cron (configurable per brand) |

---

## API Reference

### `GET /api/leads?brand=<brand>`

Public read access.

**Query params:** `brand`, `region`, `kanbanColumn`, `limit`, `page`

**Response:**
```json
{
  "leads": [...],
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

Update lead actions: `ACCEPT`, `DECLINE`, `MODIFY`, `PIN`, `REQUEST_REFRESH`, `COLUMN_MOVE`. Requires API key auth.

### `GET /api/leads/[id]?brand=<brand>`

Fetch a single lead by ID.

### `DELETE /api/leads/[id]?brand=<brand>`

Delete a lead by ID. Requires API key auth.

### `GET /api/health`

Public health check.

```json
{
  "status": "ok",
  "database": "salesleadgenerator",
  "dbLatencyMs": 12,
  "leadCounts": {
    "cogmap": 48,
    "seyu": 12
  },
  "lastError": null,
  "timestamp": "2026-07-17T07:54:00.000Z"
}
```

### `GET /api/admin/cron-status`

Auth required. Returns per-brand cron health.

```json
{
  "status": "healthy",
  "checkedAt": "2026-07-17T07:54:00.000Z",
  "window": "24h",
  "brands": [
    {
      "brand": "cogmap",
      "status": "healthy",
      "lastRun": "2026-07-17T06:00:00.000Z",
      "lastRunAction": "CREATE",
      "lastRunOutcome": "CREATE",
      "runsLast24h": 12,
      "leadsCreatedLast24h": 8,
      "errorsLast24h": 0,
      "errorRate": 0,
      "avgRunsPerHour": 0.5
    }
  ]
}
```

---

## API Key Auth

Write and admin endpoints require the header:

```
x-api-key: <SLG_API_KEY>
```

Set this via Vercel environment variable on the app. Rotate via your secret manager.

### Example curl

```bash
# Read
curl "https://salesleadgenerator.vercel.app/api/leads?brand=cogmap"

# Create
curl -X POST "https://salesleadgenerator.vercel.app/api/leads?brand=cogmap" \
  -H "Content-Type: application/json" \
  -H "x-api-key: $SLG_API_KEY" \
  -d '{"entity_name":"Test FC","url":"https://test.example.com","region":"US"}'

# Admin
curl "https://salesleadgenerator.vercel.app/api/admin/cron-status" \
  -H "x-api-key: $SLG_API_KEY"
```

---

## Mobile UX

The kanban board is built mobile-first:

- **Horizontal scroll** between columns with native scroll-snap
- **Vertical scroll** within each column for overflow cards
- **Tap card** → opens detail modal with full info
- **Long-press + drag** → move card to another column
- **Filters** behind a toggle button (not always visible)
- **PWA** — installable, standalone mode, no browser chrome

---

## Database

- **MongoDB Atlas** cluster: `sales.8wytusk.mongodb.net`
- **Database:** `salesleadgenerator`
- **Collections:** `leads`, `seyu_leads`, `outcomelogs`, `searchlearnings`
- **Indexes:** `fingerprint`, `kanbanColumn`, `region`, `iceScore`

---

## Cron Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| Research agent | Configurable per brand | Research new leads and POST to API |
| Admin visibility | `/api/admin/cron-status` | Observe last 24h/7d run health |

---

## Observability

- `/api/health` returns `dbLatencyMs`, `leadCounts`, and `lastError`
- `/api/admin/cron-status` returns per-brand run counts, error rates, and lead creation counts
- Outcome logs record every mutation for audit/learning

---

## License
