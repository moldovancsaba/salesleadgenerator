# Sales Lead Generator

**Version:** 2.4.236  
**Production:** https://salesleadgenerator.vercel.app

Sales Lead Generator is a Next.js sales intelligence app for managing sports organization leads across multiple brands on a kanban board. It supports lead discovery, enrichment, ICE scoring, outreach, and operator feedback learning.

---

## What This Repo Contains

- Next.js 16 app with API routes
- Mobile-first kanban board, table view, metrics dashboard, and search-learning panel
- Backlog board (`view=backlog`) for leads parked outside the main kanban flow
- Add Lead modal for manually creating leads (shares its contact editor with the detail-page edit form)
- Duplicate-lead review queue and merge UI (`/admin/duplicates`) — fuzzy near-duplicate detection with a conflict-resolution merge flow
- Lead detail actions and outreach compose flow
- Outreach template management UI
- Company Setup / Sales Settings page (`/salessettings/[client]`) — a plain-language questionnaire on what a brand sells, who buys it, and how, so the research agent can refine forecasts
- Research agent integration via OpenClaw cron
- MongoDB Atlas persistence with brand-aware collections

---

## Quick Start

```bash
npm install
npm run dev
```

Type check without building:

```bash
npx tsc --noEmit
```

Lint:

```bash
npm run lint
```

Run tests (required before any change ships, per `CLAUDE.md`'s quality gate):

```bash
npx vitest run
npm run test:integration
npm run test:smoke
npm run audit:gds-style
```

`npm run audit:gds-style` currently exits 1 with 27 known false positives in test files (issue #221); treat only findings not on the list in `docs/STACK_AND_DEPENDENCIES.md`'s Tooling table as new.

Deploy to Vercel:

```bash
vercel deploy --prod
```

Environment variables (all read via `process.env.*` in `app/` and `lib/` — see `docs/STACK_AND_DEPENDENCIES.md` for details):

| Variable | Required | Purpose |
|---|---|---|
| `MONGODB_URI` | Yes | Database connection |
| `SLG_API_KEY` | Yes | `x-api-key` auth for API clients (research agent, scripts) |
| `RESEND_API_KEY` | For email | Resend API key, **full access** (inbound matching calls `emails.receiving.get`, which a sending-only key cannot). Without it all outbound email (cadences, one-off sends, quotes, scheduled reports) is off; since 2.4.221 the cadence and report crons hold due work instead of skipping it (issue #224). Not currently set in production |
| `RESEND_WEBHOOK_SECRET` | For inbound email | Signing secret of the Resend webhook endpoint; with `RESEND_API_KEY` it activates `/api/webhooks/inbound-email` (issue #202). Not currently set in production |
| `CRON_SECRET` | Yes | The only credential Vercel Cron can send (`Authorization: Bearer`). If unset, every one of the 7 scheduled jobs returns 401 and nothing scheduled runs (issue #224); `x-api-key` only covers manual triggers |
| `CONTACT_STALENESS_THRESHOLD_DAYS` | No | Days before a contact is flagged stale (has a code default) |
| `SSO_BASE_URL` | For SSO | SSO provider base URL |
| `SSO_CLIENT_ID` | For SSO | SSO OAuth client ID |
| `SSO_CLIENT_SECRET` | For SSO | SSO OAuth client secret |
| `SSO_REDIRECT_URI` | For SSO | SSO OAuth callback URL |
| `SSO_SUPER_ADMIN_EMAILS` | For SSO | Comma-separated emails granted super-admin access |
| `INTEGRATION_CREDENTIALS_ENCRYPTION_KEY` | For Integrations | 32-byte base64 key encrypting stored Google/Calendly credentials at rest |
| `GOOGLE_OAUTH_CLIENT_ID` | For Integrations | Shared Google OAuth client ID (Calendar/Gmail/Contacts connections) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | For Integrations | Shared Google OAuth client secret |
| `GOOGLE_OAUTH_REDIRECT_URI` | For Integrations | Must match `/api/integrations/oauth/callback` on this deployment |
| `BLOB_READ_WRITE_TOKEN` | For Quotes | Vercel Blob store token (issue #211) — without it, "Generate Quote" is feature-detected off and rendered disabled, never a runtime error |

---

## Versioning

Current app version is **2.4.236**. `package.json` remains the single source of truth per the line below — this line has drifted before (once to a stale `2.4.29`, corrected 2026-07-25; again to a stale `2.4.187`, corrected 2026-09-25) and needs updating on every version-stamp sync pass, not just when someone notices.

Single source of truth: `package.json`

All docs and release notes should reference this version until the next intentional bump.

---

## Documentation

This README is the single source of truth for documentation paths and descriptions. All other docs should link back here rather than duplicating this index.

### Primary Documentation

| Path | Description |
|------|-------------|
| `README.md` | Onboarding, quick start, and documentation index |
| `CLAUDE.md` | Mandatory operating rules for any AI coding assistant working in this repo (quality gate, issue-driven workflow, DoD, branch/push authorization) |
| `CHANGELOG.md` | Version history, shipped features, and known limitations |
| `roadmap.md` | Every real open GitHub issue, grouped by status — the standing substitute for a GitHub Projects board, which this session's tooling cannot reach (see `CLAUDE.md` Rule 2.5) |
| `docs/ISSUE_MANAGEMENT.md` | Canonical, detailed reference for how issues are created/labeled/sequenced, exactly which tools access GitHub, and the verified boundary of what a session can and can't reach (the project-board question in full) — read this before managing issues here |
| `docs/LESSONS_LEARNED.md` | Recurring mistake patterns, sandbox/verification limitations, and the "why" behind key architectural decisions |
| `docs/LEAD_ENRICHMENT_GUIDE.md` | Structured catalog of every enrichable lead field plus a ready-to-use AI research-agent prompt for ongoing lead enrichment |
| `docs/data-fixes/` | Audit logs of production data corrections, one file per batch (lead id, old and new value, evidence) — e.g. `2026-09-26-country-corrections.md` (issue #222) |
| `docs/LEAD_TAXONOMY_MIGRATION_PLAN.md` | Plan for converting existing leads into the controlled sports-industry taxonomy schema (rulebook v1.0, 2.4.109) — now also the execution log for the in-progress backfill (issue #132) |

### Detailed Documentation

| Path | Description |
|------|-------------|
| `docs/ARCHITECTURE.md` | System overview, request flows, data flow, module map, and deployment diagram |
| `docs/LLD.md` | Low-Level Design — implementation-depth module map: every API route, every `lib`/`app/lib` module, the UI component tree, the full data model |
| `docs/OPERATOR_GUIDE.md` | Daily workflow, filters, outreach, known issues, and admin usage |
| `docs/STACK_AND_DEPENDENCIES.md` | Runtime, framework, UI, DB, hosting, agent/runtime stack |
| `docs/WEBHOOKS.md` | Integrator guide for the outbound webhook system — event set, request shape, signature verification recipe, retry/dead-letter behavior |
| `docs/INDEX.md` | Documentation index |
| `docs/DOC_LINT.md` | Doc lint checklist for maintaining documentation quality |

### Archived Documentation

| Path | Description |
|------|-------------|
| `_archived/BUILD_STATUS.md` | Historical build status (superseded by `docs/STACK_AND_DEPENDENCIES.md`) |
| `_archived/STACK_DECISION.md` | Historical stack decision (superseded by `docs/STACK_AND_DEPENDENCIES.md`) |
| `_archived/architecture.md` | Historical architecture doc (superseded by `docs/ARCHITECTURE.md`) |
| `_archived/user-guide.md` | Historical user guide (superseded by `docs/OPERATOR_GUIDE.md`) |
| `_archived/PIPELINE_ARCHITECTURE.md` | Historical pipeline architecture doc (superseded by `docs/ARCHITECTURE.md`) |
| `_archived/PROPOSAL.md` | Historical improvement proposal (superseded by `CHANGELOG.md`) |
| `_archived/roadmap.md` | Historical feature-status roadmap, frozen at v2.4.61 (superseded by `CHANGELOG.md`) — **not the same file** as the live, currently-maintained `roadmap.md` at the repo root (a GitHub-issue-status view, unrelated purpose, same basename by coincidence) |
| `_archived/deployment.md` | Historical deployment log (superseded by `CHANGELOG.md`) |

---

## API Overview

`/api/health`, `/api/lead-taxonomy` (added 2.4.111, serves the controlled sports-industry taxonomy vocabularies), `GET /api/settings`, and `GET /api/search-learning` are the only fully public data endpoints — all four serve non-sensitive, non-lead, non-PII data (static metadata or read-only aggregate config). A few more routes are public by design because their caller cannot sign in, and each has its own gate (issue #229): the prospect booking page's `GET /api/schedule/[brand]/availability` and `POST /api/schedule/[brand]/book` (per-IP rate limit, slot must match a free slot), `GET /api/quotes/[quoteId]/view` (a 128-bit share token, constant-time compare, rate limited per quote and client IP), `POST /api/webhooks/inbound-email` (Resend/Svix signature), and the two OAuth callbacks `GET /api/oauth/callback` (login, PKCE state) and `GET /api/integrations/oauth/callback` (single-use server-side state plus a session check, issue #228). Every lead-data endpoint (listings, search, boards, forecast export, metrics, win-rates, ticket-size calibration) requires either an `x-api-key` header or an authenticated browser session with access to the requested `brand` (issues #104, #192) — there is no unauthenticated read path to lead or business data (sales settings, the product catalog and the outcome/outreach log reads were open until 2.4.226, issue #226). One exception within the lead endpoints: `PUT /api/leads/[id]` (the research agent's enrichment path) accepts an API key only, not a session — the shared `SLG_API_KEY` or, since 2.4.232 (issue #220), a read-write scoped key for that brand — see `docs/OPERATOR_GUIDE.md`'s Auth section. `GET /api/search` with no `brand` searches every brand's leads at once and requires a super-admin session specifically (no `x-api-key` bypass), since no single brand grant covers that scope. `PUT /api/settings` and `POST /api/search-learning` (global, not brand-scoped) require `x-api-key` or any authenticated session (issue #192).

Key endpoints:
- `GET /api/leads?brand=<brand>` — list leads (page-based by default; cursor pagination via `?cursor=`)
- `GET /api/leads/columns?brand=<brand>&column=<col>` — cursor-paginated per-column kanban loading, ICE-score sorted for DISCOVERED/QUALIFIED
- `POST /api/leads?brand=<brand>` — create lead
- `PUT /api/leads/[id]?brand=<brand>` — update lead fields (enrichment; shared or scoped `x-api-key`, never a session)
- `PATCH /api/leads?brand=<brand>&id=<id>` — action lead
- `GET /api/search?q=<query>&brand=<brand>` — predictive lead search (`brand` required unless the caller is a super-admin session)
- `GET /api/health` — service health (no auth required)
- `GET /api/lead-taxonomy` — controlled sports-industry taxonomy vocabularies (no auth required)
- `GET /api/admin/cron-status` — cron observability
- `GET /api/outreach-templates?brand=<brand>&mode=analytics` — outreach analytics

See `docs/OPERATOR_GUIDE.md` for workflow guidance and API examples.

---

## License
