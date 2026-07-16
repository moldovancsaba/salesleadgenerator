# Development Specs — Sales Lead Generator

This file breaks every planned improvement into deliverable, buildable segments. Each segment is sized to be implemented, tested, and shipped independently.

---

## 1. AI-Powered Lead Scoring (Secondary System)

**Goal:** Add a machine-learning scoring layer alongside the existing ICE system. ICE remains the default sort order. AI Score is displayed as a second indicator and used for smart sorting/prioritization in the background.

### Segment 1.1 — Feedback Data Model
- Add `outcome` field to leads: `accepted`, `declined`, `won`, `lost`
- Add `feedbackScore` delta tracking per lead
- Add `outcomeLogs` collection schema: `leadId`, `action`, `outcomeType`, `outcomeValue`, `teachingWeight`, `actorType`, `actedBy`, `beforeState`, `afterState`, `createdAt`
- Ensure every kanban action (ACCEPT, DECLINE, COLUMN_MOVE, PIN, MODIFY) writes an outcome log

### Segment 1.2 — Feature Extraction
- Extract per-lead features from existing data:
  - Contact richness score (named contacts × contact field coverage)
  - Org size / sector signals
  - Region / league level
  - Value proposition length / specificity
  - Pros/cons completeness
  - Recency (`createdAt` age)
- Store features in a denormalized `scoreProfile.features` object on each lead

### Segment 1.3 — Model Training Pipeline
- Create `/lib/ai-scoring/train.ts`:
  - Reads `outcomeLogs` + lead features
  - Trains a lightweight classifier/regressor (start with logistic regression or small decision tree via TensorFlow.js or simple heuristics)
  - Outputs model artifact to `/models/lead-score-model.json`
- Schedule: retrain nightly via cron or on-demand after 50+ new outcomes
- Persist model version in DB; never break existing leads if model is missing

### Segment 1.4 — AI Score API
- Add `POST /api/leads/score?brand=<brand>` for single-lead scoring
- Returns `{ aiScore: number (0-1000), confidence: number, modelVersion: string }`
- Batch endpoint: `POST /api/leads/score-batch?brand=<brand>` for re-scoring all leads

### Segment 1.5 — UI Integration
- Add AI Score badge to `LeadCard` and `LeadDetailModal`
- Sort toggle: "Sort by ICE" vs "Sort by AI Score" in kanban header
- Show score delta when ICE and AI disagree significantly (>200 points)
- Tooltip explaining AI Score is experimental / based on historical feedback

### Segment 1.6 — Monitoring & Calibration
- Dashboard endpoint: `GET /api/leads/score-metrics?brand=<brand>`
  - Accuracy vs actual outcomes (acceptance rate by score bucket)
  - Model version history
  - Feature importance
- Alert when model accuracy drops below threshold

---

## 2. Auto-Enrichment Pipeline

**Goal:** Continuously enrich leads with external data so users don't have to research manually.

### Segment 2.1 — Enrichment Providers Config
- Create `/lib/enrichment/providers.ts` with pluggable provider interface
- Default providers: Hunter (email verification), LinkedIn (profile scrape), Clearbit/SimilarWeb (company data)
- Store API keys in Vercel env vars; never hardcode

### Segment 2.2 — Email Verification & Discovery
- Verify `decision_maker_contact` via Hunter API
- If invalid, attempt pattern-based guess + verify
- Append discovered emails to `contacts[]` with `verified: true/false`
- Update lead `contact_phone`, `general_email` from provider data

### Segment 2.3 — Company Data Enrichment
- Fetch: employee count, industry, funding, tech stack, recent news
- Write to new fields: `company_size`, `company_industry`, `company_funding`, `company_news`, `tech_stack`
- Update `size` field if provider data is more reliable than agent estimate

### Segment 2.4 — LinkedIn Profile Enrichment
- Scrape LinkedIn public profiles for additional contacts
- Append to `contacts[]`: name, title, email, phone, linkedin, role
- Respect rate limits; queue jobs via background worker

### Segment 2.5 — Enrichment Queue & Scheduler
- Background job (cron or queue) scans leads with `enrichmentStatus: pending`
- Processes 10-20 leads per run to avoid rate limits
- Updates `enrichmentStatus` to `enriched` or `failed`
- Logs enrichment actions to `outcomeLogs`

### Segment 2.6 — UI Indicators
- Show enrichment status badge on cards: "Enriched", "Partial", "Pending"
- Allow manual re-enrichment per lead
- Show data source attribution: "Email via Hunter", "Company via Clearbit"

---

## 3. One-Click Outreach Templates

**Goal:** Turn the kanban from a viewing tool into a working tool by letting users send outreach directly.

### Segment 3.1 — Template Engine
- Create `/lib/outreach/templates.ts`
- Per-industry templates: soccer academies, performance centers, federations
- Template variables: `{entity_name}`, `{decision_maker_name}`, `{value_proposition}`, `{sport_or_sector}`
- Store templates in DB for admin editing

### Segment 3.2 — Email Draft Generation
- Button in `LeadDetailModal`: "Draft Email"
- Renders template preview with lead data interpolated
- Copy-to-clipboard + open in Gmail/Outlook compose
- Log outreach action to `outcomeLogs`

### Segment 3.3 — LinkedIn Message Templates
- Shorter templates for LinkedIn InMail/connection requests
- Same variable interpolation
- Open LinkedIn compose with pre-filled message

### Segment 3.4 — Outreach Tracking
- Add `outreachLog` array to leads: `{ type, templateId, sentAt, channel, status }`
- Track: drafted, sent, opened, replied, bounced
- Integration with email tracking pixel or webhook from email provider

### Segment 3.5 — Template Analytics
- Dashboard: which templates have highest reply rate
- A/B test support: two templates, random assignment, track winner

---

## 4. CRM Sync (Read + Write)

**Goal:** Two-way sync with major CRM platforms so leads flow into existing sales workflows.

### Segment 4.1 — CRM Provider Interface
- Create `/lib/crm/providers.ts` with pluggable provider interface
- Initial providers: HubSpot, Salesforce, Pipedrive
- Store OAuth tokens / API keys per user in DB

### Segment 4.2 — Push to CRM
- Action button: "Push to CRM"
- Creates/updates contact + deal/opportunity in CRM
- Maps lead fields to CRM fields with configurable mapping
- Stores CRM `externalId` on lead record

### Segment 4.3 — Pull from CRM
- Background job syncs CRM status back to kanban
- Maps CRM stages to kanban columns
- Updates `status`, `kanbanColumn`, `lastActionAt`

### Segment 4.4 — Conflict Resolution
- If CRM status and kanban status diverge, show conflict banner
- User chooses which source of truth wins
- Log all sync actions to `outcomeLogs`

### Segment 4.5 — CRM Dashboard Widget
- Show CRM sync status per lead in detail modal
- "Last synced: 2h ago", "CRM: HubSpot #1234"
- Unsynced leads count in header

---

## 5. Lead Source & Campaign Attribution

**Goal:** Track where each lead came from so clients can optimize research investment.

### Segment 5.1 — Source Tagging
- Add `source` field to leads: `web_search`, `referral`, `import`, `crm_sync`
- Add `campaign` field: optional campaign identifier
- Agent automatically tags leads with research query / source on creation

### Segment 5.2 — Attribution Dashboard
- New page: `/sales/cogmap/analytics` and `/sales/seyu/analytics`
- Charts: leads by source, conversion rate by source, avg ICE by source
- Filter by date range, region, sector

### Segment 5.3 — ROI Calculation
- Estimate research cost per source (time, API calls)
- Calculate cost per qualified lead, cost per won deal
- Show on dashboard

---

## 6. Smart Alerts & Notifications

**Goal:** Keep users engaged by notifying them when something important happens.

### Segment 6.1 — Alert Rules Engine
- Create `/lib/alerts/rules.ts` with built-in rules:
  - High-value lead discovered (ICE > 700)
  - Lead status changed (moved to ENGAGED, marked WON)
  - Lead stale > 7 days without action
  - Company news trigger (new funding, new hire)
- User can enable/disable rules per workspace

### Segment 6.2 — Notification Channels
- In-app notification bell (Mantine Notifications)
- Email notifications (Resend/Postmark)
- Webhook delivery to Slack/Discord

### Segment 6.3 — Alert Preferences
- User settings page: per-rule channel preference
- Digest mode: daily/weekly summary vs instant

### Segment 6.4 — Alert Dashboard
- `/alerts` page showing recent alerts
- Mark as read / dismiss / take action directly

---

## 7. Saved Views & Custom Filters

**Goal:** Let users save and reuse filter combinations.

### Segment 7.1 — Filter State Serialization
- Capture current filter state: region, search query, kanban column, ICE range, AI score range, tags
- URL-serializable for shareability

### Segment 7.2 — Saved Views
- Save named views to DB: `{ name, filters, userId, isDefault }`
- Dropdown in header to switch between saved views
- Default views: "All Leads", "My High-Priority", "Needs Follow-up"

### Segment 7.3 — Team Shared Views
- Mark views as `shared: true` for team workspaces
- Team members see each other's saved views

### Segment 7.4 — Quick Filter Chips
- Active filters shown as removable chips below header
- One-click clear all filters

---

## 8. Team Workspaces

**Goal:** Multi-user support so teams can collaborate on leads.

### Segment 8.1 — User Model & Auth
- Add `User` model: email, name, role, workspaceId, avatar
- Simple email magic-link auth (or OAuth if preferred)
- Session management with JWT

### Segment 8.2 — Workspace Model
- Add `Workspace` model: name, plan, createdAt, settings
- Leads belong to workspace, not individual user
- User-workspace join with role: `owner`, `admin`, `member`, `viewer`

### Segment 8.3 — Lead Assignment
- `assignedTo` field on leads
- Assignment history in `outcomeLogs`
- Filter by assignee in kanban

### Segment 8.4 — Internal Notes & Mentions
- Add `notes` array to leads: `{ userId, text, createdAt }`
- @mention support: `@user` triggers notification
- Notes visible in detail modal and as timeline

### Segment 8.5 — Activity Feed
- Per-workspace activity log: who moved what, who accepted/declined
- Filterable by user, date, action type

---

## 9. Pipeline Analytics Dashboard

**Goal:** Give clients data to justify the service and optimize their pipeline.

### Segment 9.1 — Metrics Computation
- Pre-compute daily metrics: leads created, qualified, engaged, won, lost
- Store in `dailyMetrics` collection
- Conversion rates, avg time in stage, drop-off points

### Segment 9.2 — Dashboard Page
- New page: `/sales/[brand]/analytics`
- Charts: funnel, conversion over time, lead volume by source/region
- Date range picker, export to CSV

### Segment 9.3 — Forecast Model
- Weighted pipeline: sum of (lead value × probability) by stage
- Probability derived from historical conversion rates
- Show forecast vs target

### Segment 9.4 — Segment Analysis
- Breakdown by: region, sector, lead source, team member
- Identify best-performing segments
- Recommendations: "Focus more on US soccer academies — 2x conversion rate"

---

## 10. Client API & Webhooks

**Goal:** Let power users pipe leads into their own tools in real time.

### Segment 10.1 — Client API Keys
- Add `ApiKey` model: workspaceId, key hash, permissions, createdAt, lastUsedAt
- Endpoint: `POST /api/keys` to generate, `DELETE /api/keys/:id` to revoke
- Scoped permissions: read:leads, write:leads, read:analytics

### Segment 10.2 — REST API
- Authenticated endpoints under `/api/v1/leads`, `/api/v1/leads/:id`
- Full CRUD parity with internal API
- Pagination, filtering, sorting
- OpenAPI/Swagger docs at `/api/docs`

### Segment 10.3 — Webhooks
- Add `Webhook` model: workspaceId, url, events[], secret, active
- Supported events: `lead.created`, `lead.updated`, `lead.moved`, `lead.scored`
- Retry logic with exponential backoff
- Signature verification with webhook secret

### Segment 10.4 — Self-Serve Portal
- Simple onboarding flow: sign up, get API key, read docs
- Usage dashboard: API calls, leads synced, webhook deliveries
- Billing integration placeholder for future paid tier

---

## Cross-Cutting Concerns

### Performance
- All list endpoints paginated (max 100, default 25)
- Heavy queries use MongoDB indexes: `fingerprint`, `kanbanColumn`, `region`, `createdAt`
- AI scoring runs in background; never blocks lead creation

### Security
- API keys hashed with bcrypt; never stored plaintext
- Webhook signatures use HMAC-SHA256
- Rate limiting on public endpoints
- CORS configured per workspace domain

### Observability
- All mutations log to `outcomeLogs`
- Structured logging with request IDs
- Error tracking via Sentry or similar

### Testing
- Unit tests for scoring, enrichment, CRM sync
- Integration tests for API routes
- E2E tests for critical flows: create lead → qualify → push to CRM
