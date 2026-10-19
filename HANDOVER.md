# HANDOVER: Sales Lead Generator
Date: 2026-10-18. Owner: moldovancsaba. Board: https://github.com/users/moldovancsaba/projects/56. Repo: https://github.com/moldovancsaba/salesleadgenerator. Production: https://salesleadgenerator.vercel.app.

The previous handover (session of 2026-10-05, v2.4.247) recorded baseline operations, branch hygiene, and initial pipeline fixes.

## What this is
A Next.js 16 sales-intelligence app: a kanban board, table view, metrics, outreach, cadences, quotes, multi-CRM lead exchange (HubSpot, Salesforce, Pipedrive, Google Sheets), and an admin area for sports-organization leads, one workspace per brand (`cogmap`, `seyu`, `dvsc`; brands are runtime-editable in the database, issue #195). Sales teams use it; an automated external research agent (`researchandenrich` runtime) discovers and enriches leads and writes them through this app's API. Per `AGENTS.md` Rule 10 (2026-10-16), coding assistants are strictly developers, never manual lead-research or content-enrichment operators.

## State today
- **Version 2.4.293** (`package.json`, package name `slg-leads`). Main branch is active and verified.
- **Deploys on Vercel** (production URL above). `vercel.json` holds cron entries (`Authorization: Bearer` with `CRON_SECRET`).
- **Database**: MongoDB Atlas. Database `cogmap` holds core business collections (`leads`, `accounts`, `company_settings`, `products`, `activityLog`, `inbox_thread_states`, `integration_connections`, `sso_user_access`, `report_definitions`, `webhooks`, `scheduler_state`).
- **Quality gate** (verified clean): `npx tsc --noEmit` reports 0 errors, `npm run lint` reports 0 errors and 0 warnings, `npm run audit:gds-style` exits 0, `npm run test:smoke` passes 5/5, and `npx vitest run` passes 100% (1,498 unit tests across 115 test files).
- **Recent Deliverables Shipped (v2.4.270 – v2.4.293)**:
  - **Unified Communication Center End-to-End Delivery (2.4.293, #257)**: End-to-end integration and sync for the native 3-pane omnichannel inbox console at `/inbox/[brand]`. Delivers self-service Gmail sync trigger (`POST /api/user/integrations/gmail/sync`) directly from the inbox header with live feedback, deep-linking support (`stream`, `search`, `lead`, `thread` query params) from `page.tsx` server component to client, direct "Open in Inbox" navigation affordance from `ActivityPanel`, RFC 2822 header extraction (`In-Reply-To`, `References`, `threadId`) during Gmail sync, lead ID search indexing, and thread status persistence.
  - **Comprehensive Docs & Architecture Alignment (2.4.291, #256)**: Comprehensive alignment audit across all docs, API route inventories, handover, and versioning across v2.4.291.
  - **Multi-CRM Lead Import & Export (2.4.290, #254)**: Full bidirectional exchange for HubSpot, Salesforce, Pipedrive, and Google Sheets with RFC 4180 parsing, UTF-8 BOM CSV exports, 1-click Google Sheets TSV copying, SHA-256 fingerprint deduplication, and stage/country normalization.
  - **Modernized Sales Settings (2.4.291, #255)**: 5-tab workspace layout (`/salessettings/[client]`), central Product Catalog synchronization (`/admin/products/[brand]`), assignable sales squad member cards (`sso_user_access`), default deal owner routing, deal sizing bands, and region multipliers.
  - **Report Templates & Analytics (2.4.289, #253)**: Standard CRM report templates gallery modal, automated database seeding (`/api/reports/seed`), chart null-safety hardening, and interactive Bar/Line/Table view switcher.
  - **Multi-Google Account Integration (2.4.288, #252)**: Compound partial index on `{ userId, provider, userEmail }`, default sender tracking, inline account selection in compose modal, and multi-account Gmail polling.
  - **Google Contacts Sync & Batch Ingestion (2.4.287, #251)**: 1-click Google Contacts OAuth sync and batch lead creation modal on `/contacts/[brand]`.
  - **Document Library UI (2.4.283, #247)**: Central collateral management at `/documents/[brand]` with attachment chips in outreach compose.
  - **Scheduler Recovery & Pacing (2.4.282, #246)**: Heartbeat monitoring, downtime detection (>15m), slot redistribution, and cadence catch-up pacing.
  - **Custom Pipeline Stage Management (2.4.280, #245)**: `PipelineManagerModal` for custom stages, win probabilities, and default drag-and-drop.
  - **RFC 2822 Email Threading (2.4.278, #243)**: `In-Reply-To` and `References` chaining in Outreach Compose and Gmail sync.
  - **Merge Token Inserter (2.4.277, #242)**: Token insertion toolbar in email templates with live hover preview tooltips.
  - **Timeline Noise Filtering (2.4.279, #244)**: Suppresses historical inbound correspondence predating lead contact creation.
- **Known broken**: Nothing known in code. Open items are owner-operational or external DNS/key setup.

## Run, test, deploy
Install: `npm install` / `npm ci`. Dev server: `npm run dev`.
Mandatory Quality Gate (`AGENTS.md` Rule 1; run all and read real output before claiming clean):
```bash
npx tsc --noEmit
npm run lint
npx vitest run
npm run test:smoke
npm run audit:gds-style
```
Deploy: Vercel production deployment triggered on direct push to `main` (authorized per `AGENTS.md` Rule 6).

## In flight
Tracked via `roadmap.md` (repo root) and GitHub issues:
- **#132 (P1, blocked)**: Mechanical `sportCode` backfill complete (89.3%, 2,749 leads). Ongoing lead enrichment belongs to external `researchandenrich` worker runtime per `AGENTS.md` Rule 10.
- **#202 (P1, blocked)**: Inbound email activation (DNS MX, Resend production keys; owner deferred).
- **#137 (P1, blocked)**: Duplicate leads at scale; code shipped in 2.4.225, merge review is an owner/client operational task.
- **#220 (P3, blocked)**: Migrate cron and research agent to scoped API keys; needs owner super-admin session for key creation.
- **#165 (P3)**: Stays open on purpose as the onboarding-tour permanent design record.
- **#256 (P2, in progress)**: Comprehensive documentation, API inventory, and versioning alignment across v2.4.291.

## Traps and decisions
- **`roadmap.md` is the standing project tracker** (`AGENTS.md` Rule 2.5): GitHub Projects board API is unreachable from agent sessions. Update `roadmap.md` in the same change whenever an issue opens, closes, or changes status.
- **Direct push to `main` is pre-authorized** (`AGENTS.md` Rule 6) for finished, clean deliverables that pass the quality gate 100%. Commit author: `moldovancsaba <moldovancsaba@gmail.com>`.
- **Zero AI attribution anywhere** (`AGENTS.md` Rule 8): No AI model names, tool signatures, or co-authored trailers in commits, code, PRs, or docs.
- **Developer role only** (`AGENTS.md` Rule 10): Never manually research or enrich lead content in development sessions.
- **Route collisions**: Next.js App Router silently ignores duplicate routes when a plain `page.tsx` and a route group `(group)/page.tsx` resolve to the same route. Grep before adding new pages.
- **`CRON_SECRET`**: Required for Vercel Cron scheduled jobs (`Authorization: Bearer`).
- **`researchandenrich` is shared** (`AGENTS.md` Rule 9): Touch only for `cogmap`/`seyu`/`dvsc` fixes, never another app's tenant.

## Where things live
- `README.md`: Onboarding, env table, API overview, documentation index.
- `CHANGELOG.md`: Per-version release notes and bugfix root causes.
- `roadmap.md`: Open and recently closed issue status view.
- `docs/INDEX.md`: Structural navigation index.
- `docs/ARCHITECTURE.md`: System-level architecture, data models, auth, and request flows.
- `docs/LLD.md`: Low-level design, complete API route inventory, module catalog, and component hierarchy.
- `docs/OPERATOR_GUIDE.md`: Task-oriented walkthrough for daily sales and admin operations.
- `docs/STACK_AND_DEPENDENCIES.md`: Dependency inventory, runtime specifications, and security audits.
- `docs/ISSUE_MANAGEMENT.md`: GitHub issue creation rules, label taxonomy, and structural conventions.
