# Sales Lead Generator Pipeline Architecture

## Overview

SLG is a sales intelligence pipeline. Leads are discovered by an automated research agent, enriched with contact data and ICE scores, and managed on a kanban board.

## Pipeline Stages

```
DISCOVERED → QUALIFIED → ENGAGED → PROPOSAL → WON / LOST
```

| Stage | Managed By | Criteria |
|-------|-----------|---------|
| **DISCOVERED** | Agent | Newly discovered, awaiting enrichment |
| **QUALIFIED** | Agent | Has decision maker email (name + title + email) OR name + title + value proposition (>20 chars) |
| **ENGAGED** | User only | Manual move |
| **PROPOSAL** | User only | Manual move |
| **WON** | User only | Closed deal |
| **LOST** | User only | Declined or no longer viable |

**Cards within each column are sorted by `sortOrder` ascending (server assigns `count * 100` on creation; frontend drag assigns incrementing integers).** ICE score is not used for display ordering.

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

The API enforces duplicate prevention with `findOne` + 409 responses. The schema defines an index on `fingerprint`, not a unique constraint.

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
| PATCH | `/api/leads?brand=<brand>&id=<id>` | Update lead/actions |
| GET | `/api/leads/[id]?brand=<brand>` | Fetch single lead |
| DELETE | `/api/leads/[id]?brand=<brand>` | Delete lead |
| GET | `/api/health` | Health check |
| GET | `/api/admin/cron-status` | Cron observability |
| GET | `/api/admin/data-hygiene` | Malformed lead counts by brand |
| GET/POST | `/api/outreach-templates` | Template CRUD and analytics |
| GET | `/api/outreach-logs` | Outreach activity logs |
| GET/POST | `/api/outcome-logs` | Outcome logs for feedback learning |

## Database Schema

### Lead Model

```typescript
{
  entity_name: string
  url: string
  region: 'US' | 'CEE' | 'MENA'
  country?: string
  industry: string
  sport_or_sector: string
  size: 'Small' | 'Medium' | 'Large' | 'Enterprise'
  address: string
  general_contact: string
  contact_phone: string
  decision_maker_name: string
  decision_maker_title: string
  decision_maker_contact: string
  contacts: Array<{ name, title, email, phone, linkedin }>
  pro_for_cogmap: string[]
  con_for_cogmap: string[]
  pro_for_seyu: string[]
  con_for_seyu: string[]
  value_proposition: string
  ice: { impact: number, confidence: number, ease: number }
  fingerprint: string (SHA1, indexed)
  kanbanColumn: 'DISCOVERED' | 'QUALIFIED' | 'ENGAGED' | 'PROPOSAL' | 'WON' | 'LOST'
  sortOrder: number
  priority: 'high' | 'medium' | 'low'
  status: string
  qualityStatus?: 'DRAFT' | 'CHECKED' | 'VERIFIED'
  feedbackScore: number
  declineCount: number
  acceptanceCount: number
  declineReason?: string
  declinedAt?: string
  tags: string[]
  notes: string
  tenantId?: string
  createdAt: string
  updatedAt: string
}
```

### Outcome Log Model

```typescript
{
  leadId: string
  companyId: string
  action: string
  outcomeType: string
  outcomeValue: string
  annotation: string
  teachingWeight: number
  beforeState: object
  afterState: object
  actorType: string
  actedBy: string
  createdAt: string
  tenantId?: string
}
```

## Frontend

- **Framework:** Next.js 14 (App Router)
- **UI:** Mantine 7
- **PWA:** Web app manifest, standalone display, touch-optimized
- **Board:** Horizontal scroll between columns, vertical scroll within columns
- **Cards:** Minimal (name + ICE + region), tap for detail modal
- **Drag:** Long-press + pointer events for cross-column moves
- **Filters:** Collapsible (region chips + search + tenantId)

## Observability

- `/api/health` returns `status`, `database`, `dbLatencyMs`, `leadCounts`, `lastError`, and `timestamp`
- `/api/admin/cron-status` returns per-brand run counts, error rates, and lead creation counts
- `/api/admin/data-hygiene` returns malformed lead counts by brand

- `/api/outreach-templates?mode=analytics` returns template usage stats
- Outcome logs record every mutation for audit/learning

## Security

- Public read access for lead listings and health checks
- Write and admin endpoints require API key auth via `x-api-key`
- Input validation enforced before database writes
- CORS restricted to configured origins via `middleware.ts`
- Security headers set in middleware: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`

## Hosting

| Component | URL |
|-----------|-----|
| Production app | https://salesleadgenerator.vercel.app |
| API health | https://salesleadgenerator.vercel.app/api/health |
| Database | MongoDB Atlas |
