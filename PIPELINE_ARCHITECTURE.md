# Sales Lead Generator Pipeline Architecture

**Version:** 2.4.59

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
Impact is entirely agent-supplied (`normalizedBody.ice?.impact || normalizedBody.impact || 5` in `POST /api/leads`) — there is no `computeImpact()` in this repo. The scale below is guidance given to the research agent, not a formula implemented in code:
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
| PATCH | `/api/leads?brand=<brand>&id=<id>` | Action lead (ACCEPT, DECLINE, PIN, REQUEST_REFRESH, MODIFY, COLUMN_MOVE, RESCAN_TECH) |
| GET | `/api/leads/[id]?brand=<brand>` | Fetch single lead |
| PUT | `/api/leads/[id]?brand=<brand>` | Update lead fields for enrichment; auto-reclassifies `kanbanColumn` on `ice` change while still in an auto-managed column |
| DELETE | `/api/leads/[id]?brand=<brand>` | Delete lead |
| GET | `/api/leads/columns?brand=<brand>&column=<col>` | Cursor-paginated per-column kanban loading; ICE-score sorted for DISCOVERED/QUALIFIED, `sortOrder` sorted for the other 4 |
| GET | `/api/search?q=<query>&brand=<brand>` | Predictive lead search, deduped by fingerprint; cursor pagination when a specific `brand` is given |
| GET | `/api/boards` | Available brand boards and config |
| GET | `/api/boards/[brand]?tenantId=<id>` | Board metadata: counts, region breakdown, pipeline-weighted forecast (`forecast.concentrationRisk`, `forecast.coverage` — `null` when not applicable/configured) |
| GET | `/api/metrics?brand=<brand>&tenantId=<id>` | Per-column and per-region lead counts, plus `metrics.velocity` (time-in-stage, stage-to-stage conversion, computed from `outcomelogs`; 2.4.42, issue #58) |
| GET | `/api/metrics/decline-reasons?brand=&tenantId=&groupBy=&from=&to=` | Cross-tabbed decline-reason rollup by industry/sport-or-sector/region and date range (2.4.43, issue #63) |
| GET | `/api/settings` | Pipeline-weight settings used by forecast calculations, plus per-column stale-deal day thresholds (`thresholds`, additive as of 2.4.39), concentration-risk `threshold`/`topN` (`concentrationRiskSettings`, additive as of 2.4.45), and forecast-calibration `mode`/`minSampleSize`/`windowDays` (`calibration`, additive as of 2.4.48, issue #56) |
| GET | `/api/win-rates?brand=<brand>&tenantId=<id>` | Cached per-stage WON/LOST win rate, lazily recomputed from `outcomelogs` if the cache is missing or >24h stale (2.4.48, issue #56) |
| GET | `/api/ticket-size-calibration?brand=<brand>&tenantId=<id>` | Cached ticket-size estimate accuracy per size tier/method, lazily recomputed from WON leads' `ticketSizeEstimate` vs. `actualDealValueUsd` if the cache is missing or >24h stale (2.4.57, issue #83) |
| POST | `/api/win-rates/recalculate` | Force an immediate win-rate recompute regardless of cache staleness; `x-api-key` guarded, admin/API-only (no browser UI trigger — see "Win-Rate Calibration" below) (2.4.48, issue #56) |
| GET | `/api/forecast/export?format=csv\|json` | CogMap revenue forecast export |
| GET | `/api/health` | Health check |
| GET | `/api/admin/cron-status` | Cron observability |
| GET | `/api/admin/data-hygiene` | Malformed lead counts by brand |
| POST | `/api/admin/ticket-size-backfill` | Backfill/recompute `ticketSizeEstimate` for every lead in one or all brands; `x-api-key` guarded, defaults to a dry run (2.4.54, issue #81) |
| GET/POST | `/api/admin/ticket-size-recalc` | Weekly recalculation sweep: `ticketSizeEstimate` for every lead in every brand, always applied; `GET` is the Vercel Cron target (`CRON_SECRET` bearer) or admin (`x-api-key`), `POST` is a key-guarded manual re-trigger (2.4.56, issue #82) |
| GET/POST | `/api/admin/forecast-snapshot` | Write a weekly forecast snapshot per brand/tenant; `GET` is the Vercel Cron target (`CRON_SECRET` bearer) or admin (`x-api-key`), `POST` is a key-guarded manual/backfill trigger (2.4.41, issue #57) |
| GET | `/api/admin/forecast-snapshot/history` | Read forecast snapshot history for a brand/tenant/date range (`x-api-key`) — feeds a future trend-chart UI |
| GET/POST | `/api/outreach-templates` | Template CRUD and analytics; `GET` also accepts `tags`/`q` (additive to `industry`/`channel`, graceful zero-match fallback) and a `mode=search` variant for a real Mongo-level tag/content query (2.4.41, issue #64) |
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
  // Decision-maker status is a flag on a contact, not a separate set of
  // top-level fields (decision_maker_name/title/contact, contact_phone —
  // retired in the 2.4.32 hard cutover, issue #45; no longer recognized
  // anywhere, a request that still sends them has those values ignored)
  // lastVerifiedAt (2.4.40, issue #66): per-contact ISO timestamp of last
  // confirmed-accurate verifiable-field data. See docs/ARCHITECTURE.md's
  // "Per-contact freshness" for exactly which write path stamps it and when.
  // emailVerificationStatus (2.4.50, issue #67): MX-based domain-deliverability
  // signal, written back asynchronously after create/update — never a
  // specific-mailbox proof. seniorityTier/department (2.4.50, issue #68):
  // rule-based (not ML), re-derived from `title` on every normalize.
  contacts: Array<{ name, title, email, phone, linkedin, role, isDecisionMaker, lastVerifiedAt?, emailVerificationStatus?, seniorityTier, department }>
  // techSignals (2.4.52, issue #69): top-level, NOT per-contact — describes
  // the company homepage, not a person. Server-computed by an SSRF-guarded
  // background scan (lib/tech-stack-scan.ts); see
  // docs/STACK_AND_DEPENDENCIES.md's "Outbound Requests / SSRF Guard".
  techSignals?: string[]
  techSignalsScannedAt?: string
  techSignalsScanStatus?: 'ok' | 'blocked' | 'timeout' | 'invalid_url' | 'non_html' | 'error'
  // ticketSizeEstimate (2.4.53, issue #79): server-computed, firmographic-
  // tiered deal-size band (lib/ticket-size.ts) — replaces trusting
  // estimated_annual_revenue_usd/pricingByCompany (both kept below, now
  // signals/audit trail only, no longer the authoritative displayed value).
  ticketSizeEstimate?: {
    method: 'tier_band' | 'per_unit' | 'unconfigured'
    computedAt: string
    low?: number
    expected?: number
    high?: number
    currency?: 'USD' | 'EUR'
    confidence?: 'low' | 'medium' | 'high'
  }
  // actualDealValueUsd (2.4.57, issue #83): the real, closed contract value
  // (always USD) once a lead is WON — captured via MODIFY, compared against
  // ticketSizeEstimate.expected by lib/ticket-size-calibration.ts. Undefined
  // means not yet recorded, never a fabricated $0.
  actualDealValueUsd?: number
  pro_for_organization: string[]  // generic since 2.3.0 — shared across every brand, not brand-specific
  con_for_organization: string[]
  value_proposition: string
  ice: { impact: number, confidence: number, ease: number }
  fingerprint: string (SHA1, indexed)
  kanbanColumn: 'DISCOVERED' | 'QUALIFIED' | 'ENGAGED' | 'PROPOSAL' | 'WON' | 'LOST'
  sortOrder: number
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

### Forecast Snapshot Model (2.4.41, issue #57)

```typescript
{
  brand: string
  tenantId: string
  periodKey: string          // ISO week, UTC-anchored, e.g. "2026-W30" — lib/iso-week.ts
  capturedAt: Date
  totalLeads: number
  columnCounts: Record<string, number>
  weightsUsed: Record<string, number>   // pipeline_weights AT capture time — weights are mutable, so the result alone can't be trusted for a trend
  forecast: object           // exact shape GET /api/boards/[brand] returns — app/lib/forecast.ts's computeForecast()
  source: 'vercel-cron' | 'manual' | 'backfill'
  createdAt: Date
}
```

CogMap's revenue aggregations (`pipelineForecast`, `revenueByModel`, `totalRevenue`, `perLeadValues`, all in `computeForecast()`) read a lead's revenue via a shared `REVENUE_EXPR`: `ticketSizeEstimate.expected` when present, else `estimated_annual_revenue_usd`, else 0 (2.4.59, issue #85) — the same fallback `app/constants.ts`'s `getTicketSize()` already uses for the lead-detail UI, so the forecast total and what an operator sees on a lead's own drawer never disagree. Seyu's forecast is unaffected — it's computed entirely from `pricingByCompany`, a separate model `ticketSizeEstimate` was never wired to replace.

Collection: `forecast_snapshots`. Upserted on `{brand, tenantId, periodKey}` (idempotent — a retried trigger never duplicates); indexes on that compound key (unique) and `{brand, tenantId, capturedAt}` are ensured lazily via `createIndex` on each write, not a separate migration script.

### Win-Rate Calibration Model (2.4.48, issue #56)

```typescript
{
  tenantId: string
  brand: 'cogmap' | 'seyu'
  stages: {
    DISCOVERED: { sampleSize: number; wonCount: number; lostCount: number; rate: number; confidence: 'ok' | 'insufficient' }
    QUALIFIED:  { ... same shape }
    ENGAGED:    { ... same shape }
    PROPOSAL:   { ... same shape }
  }
  computedAt: Date
  windowDays: number | null
  minSampleSize: number
}
```

Collection: `winrate_calibration`, one doc per `(tenantId, brand)`, upserted only by `app/lib/win-rate-store.ts`'s `computeAndPersistWinRates()` — never written directly by a request handler, mirroring `forecast_snapshots`' own separation.

`lib/win-rate-calibration.ts`'s pure `computeWinRatesFromLogs()` reconstructs each lead's stage path by replaying its `outcomelogs` entries in chronological order (grouped by `leadId`), then attributes a WON/LOST terminal outcome back to every calibratable stage (`DISCOVERED`/`QUALIFIED`/`ENGAGED`/`PROPOSAL` — `WON`/`LOST` are terminal, never calibration targets themselves) that lead actually passed through. A no-op transition (`beforeState.kanbanColumn === afterState.kanbanColumn`, e.g. a `MODIFY` that didn't touch the column) is skipped; a lead with no WON/LOST terminal state is excluded from every denominator (an open deal is neither a win nor a loss).

`GET /api/win-rates` is the only lazy-recompute trigger (missing or >24h-stale cache, `app/lib/win-rate-store.ts`'s `isStale()`); `POST /api/win-rates/recalculate` is the only manual-recompute trigger. `GET /api/boards/[brand]` (via `app/lib/forecast.ts`'s `computeForecast()`) only ever *reads* the cached doc — it never recomputes on that hot path, so calibration adds zero aggregation latency to the live board request. When `settings.forecast_calibration.mode === 'calibrated'`, `lib/win-rate-calibration.ts`'s `mergeCalibratedWeights()` substitutes a stage's cached `rate` for its static weight only when `confidence === 'ok'` and `sampleSize >= minSampleSize` — otherwise the static default silently continues to apply for that stage. Each `forecast.pipeline[col]` entry gains a `probabilitySource: 'static' | 'calibrated'` field reflecting which one was actually used; `forecast.calibration = { mode, lastComputedAt }` reports the mode and the cached doc's own `computedAt` (`null` if never computed). In `mode: 'static'` (the default), every previously-existing numeric field (`leads`/`participants`/`rawRevenue`/`probability`/`weightedRevenue`) is byte-identical to pre-calibration output — only the always-present `probabilitySource`/`calibration` fields are new.

**Prerequisite fix shipped alongside this (2.4.48):** `app/api/leads/[id]/route.ts`'s `PUT` handler previously changed `kanbanColumn` without writing any `outcomelogs` entry — every other column-changing path (`ACCEPT`/`DECLINE`/`PIN`/`COLUMN_MOVE` in `app/lib/lead-actions.ts`, `CREATE` in `app/api/leads/route.ts`) already did. Any lead moved via `PUT` was invisible to calibration until this was fixed; the `PUT` handler now writes an `outcomelogs` entry (`action: 'PUT_COLUMN_CHANGE'`) whenever `updateData.kanbanColumn` differs from the existing value.

**No "Recalculate now" button in the browser UI, by design:** `POST /api/win-rates/recalculate` is `x-api-key` guarded, the same pattern as every other admin-only mutation in this repo (`/api/admin/forecast-snapshot`'s `POST`, `PUT`/`DELETE /api/leads/[id]`) — none of which have a client-side UI trigger, since the browser has no way to know a server-only secret. Rather than ship a button that would silently 401 for every real user (a CLAUDE.md Rule 7 violation — a control that visually implies a working capability it doesn't have), the forecast page's calibration panel relies solely on `GET /api/win-rates`'s lazy 24h-staleness recompute, which the page itself triggers on every load. `POST /api/win-rates/recalculate` remains available for admin/API/cron use only.

## Frontend

- **Framework:** Next.js 16 (App Router)
- **UI:** Mantine 9, plus a private GDS component library for admin surfaces (`@sovereignsquad/gds-admin`/`gds-core`)
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
- `GET /api/admin/forecast-snapshot` (2.4.41) additionally accepts Vercel Cron's automatic `Authorization: Bearer $CRON_SECRET` header, checked against a `CRON_SECRET` env var — either that header or a valid `x-api-key` authorizes the request (`lib/api-auth.ts`'s `requireCronOrApiKey`)
- Input validation enforced before database writes, including partial updates (`PUT`)
- CORS restricted to configured origins via `proxy.ts` (renamed from `middleware.ts` in 2.4.26's Next.js 16 upgrade — same logic, mandatory convention-file rename)
- Security headers set in middleware: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`

## Hosting

| Component | URL |
|-----------|-----|
| Production app | https://salesleadgenerator.vercel.app |
| API health | https://salesleadgenerator.vercel.app/api/health |
| Database | MongoDB Atlas |
