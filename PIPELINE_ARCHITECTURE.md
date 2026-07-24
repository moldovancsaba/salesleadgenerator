# Sales Lead Generator Pipeline Architecture

**Version:** 2.4.23

## Overview

SLG is a sales intelligence pipeline. Leads are discovered by an automated research agent, enriched with contact data and ICE scores, and managed on a kanban board.

## Pipeline Stages

```
DISCOVERED → QUALIFIED → ENGAGED → PROPOSAL → WON / LOST
```

| Stage | Managed By | Criteria |
|-------|-----------|---------|
| **DISCOVERED** | Auto (ICE score) | ICE score < 500 |
| **QUALIFIED** | Auto (ICE score) | ICE score ≥ 500 |
| **ENGAGED** | User only | Manual move (drag-and-drop or an action) |
| **PROPOSAL** | User only | Manual move |
| **WON** | User only | Closed deal |
| **LOST** | User only | Declined or no longer viable |

DISCOVERED and QUALIFIED are auto-managed columns (`lib/kanban-column.ts`'s `deriveKanbanColumn`): a lead's placement is derived purely from its ICE score, both at creation (`POST /api/leads`) and whenever the score changes afterward (`PUT /api/leads/[id]`). Once a lead reaches ENGAGED/PROPOSAL/WON/LOST via an explicit user action, it is never auto-reclassified again regardless of later score changes — moving out of the auto-managed pair is a one-way door.

**Sort order also differs by column type.** DISCOVERED and QUALIFIED always sort by computed ICE score, high to low — there is no stored, denormalized sort field for these two; `GET /api/leads/columns` computes the score via a MongoDB aggregation (`ICE_SCORE_AGGREGATION_EXPR`) at read time. ENGAGED, PROPOSAL, WON, and LOST sort by `sortOrder` descending (server assigns `count * 100` on creation; drag-and-drop assigns `Date.now()` on move) — these 4 columns are exclusively user-ordered.

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

Computed by a single shared function, `lib/fingerprint.ts`, used by `POST /api/leads` (dedup-on-write) and by `GET /api/leads`/`GET /api/search`'s response-time dedup (collapsing duplicate-fingerprint documents to the newest one).

The API enforces duplicate prevention with `findOne` + 409 responses. The schema defines an index on `fingerprint`, not a unique constraint.

## Research Agent

- **Schedule:** Configurable via OpenClaw cron
- **Scope:** Depends on configured brand pipeline
- **Output:** Leads POSTed to `/api/leads?brand=...` with `ice: { impact, confidence, ease }`
- **Qualification:** Not an agent judgment call — `kanbanColumn` is derived server-side purely from the resulting ICE score (see "Pipeline Stages" above); the agent's research quality feeds into the score, but doesn't decide placement directly
- **Learning:** Agent reads kanban feedback to improve search queries

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/leads?brand=<brand>` | List leads — legacy `page`/`limit` pagination by default, opt-in cursor pagination via `?cursor=` (`hasMore`/`nextCursor`) |
| POST | `/api/leads?brand=<brand>` | Create lead with normalization, dedup, quality gate, ICE scoring |
| PATCH | `/api/leads?brand=<brand>&id=<id>` | Action lead (ACCEPT, DECLINE, PIN, REQUEST_REFRESH, MODIFY, COLUMN_MOVE) |
| GET | `/api/leads/[id]?brand=<brand>` | Fetch single lead |
| PUT | `/api/leads/[id]?brand=<brand>` | Update lead fields for enrichment; auto-reclassifies `kanbanColumn` on `ice` change while still in an auto-managed column |
| DELETE | `/api/leads/[id]?brand=<brand>` | Delete lead |
| GET | `/api/leads/columns?brand=<brand>&column=<col>` | Cursor-paginated per-column kanban loading; ICE-score sorted for DISCOVERED/QUALIFIED, `sortOrder` sorted for the other 4 |
| GET | `/api/search?q=<query>&brand=<brand>` | Predictive lead search, deduped by fingerprint; cursor pagination when a specific `brand` is given |
| GET | `/api/boards` | Available brand boards and config |
| GET | `/api/boards/[brand]?tenantId=<id>` | Board metadata: counts, region breakdown, pipeline-weighted forecast |
| GET | `/api/metrics?brand=<brand>&tenantId=<id>` | Per-column and per-region lead counts |
| GET | `/api/settings` | Pipeline-weight settings used by forecast calculations |
| GET | `/api/forecast/export?format=csv\|json` | CogMap revenue forecast export |
| GET | `/api/health` | Health check |
| GET | `/api/admin/cron-status` | Cron observability |
| GET | `/api/admin/data-hygiene` | Malformed lead counts by brand |
| GET/POST | `/api/outreach-templates` | Template CRUD and analytics |
| GET | `/api/outreach-logs` | Outreach activity logs |
| GET/POST | `/api/outcome-logs` | Outcome logs for feedback learning |
| GET/POST | `/api/search-learning` | Search memory and success metrics |

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
  pro_for_organization: string[]  // generic since 2.3.0 — shared across every brand, not brand-specific
  con_for_organization: string[]
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

There is no Mongoose schema for this shape — `models/Lead.ts` (and `OutcomeLog.ts`/`SearchLearning.ts`) were deleted in 2.4.7 after being confirmed unused (zero importers, drifted from reality). All reads/writes go through the raw `mongodb` driver (`lib/mongodb.ts`); this typescript block is a plain reference shape, not a live schema definition.

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

- **Framework:** Next.js 15 (App Router)
- **UI:** Mantine 7, plus a private GDS component library for admin surfaces (`@sovereignsquad/gds-admin`/`gds-core`)
- **PWA:** Web app manifest, standalone display, touch-optimized
- **Board:** Horizontal scroll between columns, vertical scroll within columns
- **Cards:** Compact (`ProductCard`) — entity name, ICE score, ticket size, region, contact — tap for full detail modal
- **Drag:** Long-press + pointer events for cross-column moves
- **Filters:** None currently — the Region/Status filter dropdowns were removed entirely in 2.4.0. The header has only the view-mode selector (Kanban/Table/Metrics/Search Learning) and a predictive search bar; there is no region/country/tenantId filter UI in the current frontend

## Observability

- `/api/health` returns `status`, `database`, `dbLatencyMs`, `leadCounts`, `lastError`, and `timestamp`
- `/api/admin/cron-status` returns per-brand run counts, error rates, and lead creation counts
- `/api/admin/data-hygiene` returns malformed lead counts by brand

- `/api/outreach-templates?mode=analytics` returns template usage stats
- Outcome logs record every mutation for audit/learning

## Security

- Public read access for lead listings and health checks
- Write and admin endpoints require API key auth via `x-api-key` — when `SLG_API_KEY` is set, a request missing the header is rejected (401) the same as one with a wrong value; when `SLG_API_KEY` is unset entirely, requests are allowed through (documented fail-open behavior for local/dev use)
- Input validation enforced before database writes, including partial updates (`PUT`)
- CORS restricted to configured origins via `middleware.ts`
- Security headers set in middleware: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`

## Hosting

| Component | URL |
|-----------|-----|
| Production app | https://salesleadgenerator.vercel.app |
| API health | https://salesleadgenerator.vercel.app/api/health |
| Database | MongoDB Atlas |
