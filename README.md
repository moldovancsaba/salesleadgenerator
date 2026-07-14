# CogMap Pipeline

**AI-powered sales intelligence for sports franchises, clubs, and federations.**

CogMap is a cognitive assessment service that measures decision-making speed, situational awareness, and working memory under pressure. This repository contains the CogMap lead generation pipeline — an automated research system that discovers, enriches, and scores sales leads.

- **Live kanban board:** https://cog-map-ten.vercel.app
- **API:** `https://cog-map-ten.vercel.app/api/leads`
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
| `MONGODB_URI` | MongoDB Atlas connection string (`cogmap` database) |

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

1. Selects a region (US, CEE, MENA — rotates each run)
2. Searches for 3–5 real sports organizations
3. Researches decision makers, contacts, pros/cons, value propositions
4. Calculates ICE score and kanban column
5. POSTs to `/api/leads` with deduplication fingerprint
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
| **Scheduling** | OpenClaw cron (every 2 hours) |

---

## Project Structure

```
cogmap-webapp/
├── app/
│   ├── api/
│   │   ├── leads/
│   │   │   ├── route.ts          # GET/POST leads
│   │   │   └── [id]/route.ts     # GET/PATCH/DELETE single lead
│   │   ├── search-learning/
│   │   │   └── route.ts          # Search analytics
│   │   └── health/
│   │       └── route.ts          # Health check
│   ├── components/
│   │   ├── gds-provider.tsx      # Theme provider
│   │   ├── theme-helpers.ts      # Semantic color system
│   │   └── unified-card.tsx      # Shared card component
│   ├── kanban.tsx                # Kanban board (mobile-first)
│   ├── card.tsx                  # Lead card component
│   ├── detail.tsx                # Lead detail modal
│   ├── page.tsx                  # Main pipeline page
│   ├── layout.tsx                # Root layout (PWA meta)
│   ├── types.ts                  # TypeScript types
│   └── constants.ts              # Column definitions
├── lib/
│   └── metrics.ts                # Pipeline metrics
├── models/
│   └── Lead.ts                   # Mongoose schema
├── scripts/
│   └── audit-gds-style.mjs       # Style audit
├── public/
│   ├── manifest.json             # PWA manifest
│   └── icon-192.png              # App icon
├── package.json
├── next.config.js
├── tsconfig.json
└── postcss.config.js
```

---

## API Reference

### `GET /api/leads`

Fetch leads with optional filters.

**Query params:**
| Param | Description |
|-------|-------------|
| `region` | Filter by US, CEE, MENA |
| `kanbanColumn` | Filter by pipeline stage |
| `limit` | Results per page (default 10) |
| `page` | Page number |

**Response:**
```json
{
  "leads": [...],
  "total": 48,
  "page": 1,
  "totalPages": 5
}
```

### `POST /api/leads`

Create a new lead. Automatically calculates ICE score, fingerprint, and kanban column.

**Body:**
```json
{
  "entity_name": "Al Hilal SFC",
  "url": "https://alhilal.com",
  "region": "MENA",
  "sport_or_sector": "Football",
  "size": "Enterprise",
  "decision_maker_name": "John Doe",
  "decision_maker_title": "Performance Director",
  "decision_maker_contact": "john@alhilal.com",
  "contact_phone": "+966500000000",
  "address": "Riyadh, Saudi Arabia",
  "pro_for_cogmap": ["Large squad", "High budget"],
  "con_for_cogmap": ["Competitors already engaged"],
  "value_proposition": "CogMap can measure..."
}
```

### `PATCH /api/leads?id=<leadId>`

Update a lead. Supports actions: `ACCEPT`, `DECLINE`, `PIN`, `MODIFY`, `REQUEST_REFRESH`.

### `GET /api/health`

Health check. Returns MongoDB connection status and lead count.

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
- **Database:** `cogmap`
- **Collection:** `leads`
- **Indexes:** `fingerprint` (unique), `kanbanColumn`, `region`, `iceScore`

---

## Cron Jobs

| Job | Schedule | Purpose |
|-----|----------|---------|
| `2d9f1aa8` | Every 2 hours | Research new sports leads, POST to API |

---

## License

Private — CogMap internal use only.

---

*Last updated: July 14, 2026*  
*Generated by KiloClaw*
