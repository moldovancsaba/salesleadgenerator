# Sales Lead Generator

**Version:** 2.4.335  
**Production:** https://salesleadgenerator.vercel.app

Sales Lead Generator is a Next.js sales intelligence app for managing sports organization leads across multiple brands on a kanban board. It supports lead discovery, enrichment, ICE scoring, outreach, and operator feedback learning.

---

## What This Repo Contains

- Next.js 16 app with App Router and API routes
- Native What's New & Release Notes Blog (`/whats-new/[brand]`, `app/components/AppNav.tsx`, `app/components/AppHeader.tsx`) presenting chronological release notes like a blog from newest to oldest with exact commit dates, categorized highlights distinguishing new features (What's New) from bug fixes (What's Fixed) and security/privacy protections, real-time search filtering, deep-linking version anchors, and 1-click header/sidebar navigation
- Redesigned Modern Kanban Cards (`app/card.tsx`) with full-width wrapping organization titles, human-readable Title Case taxonomy formatting, prominent key decision-maker contact row with 1-click Quick Outreach (`IconMail`), stage-aware semantic decision buttons (Accept, Decline, Quick Email), high-visibility follow-up urgency status badges, untruncated owner avatar initials, commercial badges, de-duplicated staleness indicators, and quiet subtle action affordances (`Open ↗`)
- Native 3-Pane Communication Center (`/inbox/[brand]`) with dynamic sender resolution, clean 2-line textual snippets (stripped of CSS `<style>` blocks and HTML tags), Lead/Contact/Deal availability status badges, 1-click conversion affordances, and full `To:` / `Cc:` recipient visibility
- Internal Team Email Filtering & Personal Mailbox Attribution (`app/lib/inbox-store.ts`, `lib/email-contact-extractor.ts`) filtering purely internal colleague communications (staff syncs, weekly meetings) from CRM inbox views, and strictly attributing personal mailbox views to the active user's own email
- User Mailbox Isolation & Fail-Closed Privacy Guard (`app/lib/inbox-store.ts`, `app/api/inbox/[brand]/route.ts`) strictly hiding all correspondence if session claims are unresolved, permanently closing fail-open leak vectors
- Admin-Managed Mailbox Aliases & Scoping Policy (`/admin/users`, `/salessettings/[client]`, `sso_user_access`, `company_settings`) with self-service modal for linked mailboxes (`office@seyuselfies.com`, `coo@seyuselfies.com`, `moldovancsaba@gmail.com`) and instant toggle between Strict Mailbox Only and Assigned Lead Visibility
- Multi-Identity Mailbox Linking (`KNOWN_USER_ALIASES`) unifying personal Google SSO (`moldovancsaba@gmail.com`) with corporate Google Workspace accounts (`coo@seyuselfies.com`) into a unified inbox stream
- Systemic Internal Company & Service Provider Shield (`lib/email-contact-extractor.ts`, `lib/email-contact-merge.ts`) with canonical `INTERNAL_COMPANY_DOMAINS` and `reliableaccount.hu` shielding against accounting/payroll files and automated meeting notetakers
- Email Contact to Lead & Deal Conversion (`POST /api/inbox/[brand]/convert`, `ConvertModal`) with automatic email participant harvesting and enrichment (`lib/email-contact-extractor.ts`, `lib/email-contact-merge.ts`), multi-company domain inference, selective harvesting participant selector with domain badges, conversion destination switching ("Add to Current Lead" vs "Separate Lead"), and live thread conversation contacts strip
- Desktop and tablet browser experience: docked collapsible sidebar navigation (`>= 768px`) with show/hide toggle, inline Board/Table/Backlog/Metrics view switcher, command palette shortcut affordances (`⌘K`), and unblocked multi-touch zoom
- Progressive Web App (PWA) with self-hosted offline shell fallback (`/offline`), app-shell caching, standalone manifest, and shortcuts
- Mobile-first kanban board, table view, metrics dashboard, and search-learning panel
- Multi-CRM Lead Import and Export (`/api/leads/export`, `/api/leads/import`, `LeadExportModal`, `LeadImportModal`) for **HubSpot**, **Salesforce**, **Pipedrive**, and **Google Sheets** with RFC 4180 parsing, UTF-8 BOM CSV downloads, and 1-click TSV clipboard copying
- Modernized 5-Tab Sales Settings (`/salessettings/[client]`) with live central Product Catalog synchronization (`/admin/products/[brand]`), assignable brand sales team squad, default deal owner routing, deal sizing bands, and region multipliers
- Multi-Google Account support for User Profiles, Gmail Outreach, and Contacts with per-account sync, test, disconnect, and default sender management (`/api/user/integrations`)
- Google Contacts 1-click OAuth integration and batch lead import workspace modal (`/contacts/[brand]`, `/api/contacts/import-google`)
- Interactive Report Templates Gallery and View Switcher (`/reports/[brand]`, `/api/reports/templates`, `/api/reports/seed`) with Bar, Line, and Data Table visualizations
- Document Library Management UI (`/documents/[brand]`) with workspace-wide collateral uploads, rename, deletion conflict protection, and inline attachment picker in outreach compose
- Automated Scheduler Offline Recovery & Pacing Throttles (`lib/scheduler-recovery.ts`, `/api/admin/scheduler-recovery`) with downtime detection, slot redistribution, and cadence catch-up pacing
- Pipeline Stage Management Modal (`PipelineManagerModal`, `/api/pipelines`) for creating custom pipelines, stages, win probabilities, and default pipeline customization
- Today rep execution surface and unified daily action queue (`/today/[brand]`) with inline complete/snooze/call-log actions
- Product catalog and CPQ quote generation (`/admin/products/[brand]`, `/api/quotes`) with multi-line PDF quotes, interactive public buyer quote portal (`/quotes/[quoteId]`), and self-service e-signature acceptance (`POST /api/quotes/[quoteId]/accept`)
- Revenue intelligence & pipeline inspection (`/forecast/[brand]`, `/api/forecast/inspection`) with deal movement waterfalls (New, Advanced, Regressed, Slipped, Won, Lost), engagement-weighted Deal Health Score (0–100 across Kanban, Table, and Lead Detail), and multi-rep opportunity splits (`Deal.splits[]`) with split-adjusted quota attainment
- Visual Sales Path stepper, interactive BANT/MEDDPICC/Sports Activation discovery playbooks (`SalesPathPlaybookBar`), and call/meeting transcript intelligence analyzer (`lib/transcript-intelligence.ts`) auto-detecting competitor Battlecards, action items, and buying signals
- Sequences and outreach cadences with 50/50 step A/B testing (`variantTemplateId`) and variant lift analytics, manual task completion gating (`call`, `linkedin`, `general`), stop-on-reply, and last-mile suppression
- Public & embeddable inbound web lead capture forms (`/forms/[brand]`, `POST /api/forms/[brand]/submit`) and Google Calendar public booking links (`/schedule/[brand]`) with automatic Google Meet video link provisioning and assigned-rep calendar routing
- RFC 2822 Threaded Email Follow-Ups with `In-Reply-To` and `References` chaining in Outreach Compose and Gmail sync
- Interactive Merge Token Inserter toolbar in Outreach Compose with live variable hover preview tooltips
- Lead timeline noise filtering with 48h grace window to suppress historical correspondence predating contact creation
- Unified activity timeline supporting manual call logging, internal notes, deal-associated activities, and Gmail sync
- Accounts directory (`/accounts/[brand]`) with company rollups, child lead breakdown, account activity timeline, and CSV export
- Contacts directory (`/contacts/[brand]`) with buying committee roles, search, and CSV export
- Google Calendar one-way sync for CRM task reminders and public booking links (`/schedule/[brand]`)
- Backlog board (`view=backlog`) for leads parked outside the main kanban flow
- Add Lead modal for manually creating leads (shares its contact editor with the detail-page edit form)
- Duplicate-lead review queue and merge UI (`/admin/duplicates`) — fuzzy near-duplicate detection with a conflict-resolution merge flow
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

`npm run audit:gds-style` exits 0 since 2.4.243 (issue #221 fixed the test-title false positives); any new finding is real.

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
| `RESEND_OUTBOUND_DOMAIN` | No | Domain used to build a brand's default from-address (`<brand>@<domain>`); defaults to `haho.ai` (`lib/outreach-send.ts`) |
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

Current app version is **2.4.330** (`APP_VERSION` in `lib/release-notes-dates.ts`, matching `package.json` and displayed visibly in `AppHeader` and `AppNav`).

Single source of truth: `package.json` & `lib/release-notes-dates.ts`

All docs and release notes reference this version until the next intentional bump.

---

## Documentation

This README is the single source of truth for documentation paths and descriptions. All other docs should link back here rather than duplicating this index.

### Primary Documentation

| Path | Description |
|------|-------------|
| `README.md` | Onboarding, quick start, and documentation index |
| `docs/USER_GUIDE.md` | Canonical end-user user guide for sales reps and account executives across all CRM surfaces |
| `AGENTS.md` / `CLAUDE.md` | Mandatory operating rules for any AI coding assistant working in this repo (quality gate, issue-driven workflow, DoD, branch/push authorization). `AGENTS.md` is canonical; `CLAUDE.md` is an identical copy |
| `HANDOVER.md` | Current handover for the next agent: state, commands, open work, traps, first-hour checklist (dated) |
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
| `docs/PRIVACY_POLICY.md` | Canonical Privacy Policy and Google API User Data Policy & Limited Use compliance disclosures (`/privacy`) |
| `docs/TERMS_OF_SERVICE.md` | Canonical Terms of Service, mailbox integration authorization, and anti-spam terms (`/terms`) |
| `docs/ARCHITECTURE.md` | System overview, request flows, data flow, module map, and deployment diagram |
| `docs/LLD.md` | Low-Level Design — implementation-depth module map: every API route, every `lib`/`app/lib` module, the UI component tree, the full data model |
| `docs/OPERATOR_GUIDE.md` | Daily workflow, filters, outreach, known issues, and admin usage |
| `docs/STACK_AND_DEPENDENCIES.md` | Runtime, framework, UI, DB, hosting, agent/runtime stack |
| `docs/WEBHOOKS.md` | Integrator guide for the outbound webhook system — event set, request shape, signature verification recipe, retry/dead-letter behavior |
| `docs/USER_EMAIL_INTEGRATION_SPEC.md` | Technical specification for multi-account Google/Gmail OAuth integration, AES-256-GCM credential encryption, and synchronization |
| `docs/INDEX.md` | Documentation index |
| `docs/DOC_LINT.md` | Doc lint checklist for maintaining documentation quality |

### Archived Documentation

| Path | Description |
|------|-------------|
| `docs/handover-2026-08-13.md` | Archived handover of the 2026-08-13 session (an unpushed feature branch, since shipped); superseded by `HANDOVER.md` |
| `_archived/BUILD_STATUS.md` | Historical build status (superseded by `docs/STACK_AND_DEPENDENCIES.md`) |
| `_archived/STACK_DECISION.md` | Historical stack decision (superseded by `docs/STACK_AND_DEPENDENCIES.md`) |
| `_archived/architecture.md` | Historical architecture doc (superseded by `docs/ARCHITECTURE.md`) |
| `_archived/user-guide.md` | Historical user guide (superseded by `docs/USER_GUIDE.md` and `docs/OPERATOR_GUIDE.md`) |
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
- `GET /api/leads/export?brand=<brand>&preset=<crm>` — multi-CRM lead exports (HubSpot, Salesforce, Pipedrive, Google Sheets / CSV / TSV)
- `POST /api/leads/import` — batch lead import with SHA-256 fingerprint deduplication and stage normalization
- `GET /api/inbox/[brand]` — list aggregated conversation threads and stream metrics
- `POST /api/inbox/[brand]/bulk` — batch thread state actions (mark read/unread, star/unstar, archive/unarchive)
- `GET /api/inbox/[brand]/attachments` — authenticated download proxy for Gmail message attachments and workspace Document Library files
- `GET /api/inbox/[brand]/threads/[id]` — get thread message timeline and dispatch in-thread email replies or internal notes
- `POST /api/inbox/[brand]/convert` — convert thread participants to Lead/Deal/Contact with multi-company destination control
- `GET /api/release-notes` — paginated, searchable release notes and single-version lookup parsed from `CHANGELOG.md`
- `POST /api/contacts/import-google` — Google Contacts 1-click import and lead creation
- `GET /api/leads/[id]/thread-context` — email conversation thread context resolution
- `GET /api/search?q=<query>&brand=<brand>` — predictive lead search (`brand` required unless the caller is a super-admin session)
- `GET /api/health` — service health (no auth required)
- `GET /api/lead-taxonomy` — controlled sports-industry taxonomy vocabularies (no auth required)
- `GET /api/admin/cron-status` — cron observability
- `GET /api/admin/scheduler-recovery` — scheduler recovery state and downtime pacing metrics
- `GET /api/reports/templates` & `POST /api/reports/seed` — report template catalog and seeding
- `GET /api/outreach-templates?brand=<brand>&mode=analytics` — outreach analytics

See `docs/OPERATOR_GUIDE.md` for workflow guidance and API examples.

---

## License

MIT. See `LICENSE`.
