# Sales Lead Generator Pipeline Architecture

## Overview

SLG is a sales intelligence pipeline. Leads are discovered by an automated research agent, enriched with contact data and ICE scores, and managed on a kanban board.

## Pipeline Stages

```
DISCOVERED → QUALIFIED → ENGAGED → PROPOSAL → WON / LOST
```

| Stage | Managed By | Criteria |
|-------|-----------|----------|
| **DISCOVERED** | Agent | Newly discovered, awaiting enrichment |
| **QUALIFIED** | Agent | Has decision maker email (name + title + email) OR name + title + value proposition (>20 chars) |
| **ENGAGED** | User only | Manual move |
| **PROPOSAL** | User only | Manual move |
| **WON** | User only | Closed deal |
| **LOST** | User only | Declined or no longer viable |

**Cards within each column are sorted by ICE score (highest first).**

## ICE Scoring

```
ICE = Impact × Confidence × Ease
Max: 1000
```

### Impact (organization potential, 1–10)
- Enterprise = 10, Large = 8, Medium = 5, Small = 3
- +2 if federation or national body
- +1 if first-team/elite squad focus
- +1 if has existing performance/S&C department
- Cap: 10

### Confidence (research quality, 1–10)
- Base: 5
- +1 if value proposition > 50 chars
- +1 if 2+ specific pros
- +1 if 1+ cons acknowledged
- +1 if decision maker email verified
- +1 if 2+ reliable sources
- +1 if organization info confirmed
- Cap: 10

### Ease (contact quality, 1–10)
- 1 = no contact
- 2 = general email/phone only (no named person)
- 3 = named contact, no details
- 4 = named contact + address only
- 5 = named contact + email or phone
- 6 = named contact + address + email/phone
- 7 = named contact + address + email + phone
- 8 = phone is mobile
- 9 = "I know them" (user button)
- 10 = "my connection" (user button)

## Deduplication

Fingerprint = SHA1(`url` + `entity_name` + `region`)

Unique index on `fingerprint` prevents duplicate leads.

## Research Agent

- **Schedule:** Configurable via OpenClaw cron
- **Scope:** Depends on configured brand pipeline
- **Output:** Leads POSTed to `/api/leads?brand=...`
- **Qualification:** Agent promotes to QUALIFIED when criteria are met
- **Learning:** Agent reads kanban feedback to improve search queries

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/leads?brand=<brand>` | Fetch leads |
| POST | `/api/leads?brand=<brand>` | Create lead |
| GET | `/api/leads/[id]?brand=<brand>` | Fetch single lead |
| DELETE | `/api/leads/[id]?brand=<brand>` | Delete lead |
| GET | `/api/search-learning` | Search analytics |
| GET | `/api/health` | Health check |

## Database Schema

### Lead Model

```typescript
{
  entity_name: string
  url: string
  region: 'US' | 'CEE' | 'MENA'
  industry: string
  sport_or_sector: string
  size: 'Small' | 'Medium' | 'Large' | 'Enterprise'
  address: string
  general_contact: string
  contact_phone: string
  decision_maker_name: string
  decision_maker_title: string
  decision_maker_contact: string
  pro_for_<brand>: string[]
  con_for_<brand>: string[]
  value_proposition: string
  ice: { impact: number, confidence: number, ease: number }
  iceScore: number
  fingerprint: string (SHA1, unique)
  kanbanColumn: 'DISCOVERED' | 'QUALIFIED' | 'ENGAGED' | 'PROPOSAL' | 'WON' | 'LOST'
  sortOrder: number (for column sorting by ICE)
  priority: 'high' | 'medium' | 'low'
  status: string
  qualityStatus: 'DRAFT' | 'CHECKED' | 'VERIFIED'
  feedbackScore: number
  declineCount: number
  acceptanceCount: number
  declineReason?: string
  declinedAt?: string
  tags: string[]
  notes: string
  createdAt: string
  updatedAt: string
}
```

## Frontend

- **Framework:** Next.js 14 (App Router)
- **UI:** Mantine 7
- **PWA:** Web app manifest, standalone display, touch-optimized
- **Board:** Horizontal scroll between columns, vertical scroll within columns
- **Cards:** Minimal (name + ICE + region), tap for detail modal
- **Drag:** Long-press + pointer events for cross-column moves
- **Filters:** Collapsible (region chips + search)

## Hosting

| Component | URL |
|-----------|-----|
| Production app | https://salesleadgenerator.vercel.app |
| API health | https://salesleadgenerator.vercel.app/api/health |
| Database | MongoDB Atlas |

---

*Last updated: July 16, 2026*
