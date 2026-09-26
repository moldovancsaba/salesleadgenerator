# Low-Level Design — Sales Lead Generator

**Version:** 2.4.212

**Status:** First written 2026-08-02 (2.4.177); brought current 2026-09-25 (2.4.212) after a routine `docs/DOC_LINT.md` audit found this doc had gone stale across ~15 features shipped in between (teams, lead ownership, buying-committee roles, call logging, the workflow/automation engine, ad-hoc reporting, forecast quota, bulk actions v2, accounts rollup, kanban real drag-and-drop and card-density/command-palette, the third-party integration hub, Gmail/Contacts sync, the meeting scheduler, the product catalog, scoped API keys, quote generation, and outbound webhooks) — every one of those is now covered below, verified against the real source, not extrapolated from issue numbers. This sits one level below `docs/ARCHITECTURE.md` (which covers system-level request flows, the data model's *shape and meaning*, and the deployment picture) — this doc is the module-by-module inventory: every API route, every shared library module, every major UI component, and exactly how they wire together. Where `ARCHITECTURE.md` explains *why* a decision was made, this doc is a map of *where the code that implements it actually lives*.

Compiled directly from the real source (export lists, import graphs, route handlers) — every claim below was verified against a real file, not inferred. If this doc and the source ever disagree, the source is correct; treat the disagreement as a doc bug to fix, not a spec violation to reconcile the code toward. See `docs/DOC_LINT.md` before editing.

---

## 1. How to read this document

- **§2** is the API surface — every route, its methods, and its auth guard.
- **§3–4** are the shared library layers — `lib/*.ts` (framework-agnostic domain logic) and `app/lib/*.ts` (App-Router-coupled / Mongo-orchestration logic). The split between them is a real, load-bearing distinction (§4.1).
- **§5** is the UI component tree and its data-fetching convention.
- **§6** is every brand-scoped page and what it calls.
- **§7** is the data model — every collection's real document shape.
- **§8** is cross-cutting concerns (brand/tenant scoping, the auth layering, taxonomy enforcement) — read this if you're touching more than one module and need to know what already threads through all of them.
- **§9** records known type/reality gaps not yet fixed. **§10** covers how GitHub issue management/tooling actually works here, and points to `docs/ISSUE_MANAGEMENT.md` for full detail.

---

## 2. `app/api/**/route.ts` — Every API Route

Every route imports `NextResponse`/`NextRequest` from `next/server`. The **Auth** column names the actual guard call found in the file — see §8.2 for what each one means and why there are five distinct ones.

### Leads core

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/leads/route.ts` | GET, POST, PATCH | `requireBrandAccessApi` (all three methods) | List/create/patch leads for a brand+tenant; POST runs `validateLeadPayload`, `deriveKanbanColumn`, `buildFingerprint`; PATCH runs `executeLeadAction` (single source of truth for lead mutations, shared with bulk) |
| `app/api/leads/[id]/route.ts` | GET, PUT, DELETE | `requireApiKey` + `requireBrandAccessApi` | Full read/replace/delete of one lead; PUT re-derives kanban column, dedupes contacts, kicks off async `verifyLeadContactsAsync` + `computeTicketSizeForLead` |
| `app/api/leads/bulk/route.ts` | PATCH | `requireBrandAccessApi` (no `requireApiKey` — browser-callable) | Bulk lead actions via shared `executeLeadAction` (kanban multi-select bar) |
| `app/api/leads/columns/route.ts` | GET | `requireBrandAccessApi` | Paginated (50/chunk) per-column lead fetch for `app/kanban.tsx`'s column-by-column loading model |
| `app/api/leads/[id]/activity/route.ts` | GET, POST | `requireBrandAccessApi` | GET merges `activityLog` + `outreach_logs` into one timeline via `mergeActivityTimeline`; POST logs a manual `type: 'call'` entry (closed `CallDisposition` enum, `loggedBy` from the verified session, issue #200) — also touches `Lead.updatedAt` so it counts toward staleness |
| `app/api/leads/[id]/cadence/route.ts` | POST, DELETE | `requireBrandAccessApi` | Enroll/cancel a lead's `activeCadence` via `buildInitialActiveCadence` |

### Saved filters (issue #214)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/saved-filters/route.ts` | GET, POST | `requireBrandAccessApi` + a real session (401 for an `x-api-key`-only caller — see `docs/ARCHITECTURE.md`) | List the caller's own + brand-shared saved filters (`canShare` flag included); create/replace-in-place a saved filter via `upsertSavedFilter` |
| `app/api/saved-filters/[id]/route.ts` | PATCH, DELETE | same | Owner-only sharing toggle / delete; 403 for a non-owner (even a brand/super admin), 404 for a cross-brand id |
| `app/api/saved-filters/import/route.ts` | POST | same | One-time bulk import of a browser's pre-#214 `localStorage` saved filters; `sharedWithBrand` always forced `false` |

### Boards / forecast / metrics

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/boards/route.ts` | GET | `requireApiKey` (fixed, issue #178 — previously none) | Legacy multi-brand board summary (has its own inlined `getTenantId`/`tenantFilter` — a real inconsistency, see §8.1) |
| `app/api/boards/[brand]/route.ts` | GET | `requireBrandAccessApi` (fixed, issue #192 — previously none) | Per-brand board summary + calls `app/lib/forecast.ts`'s `computeForecast` |
| `app/api/forecast/export/route.ts` | GET | `requireBrandAccessApi` (fixed, issue #192 — previously none) | CSV/export of `computeForecast()` output for one brand |
| `app/api/metrics/route.ts` | GET | `requireBrandAccessApi` (fixed, issue #192 — previously none) | Pipeline metrics; wraps `computeVelocity` (`app/lib/velocity-metrics.ts`) and `correlateOutcomes` (`lib/outcome-correlation.ts`) |
| `app/api/metrics/by-source/route.ts` | GET | `requireBrandAccessApi` (fixed, issue #192 — previously none) | Win-rate-by-acquisition-`source` aggregation |
| `app/api/metrics/decline-reasons/route.ts` | GET | `requireBrandAccessApi` (fixed, issue #192 — previously none) | Decline-reason rollup via `app/lib/decline-reason-rollup.ts` |
| `app/api/stats/route.ts` | GET | `requireApiKey` (fixed, issue #178 — previously none) | Legacy stats endpoint using `getPipelineWeights` |
| `app/api/win-rates/route.ts` | GET | `requireBrandAccessApi` (fixed, issue #192 — previously none) | Lazy-recompute cached win-rate calibration (`app/lib/win-rate-store.ts`'s `getOrRecomputeWinRates`) |
| `app/api/win-rates/recalculate/route.ts` | POST | `requireApiKey` | Forced win-rate recompute, ignoring cache staleness |
| `app/api/ticket-size-calibration/route.ts` | GET | `requireBrandAccessApi` (fixed, issue #192 — previously none) | Lazy-recompute cached ticket-size calibration |

### Contacts / duplicates / email

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/contacts/route.ts` | GET | `requireBrandAccessApi` | Cross-lead contact directory search via `aggregateContactsAcrossLeads` |
| `app/api/contact-suggestions/route.ts` | GET | `requireBrandAccessApi` | List pending inbound-reply contact-match suggestions |
| `app/api/contact-suggestions/[id]/route.ts` | PATCH | `requireBrandAccessApi` | Approve/reject a contact suggestion; merges into `lead.contacts` via `dedupeContacts` |
| `app/api/duplicate-reviews/route.ts` | GET, PATCH | `requireSuperAdminSession` | List/act on the duplicate-review queue (issue #73) |
| `app/api/duplicate-reviews/merge/route.ts` | GET, POST | `requireSuperAdminSession` | Executes a confirmed merge via `lib/lead-merge.ts`'s `diffLeads`/`buildMergedLead`/`suggestPrimaryId` |
| `app/api/admin/duplicate-scan/route.ts` | POST | `requireSuperAdminSession` | Runs `findCandidatePairs` (`lib/near-duplicate.ts`), capped-count O(n²) scan |
| `app/api/webhooks/inbound-email/route.ts` | POST | Resend webhook signature (`verifyResendWebhook`) | Inbound email ingestion: writes `ActivityLogDocument`, runs `matchReplyToLeads`/`generateContactSuggestion` |

### Outreach / cadences / battlecards

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/cadences/route.ts` | GET, POST | `requireBrandAccessApi` (since 2.4.227, issue #227) | List/create cadence templates (`lib/cadences.ts`) |
| `app/api/cadences/[id]/route.ts` | GET, PUT, DELETE | `requireBrandAccessApi` (since 2.4.227, issue #227); lookups filtered by brand | Single cadence CRUD |
| `app/api/admin/cadence-tick/route.ts` | GET, POST | `requireCronOrApiKey` / `requireApiKey` | Cron worker: advances every lead's `activeCadence`, sends due steps via `sendAutomatedEmail` |
| `app/api/automation-rules/route.ts` | GET, POST | `requireBrandAccessApi` (since 2.4.227, issue #227) | List/create automation rules (`lib/automation-rules.ts`, issue #201) |
| `app/api/automation-rules/[id]/route.ts` | GET, PUT, DELETE | `requireBrandAccessApi` (since 2.4.227, issue #227); lookups filtered by brand | Single automation rule CRUD |
| `app/api/admin/automation-tick/route.ts` | GET, POST | `requireCronOrApiKey` / `requireApiKey` | Cron worker: evaluates `stale_no_activity` rules (`app/lib/automation-store.ts`'s `runStaleTickForBrand`) |
| `app/api/reports/route.ts` | GET, POST | `requireBrandAccessApi` | List/create ad-hoc report definitions (`lib/report-definitions.ts`, issue #212) |
| `app/api/reports/[id]/route.ts` | GET, PATCH, DELETE | `requireBrandAccessApi` | Single report definition CRUD |
| `app/api/reports/[id]/run/route.ts` | POST | `requireBrandAccessApi` | Executes a definition's pipeline now (`app/lib/report-store.ts`'s `runReportDefinition`) |
| `app/api/admin/reports-tick/route.ts` | GET, POST | `requireCronOrApiKey` / `requireApiKey` | Cron worker: sends due scheduled report emails via `lib/report-delivery.ts` |
| `app/api/outreach-logs/route.ts` | GET, POST | GET `requireApiKey` (since 2.4.226, issue #226); POST `requireBrandAccessApi` (since 2.4.227, issue #227) | Record-only outreach log, never sends; POST runs `evaluateOutreachRouting` |
| `app/api/outreach-send/route.ts` | POST | `requireBrandAccessApi` (since 2.4.227, issue #227) | Real, one-off rep-initiated email send via Resend (`lib/outreach-send.ts`'s `sendManualEmail`, issue #205); recipients come from the stored lead in that brand's collection, never the request body |
| `app/api/outreach-templates/route.ts` | GET, POST | `requireBrandAccessApi` (since 2.4.227, issue #227) | Template CRUD, seeded from `DEFAULT_OUTREACH_TEMPLATES`; GET annotates with `computeTemplateConversions` |
| `app/api/outcome-logs/route.ts` | GET, POST | `requireApiKey` | Stage-transition outcome log (drives win-rate/velocity calibration) |
| `app/api/battlecards/route.ts` | GET, POST | `requireBrandAccessApi` (since 2.4.227, issue #227); `?brand=` required | List/create competitor battlecards, seeded from `DEFAULT_BATTLECARDS` |
| `app/api/battlecards/[id]/route.ts` | GET, PUT, DELETE | `requireBrandAccessApi` (since 2.4.227, issue #227); lookups filtered by brand | Single battlecard CRUD |

### Settings / taxonomy / search

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/settings/route.ts` | GET, PUT | GET: none; PUT: `requireApiKeyOrSession` (fixed, issue #192 — previously none) | `settings` collection: pipeline weights, stale thresholds, concentration risk, forecast calibration |
| `app/api/sales-settings/[brand]/route.ts` | GET, PUT | `requireBrandAccessApi` (since 2.4.226, issue #226; previously none) | Per-brand `SalesSettings` document (`company_settings` collection), sanitized via `sanitizeSalesSettings` |
| `app/api/lead-taxonomy/route.ts` | GET | none | Serves `lib/lead-taxonomy.ts`'s controlled vocabularies live so the external enrichment-agent prompt never drifts from code |
| `app/api/search/route.ts` | GET | `requireBrandAccessApi` when `brand` given; `requireSuperAdminSession` (no `x-api-key` bypass) for the no-brand cross-all-brands mode (fixed, issue #192 — previously none) | Regex-escaped (`escapeRegExp`) free-text lead search |
| `app/api/search-learning/route.ts` | GET, POST | GET: none; POST: `requireApiKeyOrSession` (fixed, issue #192 — previously none); string-only inputs since 2.4.229 (issue #229) | "Search memory" — tracks which search queries/domains produced good leads |
| `app/api/prompts/route.ts` | GET, PUT | `requireSuperAdminSession` | Reads/writes external research-agent prompt files under `../Agents/contentcreator/prompts` |

### Auth / SSO

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/auth/login/route.ts` | GET | none (public) | Builds PKCE authorize URL via `lib/sso.ts`, sets short-lived oauth cookies |
| `app/api/auth/logout/route.ts` | POST | none | Clears SSO cookies, returns hosted-SSO logout URL |
| `app/api/auth/session/route.ts` | GET | id-token cookie | Read-only session/permission check, called by `AuthProvider` on every page |
| `app/api/oauth/callback/route.ts` | GET | none (PKCE state check) | Exchanges code for tokens, `upsertUserSeen`, redirects via `resolveLoginDestination` |

### Admin

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/admin/users/route.ts` | GET | `requireSuperAdminSession` | List all users + org access for `/admin/users` |
| `app/api/admin/users/[userId]/access/route.ts` | PUT | `requireSuperAdminSession` | Grant/revoke per-brand role via `setUserOrgAccess` |
| `app/api/admin/toggle/route.ts` | PUT, GET | `requireSuperAdminSession` | Reads/writes a feature-flag-style JSON file on disk |
| `app/api/admin/data-hygiene/route.ts` | GET | `requireApiKey` | Data-quality scan (missing `PRO_FIELD`/`CON_FIELD` etc.) |
| `app/api/admin/cron-status/route.ts` | GET | `requireApiKey` | Health/last-run status per brand from `outcomelogs` |
| `app/api/admin/forecast-snapshot/route.ts` | GET, POST | `requireCronOrApiKey` / `requireApiKey` | Cron worker writing weekly `forecast_snapshots` via `discoverTenantIds`/`writeForecastSnapshot` |
| `app/api/admin/forecast-snapshot/history/route.ts` | GET | `requireApiKey` | Historical snapshot series for a future trend chart |
| `app/api/admin/ticket-size-backfill/route.ts` | POST | `requireApiKey` | One-time backfill trigger, `backfillTicketSizeCollection` |
| `app/api/admin/ticket-size-recalc/route.ts` | GET, POST | `requireCronOrApiKey` / `requireApiKey` | Recurring recompute across every configured brand |

### Misc

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/health/route.ts` | GET | none | Liveness/DB-connectivity + per-brand snapshot freshness check |
| `app/api/auth/tour/route.ts` | POST | `resolveSessionFromIdToken` (session only, not `requireSuperAdminSession` — any logged-in user marks their own tour seen) | Issue #185: sets `SsoUserAccessRecord.tourSeenAt` via `lib/sso-access.ts`'s `markTourSeen` |
| `app/api/admin/clients/route.ts` | GET, POST | `requireSuperAdminSession` | Issue #196: the "add a client" UI on top of #195's Mongo-backed `brands` registry — `getAllBrandConfigs`/`createBrand` (`app/lib/brand.ts`) |

### Lead ownership, teams, and bulk actions v2 (issues #198, #199, #203, #206)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/leads/assignable-users/route.ts` | GET | `requireBrandAccessApi` | Issue #198: users eligible for `ASSIGN`, scoped to brand access |
| `app/api/leads/bulk/undo/route.ts` | POST | `requireBrandAccessApi` | Issue #203: reverses a bulk `FIELD_EDIT`/`ASSIGN` via a 15s-window, CAS-checked `bulkActionUndoTokens` document (`lib/bulk-undo.ts`) |
| `app/api/admin/teams/route.ts` | GET, POST | `requireSuperAdminSession` | Issue #199: list/create teams (`lib/teams.ts`) |
| `app/api/admin/teams/[teamId]/route.ts` | PATCH, DELETE | `requireSuperAdminSession` | Issue #199: update (rename/re-manage/re-member)/delete a team |
| `app/api/admin/buying-role-backfill/route.ts` | POST | `requireApiKey` | Issue #206: one-time backfill deriving `Contact.buyingRole` from the retired `isDecisionMaker`-only model (`lib/backfill-buying-role.ts`) |

### Accounts rollup, quota, and ad-hoc reports (issues #204, #209, #212)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/accounts/route.ts` | GET | `requireBrandAccessApi` | Issue #209 Phase 1: read-only rollup grouping a brand's own leads by `parentOrgId` — no new collection (`lib/accounts.ts`'s `computeAccountRollups`), capped at `MAX_ACCOUNTS_SCAN` (5000) |
| `app/api/accounts/[parentOrgId]/route.ts` | GET | `requireBrandAccessApi` | Issue #209: single account's full detail/lead list (`computeAccountDetail`) |
| `app/api/quota/[brand]/route.ts` | GET, PUT | `requireSuperAdminSession` | Issue #204: read/set `quota_targets` (`lib/quota.ts`'s `getQuotaTarget`/`setQuotaTarget`) |
| `app/api/quota/[brand]/attainment/route.ts` | GET | `requireBrandAccessApi` | Issue #204: WON-lead/`outcomelogs` join computing attainment against the active quota (`app/lib/quota-store.ts`'s `getQuotaAttainment`) |

*(`app/api/reports/**`/`app/api/admin/reports-tick` were already covered above — issue #212 shipped alongside this batch but its routes predate this backfill pass in this doc.)*

### Scoped API keys and outbound webhooks (issue #210 and its sub-issues #219/#220)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/admin/api-keys/route.ts` | GET, POST | `requireSuperAdminSession` (never `x-api-key`) | Issue #210 Phase 1: list/issue per-brand, per-scope revocable API keys (`lib/scoped-api-keys.ts` + `app/lib/api-key-store.ts`); `POST` returns the raw key exactly once |
| `app/api/admin/api-keys/[id]/route.ts` | DELETE | `requireSuperAdminSession` | Revoke a key — fails closed immediately, no "unrevoke" |
| `app/api/admin/webhooks/route.ts` | GET, POST | `requireSuperAdminSession` (never `x-api-key`) | Issue #219: list/register outbound webhook subscriptions (`lib/webhooks.ts` + `app/lib/webhook-store.ts`); `POST` rejects private/reserved/loopback/metadata target URLs (reuses `lib/tech-stack-scan.ts`'s `isPrivateOrReservedIp`) and returns the signing secret exactly once |
| `app/api/admin/webhooks/[id]/route.ts` | DELETE, PATCH | `requireSuperAdminSession` | Hard-delete a subscription / `{enabled}` toggle (manual re-enable after auto-disable) |
| `app/api/admin/webhook-delivery-tick/route.ts` | GET, POST | `requireCronOrApiKey` / `requireApiKey` | Hourly cron worker: `app/lib/webhook-store.ts`'s `processWebhookDeliveries` — signs and POSTs due `webhook_deliveries`, applies the 1m/5m/30m/2h/12h retry schedule and 5-consecutive-exhausted auto-disable |

*(Existing `app/api/leads/**`/`app/api/admin/*-tick` routes above already gained scoped-key support via `requireBrandAccessApi`/`requireCronOrApiKey` — no new routes, see §8.2.)*

### Deals: quote generation (issue #211)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/leads/[id]/quotes/route.ts` | GET, POST | `requireBrandAccessApi` | List a lead's quotes / generate a new PDF quote (renders via `lib/quote-pdf.tsx`, uploads via `lib/blob-storage.ts`'s `uploadQuotePdf` under `access: 'private'`, inserts via `app/lib/quotes-store.ts`'s `createQuote`) |
| `app/api/leads/[id]/quotes/[quoteId]/send/route.ts` | POST | `requireBrandAccessApi` | `draft`/`sent` → `sent`; reuses `lib/outreach-send.ts`'s Resend path via the new `sendQuoteEmail()` (`'quote'` source kind) |
| `app/api/leads/[id]/quotes/[quoteId]/mark-signed/route.ts` | POST | `requireBrandAccessApi` | Rep-side manual `sent`/`viewed` → `signed` override |
| `app/api/quotes/[quoteId]/view/route.ts` | GET | **none — the first genuinely public route this repo shipped** (gated exclusively on the random `?token=` query param, never `quoteId` alone) | Public share view: validates `shareToken`, rate-limited (`checkQuoteViewRateLimit`), flips `sent → viewed` once, streams the PDF bytes server-side (the Blob location itself is never exposed) |

### Meeting scheduler (issue #207)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/schedule/[brand]/availability/route.ts` | GET | **none — public**, per-IP+brand rate-limited (`checkAndRecordRateLimit`) | Real Google Calendar free/busy-derived open slots (`lib/scheduling.ts`'s `computeAvailableSlots`); returns only start/end boundaries, never event detail |
| `app/api/schedule/[brand]/book/route.ts` | POST | **none — public**, same rate limit | Books a slot; race-safe via a short-lived unique-indexed `scheduling_slot_claims` document (closes the two-prospects-same-slot TOCTOU race) |
| `app/api/scheduling-settings/[brand]/route.ts` | GET, PUT | `requireBrandAccessApi` | Weekday/hours/slot-length/buffer configuration (`app/lib/scheduling-store.ts`) |

### Third-party integration hub, Gmail/Contacts sync (issues #217, #216)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/integrations/connections/route.ts` | GET | `requireBrandAccessSession` | List a brand's connections, never returns `encryptedCredentials` (`app/lib/integration-store.ts`'s `listConnections`) |
| `app/api/integrations/[provider]/connect/route.ts` | GET, POST | `requireBrandAccessSession` | GET starts the OAuth2 authorize redirect (Google providers) or validates+stores an API key (Calendly); POST variant for the API-key path |
| `app/api/integrations/oauth/callback/route.ts` | GET | `requireBrandAccessSession` + single-use server-side state record (`integration_oauth_states`) + cookie `state` match (since 2.4.228, issue #228; was the cookie check only) | Exchanges the OAuth code, `upsertOAuthConnection`, redirects back to the integrations settings page |
| `app/api/integrations/connections/[id]/disconnect/route.ts` | POST | `requireBrandAccessSession` (against the connection's own stored brand) | Revokes/clears a connection's `encryptedCredentials` |
| `app/api/integrations/connections/[id]/test/route.ts` | POST | `requireBrandAccessSession` | Live credential-validity check (`app/lib/integration-store.ts`'s `testConnection`) |
| `app/api/integrations/gmail/sync/route.ts` | GET, POST | `requireCronOrApiKey` / `requireApiKey` | Hourly cron: polls Gmail for known-contact correspondence (`app/lib/gmail-sync-store.ts`'s `pollGmailForBrand`), ingests into `activityLog` |
| `app/api/integrations/google-contacts/search/route.ts` | GET | `requireBrandAccessApi` | Search-as-you-type against Google Contacts (`app/lib/google-contacts-store.ts`) |
| `app/api/leads/[id]/contacts/import-google/route.ts` | POST | `requireBrandAccessApi` | Rep-initiated "Import from Google Contacts" onto one lead |

### Catalog: products (issue #215)

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/products/[brand]/route.ts` | GET, POST | `requireBrandAccessApi` (since 2.4.226, issue #226; previously none) | List/create a brand's priced catalog line items (`app/lib/products.ts`'s `sanitizeProduct(s)`) |
| `app/api/products/[brand]/[productId]/route.ts` | PATCH, DELETE | `requireBrandAccessApi` (since 2.4.226) | Update/delete one product |
| `app/api/admin/products-backfill/route.ts` | POST | `requireApiKey` | One-time idempotent backfill promoting Sales Settings' free-text `ProductLine[]` into the priced catalog (`lib/backfill-products.ts`) |

---

## 3. `lib/*.ts` — Shared Library Modules

Framework-agnostic domain/business logic — pure functions and Mongo document shapes with no App-Router or UI concern. Grouped by what they're actually for, not alphabetically.

**Auth / session / tenancy** (cross-cutting — see §8.1–8.2 for how these thread through everything)
- `lib/api-auth.ts` — `requireApiKey`, `isCronRequest`, `requireCronOrApiKey`
- `lib/require-brand-access-api.ts` — `requireBrandAccessApi`
- `lib/require-brand-access.ts` — `requireBrandAccess` (Server Component page gate, calls `redirect()`)
- `lib/session.ts` — `resolveSessionFromIdToken`, `requireSuperAdminSession`
- `lib/sso.ts` — PKCE/OIDC primitives: `isSsoConfigured`, `generateCodeVerifier/Challenge/State`, `buildAuthorizeUrl`, `exchangeCodeForTokens`, `refreshTokens`, `verifyIdToken`, `getPermission`, `SSO_BASE_URL`
- `lib/sso-access.ts` — org/brand access model: `OrgAccessMap`, `SsoUserAccessRecord`, `isSuperAdminEmail`, `upsertUserSeen`, `getUserAccess`, `listAllUserAccess`, `setUserOrgAccess`, `getAccessibleBrands`, `hasAccessToBrand`, `getRoleForBrand`, `resolveLoginDestination`, `markTourSeen` (issue #185, sets `SsoUserAccessRecord.tourSeenAt`)
- `lib/tenant.ts` — `getTenantId`, `tenantFilter`
- `lib/mongodb.ts` — `isMongoConfigured`, `getClientPromise`, default export `clientPromise`
- `lib/scoped-api-keys.ts` — issue #210 Phase 1, pure: `generateRawApiKey` (`slg_` + 32 random bytes), `hashApiKey` (SHA-256, the only form ever persisted), `keyPrefixOf`, `validateCreateApiKeyInput`, `evaluateScopedKeyAuth` (brand/scope/revocation decision), `requiredScopeForMethod` (GET/HEAD → `read`, else `read-write`)
- `lib/webhooks.ts` — issue #219, pure: `WebhookEventType`, `VALID_WEBHOOK_EVENT_TYPES`, `generateWebhookSecret` (`whsec_` prefix), `parseWebhookUrl` (https-only shape check), `validateCreateWebhookInput`, `signWebhookPayload`/`verifyWebhookSignature` (HMAC-SHA256, mirrors `lib/resend-webhook.ts`'s inbound shape outbound), `RETRY_SCHEDULE_SECONDS`/`nextRetryDelaySeconds`/`isDeadLetterThresholdReached`
- `lib/integration-crypto.ts` — issue #217, AES-256-GCM at rest via `INTEGRATION_CREDENTIALS_ENCRYPTION_KEY`: `encryptCredentials`, `decryptCredentials`, `isIntegrationEncryptionConfigured`, `IntegrationEncryptionKeyError` (fails closed unconditionally, not just in production — no safe "open" fallback for a real third-party credential). Reused unchanged by issue #219's webhook signing secret rather than a second encryption key.
- `lib/require-brand-session.ts` — `requireBrandAccessSession` (Route Handler guard requiring a real session, no `x-api-key` fallback — distinct from `require-brand-access-api.ts`'s `requireBrandAccessApi`, which accepts either; used where the caller must be a human with brand access, e.g. the integrations hub)

**Taxonomy / classification**
- `lib/lead-taxonomy.ts` — controlled vocab: `SPORT_CODES`, `SPORT_ALIASES`, `resolveSportAlias`, `ORG_TYPE_CODES`, `BUSINESS_UNIT_CODES`, `GENDER_CODES`, `DEMOGRAPHIC_CODES`, `COMPETITION_LEVEL_CODES`, `RELATIONSHIP_CODES`, each with a `*_SET` and `isValid*Code` guard, plus `slugifyForTag`
- `lib/lead-classification.ts` — `generateClassificationTags`, `buildMergeKey`
- `lib/title-normalization.ts` — `SeniorityTier`, `Department`, `TitleClassification`, `normalizeTitle`

**Lead ownership, teams, buying committee** (issues #198, #199, #206)
- `lib/lead-assignment.ts` — issue #198: `canAssign` (self-assign always allowed; cross-user reassignment gated to brand admins), `resolveAssignedToFilter`/`combineFilterWithAssignedTo` (`assignedTo=me|unassigned|<ssoUserId>|team` filter clauses)
- `lib/teams.ts` — issue #199: `Team`, `listTeamsForBrand`, `getTeam`, `createTeam`, `updateTeam`, `deleteTeam`, `getManagedAssigneeIds`/`managesAnyTeam` (a manager's team membership resolves to which `assignedTo` values their "My Team" filter covers), `getTeamVisibilityFilter`
- `lib/backfill-buying-role.ts` — issue #206: `backfillBuyingRoleCollection`, deriving `Contact.buyingRole` for every existing contact from the retired `isDecisionMaker`-only model (`isDecisionMaker` is now permanently DERIVED from `buyingRole`, never independently authoritative)

**Contacts**
- `lib/contacts.ts` — `normalizePhone`, `normalizeEmail`, `toNameCase`, `normalizeContact`, `contactKey`, `verifiableFieldsDiffer`, `dedupeContacts`, `deriveContactEmails`, `ensureContactEmailsIndex`, `getDecisionMakerContact`, `aggregateContactsAcrossLeads`
- `lib/field-verifications.ts` — `FieldVerification`, `FieldVerificationScope` (`'lead'|'contact'`), `MAX_FIELD_VERIFICATIONS`, `isContactFieldPath`, `validateFieldVerifications`, `normalizeFieldVerifications` — per-field "verified by X at time Y" provenance tracking, independent of the taxonomy `classificationConfidence`/`classificationEvidence` fields
- `lib/contact-freshness.ts` — `isContactStale`, `staleContactRatio`, `DEFAULT_STALENESS_THRESHOLD_DAYS`
- `lib/email-verification.ts` — `isRoleAccount`, `isFreeProvider`, `extractDomain`, `lookupMx`, `checkDomain`, `statusFromMxResult`, `verifyEmail`
- `lib/contact-reply-matching.ts` — `CONTACT_SUGGESTIONS_COLLECTION`, `ContactSuggestionDocument`, `matchReplyToLeads`, `findMatchedContact`, `generateContactSuggestion`, `ensureContactSuggestionsIndexes`
- `lib/signature-parser.ts` — `parseSignatureBlock`
- `lib/migrate-decision-maker.ts` — one-time migration: `looksLikeEmail/Phone`, `migrateDecisionMakerCollection`

**Ticket size / deals / forecast math**
- `lib/ticket-size.ts` — `TicketSizeMethod/Confidence/Tier`, `TicketSizeEstimate`, `TicketSizeInputs`, `DealSizeBands`, `estimateTicketSize`, `createManualTicketSizeOverride`
- `lib/ticket-size-calibration.ts` — `computeTicketSizeCalibration`, `DEFAULT_MIN_SAMPLE_SIZE`
- `lib/backfill-ticket-size.ts` — `backfillTicketSizeCollection`
- `lib/deals.ts` — `Deal`, `sanitizeDeal`, `sanitizeDeals`, `sumDeals`
- `lib/quotes.ts` — issue #211, pure: `QuoteStatus` (`draft→sent→viewed→signed`, `sent→signed` also directly allowed), `Quote`, `QuoteLineItem`, `PublicQuote`/`toPublicQuote` (strips `pdfBlobPath`/`shareToken` for the public view), `buildLineItemFromDeal`, `sumLineItems`, `isValidStatusTransition` (the state-machine guard — no transition ever moves status backward)
- `lib/quote-pdf.tsx` — issue #211: `QuoteDocument` (`@react-pdf/renderer` component, real extractable text, never rasterized), `renderQuotePdf()`. Colors sourced from `lib/theme/quote-pdf-colors.ts` (not `@sovereignsquad/gds-theme` directly — importing that package's `/server` export broke a real production build, see `docs/LESSONS_LEARNED.md` item 21)
- `lib/blob-storage.ts` — issue #211: `isBlobConfigured`, `uploadQuotePdf` (Vercel Blob, `access: 'private'` — a deliberate improvement over the issue's own `access: 'public'` pseudocode), `fetchQuotePdf`
- `lib/accounts.ts` — issue #209 Phase 1, pure: `AccountRollup`, `AccountDetail`, `groupLeadsByParentOrg`, `buildAccountRollup`, `computeAccountRollups`, `computeAccountDetail` — no new collection, a computed view over `Lead.parentOrgId`
- `lib/scheduling.ts` — issue #207, pure, DST-correct (`dayjs` `utc`/`timezone` plugins): `AvailabilityWindow`, `Slot`, `computeAvailableSlots`, `isSlotStillAvailable` (freshness re-check before booking), `isRateLimited`, `isValidAvailabilityWindow`
- `lib/integration-connections.ts` — issue #217, pure: `IntegrationProvider` (`google_calendar`/`gmail`/`google_contacts`/`calendly`), `IntegrationConnection`, `OAUTH_PROVIDERS`/`API_KEY_PROVIDERS`, `oauthConfigFor`/`apiKeyConfigFor`, `buildGoogleAuthorizeUrl`, `PROVIDER_LABELS`
- `lib/integration-http.ts` — issue #217: `fetchWithRetry` (10s timeout, 429/5xx backoff — the shared outbound-HTTP helper the scheduler's real Google Calendar API v3 calls and the integration hub's own credential-test calls both use)
- `lib/backfill-products.ts` — issue #215: `backfillProductsForBrand`, one-time idempotent promotion of Sales Settings' free-text `ProductLine[]` into the priced `products` catalog, never clobbers a manually-edited row
- `lib/pipeline-weights.ts` — `DEFAULT_PIPELINE_WEIGHTS`, `getPipelineWeights`
- `lib/pipeline-coverage.ts` — `computeCoverage`, `Coverage`, `CoverageBenchmark`
- `lib/forecast-concentration.ts` — `computeConcentration`, `getConcentrationRiskSettings`, `DEFAULT_CONCENTRATION_*`
- `lib/win-rate-calibration.ts` — `computeWinRatesFromLogs`, `mergeCalibratedWeights`, `getForecastCalibrationSettings`, `CALIBRATABLE_STAGES`
- `lib/forecast-category.ts` — `ForecastCategory`, `resolveDefaultCategory`, `effectiveForecastCategory`, `computeCategoryForecast`, `getForecastCategoryWeights` (issue #204)
- `lib/quota.ts` — `PeriodType`, `isValidPeriod`, `periodToDateRange`, `dealValueForLead`, `computeAttainmentFromWonLeads`, `getQuotaTarget`, `setQuotaTarget` (issue #204); `app/lib/quota-store.ts` — `getQuotaAttainment` (the WON-lead/outcomelogs Mongo join)
- `lib/report-pipeline.ts` — `validateReportInput`, `buildReportPipeline`, `shapeReportRows`, `resolveDateRange` (issue #212, pure allowlist-validated Mongo pipeline builder); `lib/report-definitions.ts` — `ReportDefinition`, `ReportSchedule`, `validateReportDefinitionInput`, `buildReportDefinition`, `validateAndBuildSchedule`, `computeNextRunAt`; `lib/report-delivery.ts` — `sendReportEmail`, `renderReportEmailHtml`, `isReportDeliveryConfigured`; `app/lib/report-store.ts` — `runReportDefinition`, `ensureReportIndexes`, `ensureLeadReportIndexes` (the Mongo-aware layer)

**Cadences / outreach**
- `lib/cadences.ts` — `Cadence`, `CadenceStep`, `ActiveCadence`, `sanitizeCadence(Step/Steps)`, `validateCadence`, `computeStepDueAt`, `buildInitialActiveCadence`, `advanceActiveCadence`
- `lib/automation-rules.ts` — `AutomationRule`, `AutomationTrigger`, `AutomationAction`, `sanitizeAutomationRule`, `validateAutomationRule`, `computeSetNextActionFields`, `buildNotificationLogEntry`, `matchesEventTrigger` (issue #201); `app/lib/automation-store.ts` — `evaluateEventRules`, `runStaleTickForBrand`, `applyAction`, `ensureAutomationIndexes` (the Mongo-aware evaluation layer)
- `lib/outreach-send.ts` — `isResendSendConfigured`, `resolveOutboundFromAddress`, `dispatchOutreachEmail` (shared core), `sendAutomatedEmail` (cadence wrapper), `sendManualEmail` (rep-initiated wrapper, issue #205)
- `lib/resend-webhook.ts` — `extractResendWebhookHeaders`, `verifyResendWebhook`, `isResendConfigured`
- `lib/gmail-sync.ts` — issue #216, pure: `buildGmailExternalId`, `buildFallbackHash`, `floorToMinuteIso`, `participantsIntersectKnownEmails` (headers-only-then-body-on-match gate), `resolveGmailDirection`, `resolveCounterpartyEmail`
- `lib/template-conversion.ts` — `computeTemplateConversions`

**Dedup / merge**
- `lib/near-duplicate.ts` — `normalizeForMatch`, `similarity`, `findCandidatePairs`
- `lib/lead-merge.ts` — `FieldClassification`, `suggestPrimaryId`, `diffLeads`, `buildMergedLead`
- `lib/fingerprint.ts` — `buildFingerprint`

**Validation / kanban / stage logic**
- `lib/validate-lead.ts` — `ValidationResult`, `EMAIL_RE`, `FORBIDDEN_BRAND_TERMS`, `findForbiddenBrandTerms`, `bestContactConfidence`, `validateLeadPayload`, `validatePatchPayload`
- `lib/kanban-column.ts` — `AUTO_MANAGED_COLUMNS`, `QUALIFIED_ICE_THRESHOLD`, `deriveKanbanColumn`, `isAutoManagedColumn`, `ICE_SCORE_AGGREGATION_EXPR`
- `lib/kanban-reorder.ts` — issue #208, pure: `computeReorderSortOrder`/`resolveReorderNeighbors` (fractional-indexing same-column reorder), `NEEDS_RESEQUENCE` (degenerate-case fallback triggering a bounded whole-column resequence once float64 precision is exhausted), `decideMoveItemAction` (`'cross-column'|'auto-managed-reject'|'reorder'`)
- `lib/bulk-undo.ts` — issue #203: `UNDO_COLLECTION` (`bulkActionUndoTokens`), `UNDO_WINDOW_MS` (15s), `BulkAction`, `fieldsWrittenBy`/`inverseCounterDelta` (what a bulk `FIELD_EDIT`/`ASSIGN` touched and how to reverse its counters), `deepEqual` (CAS check — undo only applies if nothing else changed the field since)
- `lib/card-tiering.ts` — issue #213: `shouldShowWinProbability` (kanban card information-hierarchy gate)
- `lib/command-palette-commands.ts` — issue #213: `LEAD_COMMAND_CAP` (200), `buildSalesBoardCommandDescriptors` — feeds GDS's real `CommandRegistryProvider`/`CommandPalette`
- `lib/wip-limits.ts` — issue #213: `DEFAULT_WIP_LIMITS`, `resolveWipThreshold`, `isOverWipLimit` — non-blocking kanban header badge, backed by `settings.wipLimits`
- `lib/stage-gate.ts` — `GATED_COLUMNS`, `isGatedColumn`, `checkStageGate`, `formatStageGateError`
- `lib/stale-deal.ts` — `DEFAULT_STALE_THRESHOLDS`, `computeStaleness`
- `lib/rotten-indicator.ts` — `computeRottenLevel`
- `lib/next-step-nudge.ts` — `getNextStepNudge`, `Nudge`, `NudgeId`
- `lib/score-profile.ts` — `computeIceScore`, `buildScoreProfile`
- `lib/checklist.ts` — `sanitizeChecklistItem`, `sanitizeChecklist`, `checklistProgress`
- `lib/create-lead-defaults.ts` — `MANUAL_LEAD_DEFAULT_ICE`

**Search / misc infra**
- `lib/public-data.ts` — `getPublicLeads`, `getPublicLeadById`
- `lib/outcome-correlation.ts` — `correlateOutcomes`
- `lib/quality-registry.ts` — `qualityCeilings`, `enforceQualityCeiling`, `calculateQualityScore`, `validateModification`, `determineQualityStatus`, `validateQualityDimensions`
- `lib/text-sanitize.ts` — `decodeHtmlEntities(InArray)`
- `lib/safe-identifier.ts` — `isSafeIdentifier`
- `lib/request-retry.ts` — `withRetry`
- `lib/tech-stack-scan.ts` — SSRF-guarded homepage scanner: `scanTechStack`, `matchSignatures`, `isPrivateOrReservedIp`, `parseTargetUrl`
- `lib/iso-week.ts` — `isoWeekKey`
- `lib/saved-filters.ts` — `LeadFilter`, `SavedFilter`, `isEmptyFilter`, `MAX_SAVED_FILTERS`, `addSavedFilter`, `removeSavedFilter` (the latter two now used only by the local-import migration path as of issue #214 — see `lib/saved-filters-store.ts` below for the primary, server-persisted store)
- `lib/saved-filters-store.ts` — server-persisted saved filters (issue #214): `SavedFilterRecord`, `SavedFilterListItem`, `listSavedFiltersForCaller`, `getSavedFilterById`, `upsertSavedFilter`, `setSavedFilterSharing`, `deleteSavedFilter`, `importLocalFilters`, plus pure `validateSavedFilterUpsert`/`pickOldestForEviction`
- `lib/backfill-title-normalization.ts` — one-time migration for `normalizeTitle`

---

## 4. `app/lib/*.ts` — App-Internal Lib Modules

### 4.1 Why this is a separate layer from `lib/*.ts`

`app/lib/*.ts` mixes **App-Router-coupled** and **brand/UI-adjacent** concerns. **Correction (2.4.196, found while implementing issue #205, previously stated here as strictly one-way):** the import direction is *predominantly* `app/lib/**` → `lib/**`, but a real, established minority of `lib/*.ts` modules import back from `app/lib/*.ts` — re-verified by grep, not assumed: `lib/outreach-send.ts` (`evaluateOutreachRouting`/`getBrandConfig`, and now also `app/lib/activity-log-store.ts`'s `truncateBody`/`ensureActivityLogIndexes` for issue #205's manual-send Activity-timeline write), `lib/contact-reply-matching.ts`, and `lib/validate-lead.ts` all cross back into `app/lib/`. `app/types.ts` itself imports `CurrencyCode` from `app/lib/brand.ts` and `ActiveCadence` from `lib/cadences.ts` — so `app/lib/brand.ts` is upstream even of the core `Lead` type, in the same file that also imports downstream from `lib/`. Read this as "mostly one-way, with a handful of disclosed exceptions where a `lib/` module's job genuinely needs an `app/lib/` concern (brand config, routing rules, activity-log writes)," not a hard invariant.

The concrete pattern that distinguishes the two layers: `lib/cadences.ts` has the pure `sanitizeCadence`/`advanceActiveCadence` logic, but `app/lib/` has **no** cadence store — that CRUD lives directly in `app/api/cadences/**`. Conversely, `app/lib/ticket-size-store.ts` / `app/lib/win-rate-store.ts` / `app/lib/ticket-size-calibration-store.ts` are the **Mongo-aware caching/orchestration layer** ("get cached doc, recompute if stale, persist") sitting on top of the pure calculators in `lib/ticket-size-calibration.ts` / `lib/win-rate-calibration.ts` — the `-store` suffix consistently marks this DB-orchestration role. `app/lib/brand.ts` and `app/lib/sales-settings.ts` also hold real UI-facing option lists (`CUSTOMER_TYPE_OPTIONS`, `BUYER_ROLE_OPTIONS`, etc.) that `lib/*.ts` never does.

### 4.2 The modules

- **`app/lib/brand-constants.ts`** — the actual home of `Brand` (`type Brand = string`), `PRO_FIELD`/`CON_FIELD`, `CurrencyCode`/`CURRENCY_CODE_OPTIONS`/`CURRENCY_CODES`/`CURRENCY_SYMBOLS`, `ForecastModel`, `BrandSalesVocabulary`, `BrandConfig`/`BrandRecord`, `FALLBACK_BRAND_CONFIG` — pure types/constants, no Mongo import, predating this doc's original 2.4.177 write-up (a real prior gap, not a new split) and already load-bearing for `lib/` modules that need brand constants without pulling in `app/lib/brand.ts`'s Mongo-aware accessors — issue #211's `lib/quote-pdf.tsx` imports `CURRENCY_SYMBOLS` from here directly, for exactly that reason
- **`app/lib/brand.ts`** — Mongo-backed as of issue #195, re-exports everything from `brand-constants.ts` plus the live accessors: `getBrandConfig`/`getAllBrandConfigs`/`getForbiddenTermsFor` (async, read the `brands` collection), `resolveBrand` (async), `createBrand` (issue #196, `/admin/clients`'s own write path) (63 files import from it as of this backfill, up from 51 at the #195 migration — see §8.1)
- `app/lib/activity-log-store.ts` — `ACTIVITY_LOG_COLLECTION`, `ActivityEntry`, `ActivityLogDocument`, `ensureActivityLogIndexes`, `mapOutreachLogToActivityEntry`, `mapActivityLogDoc`, `mergeActivityTimeline`
- `app/lib/forecast.ts` — `ForecastComputation`, `computeForecast(db, brand, tenantId)`
- `app/lib/forecast-snapshot.ts` — `FORECAST_SNAPSHOT_COLLECTION`, `discoverTenantIds`, `writeForecastSnapshot`
- `app/lib/velocity-metrics.ts` — `computeVelocity`, `VelocityMetrics`, `OutcomeLogRow`
- `app/lib/decline-reason-rollup.ts` — `buildDeclineMatchStage`, `shapeGroupedRows`, `shapeTotalsByReason`
- `app/lib/metrics.ts` — `metricsByStage`, `metricsByRegion`, `metricsByQuality`, `metricsByIceLevel` (legacy client-side metrics helpers)
- `app/lib/normalize-lead.ts` — `normalizeLead`, `ensureArrayField`, `extractWarnings`
- `app/lib/lead-actions.ts` — `executeLeadAction` (single mutation entrypoint shared by `/api/leads` PATCH and `/api/leads/bulk`)
- `app/lib/sales-settings.ts` — `SalesSettings` + sub-types (`ProductLine`, `DealSize`, `RevenueTarget`, etc.), `emptySalesSettings`, `sanitizeSalesSettings`, `getAllowedCustomerTypes/BuyerRoles` (as of issue #195 these take an explicit `salesVocabulary?: BrandSalesVocabulary` param, resolved by the caller via `getBrandConfig()`, rather than looking a brand up internally — `BRAND_SALES_VOCABULARY` no longer exists, replaced by each brand's own `salesVocabulary` field)
- `app/lib/email-verification-store.ts` — `verifyLeadContactsAsync`
- `app/lib/tech-stack-scan-store.ts` — `scanLeadTechStackAsync`
- `app/lib/ticket-size-store.ts` — `computeTicketSizeForLead`
- `app/lib/ticket-size-calibration-store.ts` — `TicketSizeCalibrationDoc`, `fetchWonLeadsForCalibration`, `computeAndPersistTicketSizeCalibration`, `getCachedTicketSizeCalibration`, `getOrRecomputeTicketSizeCalibration`, `isStale`
- `app/lib/win-rate-store.ts` — `WinRateDoc`, `fetchOutcomeLogs`, `computeAndPersistWinRates`, `getCachedWinRates`, `getOrRecomputeWinRates`, `isStale`
- `app/lib/inbound-email.ts` — `resolveBrandFromAddress/Recipients`, `resolveMatchedAddress`, `resolveDirection`, `buildActivityLogDoc`
- `app/lib/outreach/default-templates.ts` — `OutreachTemplate`, `DEFAULT_OUTREACH_TEMPLATES`, `interpolate`
- `app/lib/outreach/routing-rules.ts` — `Channel`, `OutreachRoutingRule`, `DEFAULT_ROUTING_RULES`, `evaluateOutreachRouting`
- `app/lib/battlecards/default-battlecards.ts` — `Battlecard`, `DEFAULT_BATTLECARDS`
- `app/lib/battlecards/validate-battlecard.ts` — `validateBattlecardPayload`, `normalizeProofPoints`, `normalizeObjections`
- `app/lib/search/tagged-content-filter.ts` — `escapeRegExp`, `normalizeTags`, `buildTaggedContentFilter` (shared by battlecards/outreach-templates/contacts/search/columns routes)
- `app/lib/request-id.ts` — `generateRequestId`
- `app/lib/saved-filters-storage.ts` — `loadSavedFilters`, `persistSavedFilters` (localStorage-backed, client-only). As of issue #214, this is no longer the primary saved-filters store (that's `lib/saved-filters-store.ts`, server-persisted) — it survives narrowly as the one-time local-import migration source, read once to offer the import and cleared only after a confirmed successful server import.
- `app/lib/use-is-compact-viewport.ts` — `useIsCompactViewport` (React hook, UI-only — could never live in `lib/`)
- `app/lib/use-is-fine-pointer.ts` — issue #213: `useIsFinePointer` (React hook, `matchMedia`-based — resolves only after a `useEffect`, unlike `use-is-compact-viewport.ts`'s synchronous `usePathname()`-based check; see `docs/LESSONS_LEARNED.md` for the remount/state-loss gotcha this distinction avoided for issue #207's `AppHeader`)
- `app/lib/api-key-store.ts` — issue #210 Phase 1, Mongo-aware layer over `lib/scoped-api-keys.ts`: `API_KEYS_COLLECTION`, `createApiKey`, `listApiKeys` (never returns `hashedKey`), `revokeApiKey`, `verifyScopedApiKey` (hashes, looks up, calls the pure decision function, updates `lastUsedAt` fire-and-forget)
- `app/lib/webhook-store.ts` — issue #219, Mongo-aware layer + the actual SSRF-guarded outbound delivery over `lib/webhooks.ts`: `WEBHOOKS_COLLECTION`/`WEBHOOK_DELIVERIES_COLLECTION`, `WebhookNetworkDeps` (injectable `resolveIp`/`performPost`, mirroring `lib/tech-stack-scan.ts`'s own testability pattern), `isWebhookUrlSafe`, `createWebhook`, `listWebhooks`, `deleteWebhook` (hard delete), `setWebhookEnabled`, `emitWebhookEvent` (enqueue-only), `processWebhookDeliveries` (the delivery worker's one tick)
- `app/lib/quotes-store.ts` — issue #211, Mongo-aware layer over `lib/quotes.ts`: `generateShareToken` (128-bit), `createQuote`, `listQuotesForLead`, `getQuoteById(ForTenant)`, `markQuoteSent`, `recordQuoteView`, `markQuoteSigned`, `fetchQuotePdfBytes`, `checkQuoteViewRateLimit` (DB-backed, 20/min per quote — reuses `scheduling-store.ts`'s TTL-indexed rate-limit pattern)
- `app/lib/scheduling-store.ts` — issue #207, Mongo-aware: `SCHEDULING_SETTINGS_COLLECTION`/`SCHEDULING_RATE_LIMITS_COLLECTION`/`SCHEDULING_SLOT_CLAIMS_COLLECTION`, `getSchedulingSettings`/`saveSchedulingSettings`, `checkAndRecordRateLimit`, `getAvailability`, `bookSlot` (race-safe via the slot-claims unique index)
- `app/lib/integration-store.ts` — issue #217, Mongo-aware: `INTEGRATION_CONNECTIONS_COLLECTION`, `isGoogleOAuthConfigured`, `listConnections` (never returns `encryptedCredentials`), `getConnectionById`/`getActiveConnectionByProvider`, `upsertOAuthConnection`/`upsertApiKeyConnection`, `disconnectConnection`, `getValidCredential` (throws `ConnectionRevokedError` on a revoked/expired connection), `testConnection`
- `app/lib/gmail-sync-store.ts` — issue #216: `GMAIL_SYNC_CURSORS_COLLECTION`, `pollGmailForBrand` (the hourly cron's per-brand poll, headers-only-then-body-on-match)
- `app/lib/google-contacts-store.ts` — issue #216: `searchGoogleContacts`, `getGoogleContact`
- `app/lib/products.ts` — issue #215: `PRODUCT_ABSOLUTE_CEILING` (50,000,000, deliberately currency-agnostic, matching `lib/ticket-size.ts`'s own precedent), `Product`, `sanitizeProduct(s)`, `resolveProductLinePrice`

---

## 5. UI Components

### 5.1 `app/*.tsx` (root-level)

- `app/kanban.tsx` — `KanbanBoard` — owns per-column paginated fetch from `/api/leads/columns` and drag-move via `/api/leads`; renders `LeadCard` per lead
- `app/card.tsx` — `LeadCard` — pure presentational; receives `lead`, `staleness`, `nudge`, `winProbability` as props from `KanbanBoard`, does **not** fetch
- `app/detail.tsx` — `LeadDetailModal` — full lead editor; opened via `onOpenLead`; renders `ActivityPanel` and `CadencePanel` as children (each self-fetches) plus `ContactsEditor` inline
- `app/table.tsx` — `TableView` — alternate flat-list rendering, also driven by `onOpenLead` into `LeadDetailModal`
- `app/metrics.tsx` — `MetricsPanel` — self-fetches `/api/metrics`, `/api/metrics/by-source`, `/api/metrics/decline-reasons`
- `app/search-learning.tsx` — `SearchLearningPanel` — self-fetches search-memory API
- `app/page.tsx` — `LandingPage` (brand picker / marketing landing)
- `app/layout.tsx` — `RootLayout`, mounts `Providers`/`AuthProvider`/`AppNav`
- `app/error.tsx` — `GlobalError` (Next.js error boundary page)

### 5.2 `app/components/*.tsx`

- `ActivityPanel.tsx` — `ActivityPanel({leadId, brand})` — self-fetches `/api/leads/{id}/activity` and `/api/contact-suggestions`; rendered inside `LeadDetailModal`
- `CadencePanel.tsx` — `CadencePanel({leadId, brand, activeCadence})` — self-fetches `/api/cadences`, posts to `/api/leads/{id}/cadence`; rendered inside `LeadDetailModal`
- `AddLeadModal.tsx` — `AddLeadModal({brand, opened, onClose, onCreated})` — owns its own POST to `/api/leads`; rendered from the Sales page toolbar
- `ContactsEditor.tsx` — `ContactRow`, `EMPTY_CONTACT_ROW`, `ContactsEditor({value, onChange})` — pure controlled-input editor (no fetch); embedded in `LeadDetailModal` and `AddLeadModal`
- `MergeConflictModal.tsx` — `MergeConflictModal({reviewId, opened, onClose, onMerged})` — self-fetches/POSTs `/api/duplicate-reviews/merge`; used by `admin-duplicates-client.tsx`
- `FilterBar.tsx` — `FilterBar({brand, value, onChange})` — controlled filter UI (no fetch); feeds `KanbanBoard`'s `filter` prop from the Sales page
- `AuthProvider.tsx` — `AuthProvider`, `useAuth()` — session context, calls `/api/auth/session`, wraps the whole app
- `AppNav.tsx` — `AppNav()` — top nav, reflects `useAuth()`'s accessible-brands list (does not itself gate — the page-level `requireBrandAccess()` is the real enforcement, per CLAUDE.md Rule 7)
- `AppHeader.tsx` — issue #207: `AppHeader()` — extracted from `app/layout.tsx` (was rendered unconditionally there) so the public `/schedule/*` booking page can render zero SSO-gated app chrome; `usePathname()`-based synchronous check (resolves on first render, no remount-and-lose-state risk, unlike `use-is-fine-pointer.ts`'s `matchMedia`-based hook)
- `TourProvider.tsx` — issue #185: `TourProvider({children})`, `useTour()` — `driver.js`-backed onboarding tour context, mounted in `app/layout.tsx`
- `GoogleContactsImport.tsx` — issue #216: `GoogleContactsImport({leadId, brand, connected, onImported})` — self-fetches `/api/integrations/google-contacts/search`, posts `/api/leads/{id}/contacts/import-google`; embedded in `LeadDetailModal`, only rendered once the brand's `google_contacts` connection is active
- `Providers.tsx` — `Providers({children})` — Mantine/theme/query provider wrapper
- `ErrorBoundary.tsx` — class component `ErrorBoundary`
- `BackToTopButton.tsx`, `PwaSetup.tsx` — small standalone UI utilities
- `gds/primitives.ts` — design-system primitives (non-component `.ts` file in `components/`)

### 5.3 Data-flow convention

`KanbanBoard` fetches leads/columns and passes plain `lead` props down to `LeadCard` — `LeadCard` never fetches. `LeadDetailModal` does **not** pre-fetch activity or cadence data for its children: `ActivityPanel` and `CadencePanel` each independently `fetch()` on mount, keyed by `leadId`/`brand` props. This "child components fetch their own reads" pattern is deliberate and repeated across the app (also documented in `contacts-client.tsx`'s own comments) — a new panel/tab that needs its own data should follow it rather than threading a fetch through its parent.

---

## 6. `app/[route]/**/*.tsx` — Brand-Scoped Pages

Every page below is an async Server Component that calls `await requireBrandAccess(brand)` before rendering its `*-client.tsx` companion (§8.2, tier 3).

| Page | Client component | API routes it/its children call |
|---|---|---|
| `app/sales/[brand]/page.tsx` | `SalesPageClient` | `/api/leads/{id}` (direct), `/api/boards/{brand}`; mounts `KanbanBoard` → `/api/leads/columns`, `/api/leads`; mounts `AddLeadModal` → `/api/leads` POST; mounts `FilterBar` (no fetch) |
| `app/contacts/[brand]/page.tsx` | `ContactsClient` | `/api/contacts` (debounced search) |
| `app/forecast/[brand]/page.tsx` | `ForecastClient` | `/api/boards/{brand}`, `/api/win-rates`, `/api/ticket-size-calibration` |
| `app/outreach/cadences/[brand]/page.tsx` | `CadencesClient` | `/api/cadences`, `/api/outreach-templates`, `/api/cadences/{id}` |
| `app/outreach/templates/[brand]/page.tsx` | `OutreachTemplatesClient` | `/api/outreach-templates` (GET list + POST create/update) |
| `app/salessettings/[client]/page.tsx` | `SalesSettingsClient` | `/api/sales-settings/{brand}` (GET + PUT) |
| `app/battlecards/[brand]/page.tsx` | `BattlecardsClient` | `/api/battlecards`, `/api/battlecards/{id}` |
| `app/accounts/[brand]/page.tsx` | `AccountsClient` | `/api/accounts`, `/api/accounts/{parentOrgId}` (issue #209) |
| `app/automation/[brand]/page.tsx` | `AutomationClient` | `/api/automation-rules`, `/api/automation-rules/{id}` (issue #201) |
| `app/reports/[brand]/page.tsx` | `ReportsClient` | `/api/reports`, `/api/reports/{id}`, `/api/reports/{id}/run` (issue #212) |
| `app/salessettings/[client]/integrations/page.tsx` | `IntegrationsClient` | `/api/integrations/connections`, `/api/integrations/{provider}/connect`, `/api/integrations/connections/{id}/disconnect`, `/api/integrations/connections/{id}/test` (issue #217) |
| `app/admin/products/[brand]/page.tsx` | `AdminProductsClient` | `/api/products/{brand}`, `/api/products/{brand}/{productId}` (issue #215) |

`app/schedule/[brand]/page.tsx` → `ScheduleClient` is deliberately **not** in the table above — issue #207's own explicit requirement is a **public, unauthenticated** page (no `requireBrandAccess()` call), calling `/api/schedule/{brand}/availability` and `/api/schedule/{brand}/book`, both themselves public.

Static auth-flow terminal pages (no API calls, no brand scoping): `app/access-denied/page.tsx` (reached via `redirect('/access-denied?reason=...')`, e.g. an SSO decline or a non-super-admin hitting a super-admin-only page) and `app/access-pending/page.tsx` (a signed-in user with zero organization/brand access yet — covers both DoneIsBetter's own app-approval-pending state and this app's own zero-`orgAccess` state with one message, issue #103's follow-up).

Non-brand-scoped (session/super-admin) pages: `app/admin/duplicates/page.tsx` → `AdminDuplicatesClient` → `/api/duplicate-reviews` (and, via `MergeConflictModal`, `/api/duplicate-reviews/merge`); `app/admin/users/page.tsx` → `AdminUsersClient` → `/api/admin/users`, `/api/admin/users/{userId}/access`; `app/admin/prompts/[brand]/page.tsx` → `PromptEditorClient` → `/api/prompts`; `app/admin/clients/page.tsx` → `AdminClientsClient` → `/api/admin/clients` (issue #196); `app/admin/teams/page.tsx` → `AdminTeamsClient` → `/api/admin/teams`, `/api/admin/users` (issue #199); `app/admin/api-keys/page.tsx` → `AdminApiKeysClient` → `/api/admin/api-keys` and (issue #219) `/api/admin/webhooks`, sharing one page and its brand selector. `app/outreach/compose-modal.tsx` (`OutreachComposeModal`, used from lead detail/kanban) self-fetches `/api/outreach-templates` and `/api/battlecards`.

---

## 7. Data Model

See `docs/ARCHITECTURE.md` for the *meaning* of each taxonomy/scoring field — this section is the literal shape.

### 7.1 `Lead` (`app/types.ts`)

**Identity**: `_id`, `id?`, `entity_name`, `url?`, `country`, `region: string` (fixed, issue #172 — was a closed `"US"|"CEE"|"MENA"` union; a live production audit across all 3 brands found 55+ distinct real values — ISO codes, full country names, continents, sub-national regions like "Debrecen / Hajdú-Bihar" — confirming the type/reality gap and settling the decision in favor of widening rather than enumerating), `address?`, `general_contact?`, `size?`, `industry?`, `sport_or_sector?`, `level_league?`.

**Controlled taxonomy** (rulebook v1.0, additive/optional): `sportCode?`, `orgTypeCode?`, `businessUnitCode?`, `genderCode?`, `demographicCodes?: string[]`, `competitionLevelCode?`, `cityName?`, `parentOrgId?`, `parentOrgName?`, `relationshipToParent?`, `canonicalLeadName?`, `classificationTags?: string[]` (system-generated, distinct from operator-authored `tags?`), `mergeKey?`, `classificationConfidence?`, `classificationEvidence?: string[]`.

**Contacts**: `contacts?: Array<{name, title, email, phone, linkedin, role, isDecisionMaker, buyingRole, lastVerifiedAt, emailVerificationStatus, seniorityTier, department}>` — decision-maker status is per-contact (legacy top-level `decision_maker_*` fields retired, issue #45). `buyingRole?: 'economic_buyer'|'champion'|'influencer'|'blocker'|'decision_maker'|'unknown'` (issue #206) replaces `isDecisionMaker` as the authoritative field — `isDecisionMaker` remains present on read, permanently DERIVED (`true` iff `buyingRole` is `'decision_maker'`/`'champion'`), never independently settable. `contactEmails?: string[]` (issue #142) is written on every contact-write path (`lib/contacts.ts`'s `deriveContactEmails()`) and is present in this type definition (fixed, issue #171).

**Ownership** (issue #198): `assignedTo?: string|null` (an `ssoUserId`, never a display name/email; both `null`/`undefined` mean unassigned), `assignedToEmail?: string|null` (denormalized display value, always recomputed from `assignedTo`, never accepted as raw input), `assignedAt?: string|null`, `assignedBy?: string` (the ssoUserId of the most recent assigning actor, distinct from `assignedTo` itself).

**Qualitative**: `pro_for_organization?` / `con_for_organization?` (shared field names across all brands, `PRO_FIELD`/`CON_FIELD`), `value_proposition?`, `status?`, `notes?`, `product_fit_notes?`, `tags?: string[]`.

**Tech signals**: `techSignals?: string[]`, `techSignalsScannedAt?`, `techSignalsScanStatus?`.

**Money**: `ticketSizeEstimate?: {method: 'tier_band'|'per_unit'|'unconfigured'|'manual_override', computedAt, low?, expected?, high?, currency?, confidence?, overrideReason?, overriddenBy?, sizeAssumed?}` (server-computed, authoritative), `actualDealValueUsd?`, `deals?: Array<{id, value, currency, label?, createdAt, updatedAt, source: 'manual'|'converted_ticket_estimate'}>`.

**Workflow**: `checklist?: Array<{id, text, done, createdAt, completedAt?}>`, `nextActionDueAt?: string|null`, `nextActionNote?`, `activeCadence?: ActiveCadence|null`, `qualification?: {budgetConfirmed?, budgetNotes?, authorityConfirmed?, needNotes?, timelineEstimate?}`, `source?`.

**Board/scoring**: `kanbanColumn: KanbanColumn`, `sortOrder: number`, `fingerprint?`, `ice?: {impact, confidence, ease}` (⚠ a submitted `ease` is validated for shape then discarded — the server always recomputes it via `computeEase(body)`, per `docs/RUNTIME_ARCHITECTURE_NOTES.md`-equivalent findings in the sibling `researchandenrich` repo), `scoreProfile?: {agentProposal, calibratedHeuristic, finalBlended, qualityDimensions}`, `qualityStatus: "DRAFT"|"CHECKED"|"VERIFIED"`, `feedbackScore: number`, `declineCount: number`, `acceptanceCount: number`, `declineReason?: DeclineReason`, `declinedAt?`, `manualLaneOverride*`/`manualLaneCooldownUntil`/`manualLaneFloorColumn`/`manualLaneOverrideBy`, `createdAt?`, `updatedAt?`.

**Brand-specific legacy forecast fields**: CogMap's `estimated_annual_revenue_usd?`, `estimated_participants?`, `recommended_tier?`, `revenue_model?`; Seyu's `pricingByCompany?: Record<string, {...}>`.

`KanbanColumn = "DISCOVERED"|"QUALIFIED"|"ENGAGED"|"PROPOSAL"|"WON"|"LOST"|"BACKLOG"` (`BACKLOG` deliberately excluded from `app/constants.ts`'s `COLUMNS`, only reachable via explicit "Move to Backlog").

### 7.2 Other collections

| Collection | Document type | Defined in | Written by |
|---|---|---|---|
| `activityLog` | `ActivityLogDocument` (`ActivityEntryType`: `'email-outbound'\|'email-inbound'\|'note'\|'system'\|'call'\|'meeting-scheduled'`; `ActivitySource`: `'inbound-webhook'\|'manual'\|'outreach-log'\|'gmail-sync'\|'calendar-sync'` — `'call'`/`'meeting-scheduled'`/`'gmail-sync'`/`'calendar-sync'` added by issues #200/#207/#216) | `app/lib/activity-log-store.ts` | Inbound webhook + outreach-log merge; manual call logging (`POST /api/leads/[id]/activity`, issue #200); Gmail sync / meeting booking write-back |
| `contactSuggestions` | `ContactSuggestionDocument` | `lib/contact-reply-matching.ts` | `generateContactSuggestion()` off inbound webhook events |
| `cadences` | `Cadence` (`{id, name, steps: CadenceStep[]}`, `CadenceStep = {channel: 'email'\|'linkedin'\|'call', waitDaysAfterPrevious, ...}`) | `lib/cadences.ts` | `/api/cadences` CRUD |
| `outreach_logs` | inline shape `{id, leadId, brand, templateId, channel, subject, body, createdAt, tenantId, routingAllowed, routingReason}`, plus (issue #205, additive) `sendAttempted`, `resendEmailId`, `sentAutomatically`, `cadenceId`/`stepIndex`, `activityLogWritten`, and (webhook-written) `deliveryStatus`/`deliveryStatusUpdatedAt`/`openCount`/`clickCount` | `app/api/outreach-logs/route.ts` (record-only) / `lib/outreach-send.ts` (real sends) | `/api/outreach-logs` POST, `/api/outreach-send` POST, `/api/webhooks/inbound-email` POST (status enrichment only) |
| `resend_webhook_event_ids` | `{svixId, createdAt, expiresAt}`, unique on `svixId`, TTL on `expiresAt` | `app/api/webhooks/inbound-email/route.ts` | Delivery/open/click event dedup (issue #205) |
| `company_settings` | `SalesSettings` (`ProductLine[]`, `DealSize`, `Upsell[]`, `ExampleCustomer[]`, `Seasonality`, `RevenueTarget`), keyed by brand | `app/lib/sales-settings.ts` | `/api/sales-settings/[brand]` PUT |
| `report_definitions` | `ReportDefinition` (`{id, brand, tenantId, name, metric, groupBy[], filters[], dateRange, chartType, schedule: ReportSchedule \| null, createdBy, ...}`) | `lib/report-definitions.ts` | `/api/reports` CRUD (issue #212) |
| `settings` (generic, keyed by `key`) | `pipeline_weights`, `stale_thresholds`, `concentration_risk_settings`, `forecast_calibration` | various `lib/*.ts` | `/api/settings` PUT |
| `winrate_calibration` | `WinRateDoc` | `app/lib/win-rate-store.ts` | Lazy recompute, 24h TTL |
| `ticket_size_calibration` | `TicketSizeCalibrationDoc` | `app/lib/ticket-size-calibration-store.ts` | Lazy recompute, 24h TTL |
| `forecast_snapshots` | — | `app/lib/forecast-snapshot.ts` | Weekly cron |
| `brands` | `BrandRecord` (`BrandConfig` + Mongo `_id`/timestamps) | `app/lib/brand.ts` | `/api/admin/clients` POST (issue #195/#196) — the live source `getBrandConfig`/`getAllBrandConfigs` read on every call |
| `teams` | `Team` (`{id, brand, name, managerIds[], memberIds[], createdAt, updatedAt}`) | `lib/teams.ts` | `/api/admin/teams` CRUD (issue #199) |
| `bulkActionUndoTokens` | `{id, action, leadIds[], beforeState, fieldsWritten[], createdAt, expiresAt}`, TTL on `expiresAt` | `lib/bulk-undo.ts` | `PATCH /api/leads/bulk` (write) / `POST /api/leads/bulk/undo` (consume), 15s window (issue #203) |
| `quota_targets` | — (`PeriodType`-keyed target value per brand) | `lib/quota.ts` | `/api/quota/[brand]` PUT (issue #204) |
| `api_keys` | `ApiKeyRecord` (`{id, name, brand, scopes, hashedKey, keyPrefix, createdBy, createdAt, lastUsedAt, revokedAt}`) | `lib/scoped-api-keys.ts` | `/api/admin/api-keys` CRUD (issue #210) — `hashedKey` unique-indexed, raw key never stored |
| `webhooks` | `WebhookRecord` (`{id, brand, url, events[], encryptedSecret, createdBy, createdAt, disabledAt, disabledReason, consecutiveFailures}`) | `lib/webhooks.ts` | `/api/admin/webhooks` CRUD (issue #219) — `encryptedSecret` via `lib/integration-crypto.ts`, not a hash (must be reused for every signature) |
| `webhook_deliveries` | `WebhookDeliveryRecord` (`{id, webhookId, brand, event, payload, attempt, status, httpStatus, nextAttemptAt, createdAt, deliveredAt}`) | `app/lib/webhook-store.ts` | Enqueued by `emitWebhookEvent()` (lead-create/`executeLeadAction` convergence points); processed by the hourly `webhook-delivery-tick` cron |
| `quotes` | `Quote` (`{id, tenantId, brand, leadId, dealId, status, lineItems[], totalValue, currency, pdfBlobPath, shareToken, createdAt, updatedAt, createdBy, sentAt?, viewedAt?, signedAt?, signedBy?}`) | `lib/quotes.ts` | `/api/leads/[id]/quotes` CRUD, `/api/quotes/[quoteId]/view` (issue #211) — `shareToken` (128-bit) is the sole public lookup key |
| `quote_view_rate_limits` | one doc per view request, TTL | `app/lib/quotes-store.ts` | `GET /api/quotes/[quoteId]/view`, 20/min per `quoteId` and client IP (issue #211; per IP since 2.4.229, issue #229) |
| `products` | `Product` (per-brand/tenant priced catalog line item) | `app/lib/products.ts` | `/api/products/[brand]` CRUD (issue #215) |
| `integration_oauth_states` | `PendingOAuthState` (`{state, provider, brand, tenantId, ssoUserId, expiresAt}`), unique `state`, TTL on `expiresAt` | `app/lib/integration-store.ts` | written by `/api/integrations/[provider]/connect`, consumed (deleted) by `/api/integrations/oauth/callback` (issue #228) |
| `integration_connections` | `IntegrationConnection` (`{id, brand, tenantId, provider, authMethod, status, encryptedCredentials, ...}`) | `lib/integration-connections.ts` / `app/lib/integration-store.ts` | `/api/integrations/**` (issue #217) — AES-256-GCM at rest via `lib/integration-crypto.ts`, fails closed unconditionally if the encryption key is unset |
| `gmailSyncCursors` | per-brand Gmail History API cursor | `app/lib/gmail-sync-store.ts` | Hourly `gmail/sync` cron (issue #216) |
| `scheduling_settings` | `SchedulingSettings` (weekdays/hours/slot length/buffer) | `app/lib/scheduling-store.ts` | `/api/scheduling-settings/[brand]` PUT (issue #207) |
| `scheduling_rate_limits` | one doc per request, TTL | `app/lib/scheduling-store.ts` | Public `/api/schedule/[brand]/availability`\|`/book`, per-IP+brand |
| `scheduling_slot_claims` | `{brand, tenantId, slotStart}`, unique-indexed, 30s TTL | `app/lib/scheduling-store.ts` | `POST /api/schedule/[brand]/book` — closes the two-concurrent-bookings race; Google Calendar's own `freeBusy` state remains the real system of record |

---

## 8. Cross-Cutting Concerns

### 8.1 Brand/tenant scoping

`app/lib/brand.ts` is the single source of truth. As of issue #195, that source is a Mongo `brands` collection, not a static object: `getBrandConfig(slug)`/`getAllBrandConfigs()` (both `async`) read it fresh on every call, falling back to the in-code `FALLBACK_BRAND_CONFIG` seed only when the collection is genuinely empty. `Brand` is `type Brand = string` (was a 3-value literal union — a runtime-editable set of brands can't be a compile-time union), defined in `app/lib/brand-constants.ts` and re-exported by `brand.ts`. `resolveBrand()` (also now `async`) normalizes a route param/alias (e.g. `"cogmapsales"` → `cogmap`) and returns `null` — never a silent wrong-brand fallback — for a genuinely unrecognized non-empty value; an empty/missing value still defaults to `'cogmap'`. 63 files import from it as of this backfill (up from 51 at the #195 migration, 41 before it). See `docs/ARCHITECTURE.md`'s "Brand config becomes Mongo-backed" section for the full migration detail.

`lib/tenant.ts`'s `tenantFilter(tenantId)` builds the Mongo `$or` filter that also matches legacy docs missing `tenantId` when `tenantId === 'default'`; 54 files import it as of this backfill (up from 30), covering essentially every read/write in `app/api/leads/**`, `app/api/battlecards/**`, `app/api/cadences/**`, `app/api/contacts/**`, `app/api/search`, `app/api/metrics/**`, `app/api/health`, `app/api/admin/cadence-tick`, and every #198–#219-era feature that scopes its own new collection by `{brand, tenantId}`. `getTenantId(request)` extracts the query param with a `'default'` fallback.

⚠ **Two routes reimplement their own local copy instead of importing**: `app/api/boards/route.ts` and `app/api/health/route.ts` — a real inconsistency worth fixing if either route's tenant logic ever needs to change (currently harmless since the reimplementations match, but a future divergence risk).

Together, `(await getBrandConfig(brand)).dbCollection` picks the actual Mongo collection and `tenantFilter` further scopes rows within it — every query gets both dimensions.

### 8.2 Auth layering

Six distinct, deliberately non-overlapping guard mechanisms (grew from five since this doc's original write-up — #6, `requireBrandAccessSession`, shipped with issue #217):

1. **`lib/api-auth.ts`** (`requireApiKey`/`isCronRequest`/`requireCronOrApiKey`) — machine-to-machine: shared `x-api-key` header (`SLG_API_KEY`) for the external research agent and admin/cron scripts, or `Authorization: Bearer $CRON_SECRET` for Vercel Cron. Fails open outside production if unconfigured, fails closed in production (issue #105). Used on write-heavy/admin routes (`cadences`, `battlecards`, `outreach-*`, `admin/*`).
2. **`lib/require-brand-access-api.ts`** (`requireBrandAccessApi`) — the route-handler combined guard: accepts the same `x-api-key` (legacy shared key), OR a **scoped API key** (issue #210 — `x-api-key` re-hashed and looked up in `api_keys`, brand+scope-checked via `lib/scoped-api-keys.ts`'s `evaluateScopedKeyAuth`, a matched-but-invalid key fails closed immediately rather than falling through), OR a valid `sso_id_token` cookie resolved via `lib/session.ts`'s `resolveSessionFromIdToken` + `lib/sso-access.ts`'s `getUserAccess`/`hasAccessToBrand`. Deliberately **not** built on top of `requireApiKey()` (would fail-open and defeat the session check) — has its own inline `hasValidApiKey`. Used on the core lead-data surface: `app/api/leads/**`, `app/api/contacts/**`, `app/api/contact-suggestions/**`, and (issue #192) `app/api/search` (brand mode), `app/api/boards/[brand]`, `app/api/forecast/export`, `app/api/metrics*`, `app/api/win-rates`, `app/api/ticket-size-calibration`, plus every #198–#219-era route documented in §2's newer tables that lists this guard.
3. **`lib/require-brand-access.ts`** (`requireBrandAccess`) — the Server Component page-level equivalent, calls Next's `redirect()` (can't return a `NextResponse`, hence a separate function from #2). Called at the top of every brand-scoped `page.tsx` file (§6) except the deliberately-public `app/schedule/[brand]/page.tsx` (issue #207).
4. **`lib/session.ts`**'s `requireSuperAdminSession` — strictest tier, session-only (no `x-api-key` fallback), gates `admin/users`, `admin/toggle`, `duplicate-reviews*`, `admin/duplicate-scan`, `prompts`, `admin/clients`, `admin/teams`, `admin/api-keys`, `admin/webhooks`, and (issue #192) `app/api/search`'s no-brand cross-all-brands mode — human-only surfaces reasoned to never need machine access. Deliberately never `x-api-key`-accessible even via a scoped key (#2's own richer machine-auth branch) — a credential must never mint or read another credential's data.
5. **`lib/session.ts`**'s `requireApiKeyOrSession` (issue #192) — the same `x-api-key`-or-session shape as #2, but with no specific-brand or admin check: for global (not brand-scoped) mutating config any brand-authorized user may legitimately write, not just an admin. Since 2.4.229 (issue #229) the session must reach at least one brand (super admins always do); before that any verified login passed, including a user nobody had granted anything. Gates `PUT /api/settings` and `POST /api/search-learning` — narrower than #1 (rejects when unconfigured rather than failing open) and looser than #4 (no super-admin requirement, since the real caller is any brand-authorized user on the Forecast page).
6. **`lib/require-brand-session.ts`** (`requireBrandAccessSession`, issue #217) — session-only, no `x-api-key` fallback at all (unlike #2), for routes where the caller must be a human with brand access specifically: the third-party integration hub's `app/api/integrations/**` (connect/disconnect/test/list connections) — a machine caller has no legitimate reason to initiate or manage an OAuth/API-key connection on a rep's behalf.

Two public route families exist entirely outside this six-tier system, by deliberate design, not omission: issue #207's `/api/schedule/[brand]/availability`\|`/book` (rate-limited per IP+brand instead) and issue #211's `GET /api/quotes/[quoteId]/view` (gated exclusively on a random `shareToken`, never `quoteId`). Both are documented in their own §2 tables above with the explicit "none — public" auth column.

SSO plumbing (`lib/sso.ts` PKCE flow + `lib/sso-access.ts` org-access model) underlies all six via `app/api/auth/login` → `oauth/callback` → `auth/session`, with `app/components/AuthProvider.tsx` as the client-side session context consumed by `AppNav`.

### 8.3 Taxonomy enforcement end-to-end

`lib/lead-taxonomy.ts` defines the closed vocabularies and `isValid*Code` guards. Enforcement chain:
1. `app/api/lead-taxonomy/route.ts` serves the vocab live so the external enrichment-agent's prompt can self-refresh instead of drifting from a pasted copy.
2. `lib/lead-classification.ts`'s `generateClassificationTags`/`buildMergeKey` consume the validated codes to derive `Lead.classificationTags`/`Lead.mergeKey` server-side on write.
3. `lib/near-duplicate.ts`'s `findCandidatePairs` and `lib/lead-merge.ts`'s `diffLeads`/`buildMergedLead` consume `mergeKey`/taxonomy fields for dedup.
4. The taxonomy fields on `Lead` are explicitly additive/optional so pre-migration leads remain valid (`docs/LEAD_TAXONOMY_MIGRATION_PLAN.md`).

---

## 9. Known type/reality gaps (not yet fixed)

Surfaced by the audit that produced this document — real, but out of scope for a documentation-only pass, recorded here rather than silently dropped. Split out of the original bundled finding, #166:

- **`app/types.ts`'s `Lead.contactEmails` was missing** despite the field being genuinely written on every contact-write path since issue #142 — fixed (#171).

---

## 10. GitHub Issue Management & Tooling

Issue/label/sub-issue CRUD in this repo goes through the GitHub MCP server's tools (`mcp__github__issue_write`, `add_issue_comment`, `sub_issue_write`, `list_issues`, `issue_read`, `search_issues`) — not the `gh` CLI, not raw REST. One easy mistake worth flagging here: `issue_write`'s `method: 'update'` **replaces the issue body** rather than appending — use `add_issue_comment` for progress notes, never `update` for that.

**GitHub Projects (the board) has no reachable path from an agent session** — two independent, both-live-tested reasons: classic Projects' REST API is fully removed from GitHub (`GET /repos/.../projects` → real `404`), and the current GraphQL-only Projects is blocked by this session's own credential restriction (a live authenticated GraphQL call was rejected by the session's proxy — `"not enabled for this session"` — not by GitHub itself). No tool in this session's toolset exposes Projects at all, by any name searched. `roadmap.md` (repo root) is the standing substitute.

Full detail — the mandatory issue-body template, the real label taxonomy, how structural sub-issue dependencies are recorded (`sub_issue_write` needs the child's numeric database `id`, not its issue number — a real, easy-to-mix-up distinction), and the complete verified investigation behind the board-access claim above: **`docs/ISSUE_MANAGEMENT.md`**.
