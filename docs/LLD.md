# Low-Level Design — Sales Lead Generator

**Version:** 2.4.177

**Status:** New document, first written 2026-08-02. This sits one level below `docs/ARCHITECTURE.md` (which covers system-level request flows, the data model's *shape and meaning*, and the deployment picture) — this doc is the module-by-module inventory: every API route, every shared library module, every major UI component, and exactly how they wire together. Where `ARCHITECTURE.md` explains *why* a decision was made, this doc is a map of *where the code that implements it actually lives*.

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

Every route imports `NextResponse`/`NextRequest` from `next/server`. The **Auth** column names the actual guard call found in the file — see §8.2 for what each one means and why there are four distinct ones.

### Leads core

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/leads/route.ts` | GET, POST, PATCH | `requireBrandAccessApi` (all three methods) | List/create/patch leads for a brand+tenant; POST runs `validateLeadPayload`, `deriveKanbanColumn`, `buildFingerprint`; PATCH runs `executeLeadAction` (single source of truth for lead mutations, shared with bulk) |
| `app/api/leads/[id]/route.ts` | GET, PUT, DELETE | `requireApiKey` + `requireBrandAccessApi` | Full read/replace/delete of one lead; PUT re-derives kanban column, dedupes contacts, kicks off async `verifyLeadContactsAsync` + `computeTicketSizeForLead` |
| `app/api/leads/bulk/route.ts` | PATCH | `requireBrandAccessApi` (no `requireApiKey` — browser-callable) | Bulk lead actions via shared `executeLeadAction` (kanban multi-select bar) |
| `app/api/leads/columns/route.ts` | GET | `requireBrandAccessApi` | Paginated (50/chunk) per-column lead fetch for `app/kanban.tsx`'s column-by-column loading model |
| `app/api/leads/[id]/activity/route.ts` | GET | `requireBrandAccessApi` | Merges `activityLog` + `outreach_logs` into one timeline via `mergeActivityTimeline` |
| `app/api/leads/[id]/cadence/route.ts` | POST, DELETE | `requireBrandAccessApi` | Enroll/cancel a lead's `activeCadence` via `buildInitialActiveCadence` |

### Boards / forecast / metrics

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/boards/route.ts` | GET | `requireApiKey` (fixed, issue #178 — previously none) | Legacy multi-brand board summary (has its own inlined `getTenantId`/`tenantFilter` — a real inconsistency, see §8.1) |
| `app/api/boards/[brand]/route.ts` | GET | none | Per-brand board summary + calls `app/lib/forecast.ts`'s `computeForecast` |
| `app/api/forecast/export/route.ts` | GET | none | CSV/export of `computeForecast()` output for one brand |
| `app/api/metrics/route.ts` | GET | none | Pipeline metrics; wraps `computeVelocity` (`app/lib/velocity-metrics.ts`) and `correlateOutcomes` (`lib/outcome-correlation.ts`) |
| `app/api/metrics/by-source/route.ts` | GET | none | Win-rate-by-acquisition-`source` aggregation |
| `app/api/metrics/decline-reasons/route.ts` | GET | none | Decline-reason rollup via `app/lib/decline-reason-rollup.ts` |
| `app/api/stats/route.ts` | GET | `requireApiKey` (fixed, issue #178 — previously none) | Legacy stats endpoint using `getPipelineWeights` |
| `app/api/win-rates/route.ts` | GET | none | Lazy-recompute cached win-rate calibration (`app/lib/win-rate-store.ts`'s `getOrRecomputeWinRates`) |
| `app/api/win-rates/recalculate/route.ts` | POST | `requireApiKey` | Forced win-rate recompute, ignoring cache staleness |
| `app/api/ticket-size-calibration/route.ts` | GET | none | Lazy-recompute cached ticket-size calibration |

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
| `app/api/cadences/route.ts` | GET, POST | `requireApiKey` | List/create cadence templates (`lib/cadences.ts`) |
| `app/api/cadences/[id]/route.ts` | GET, PUT, DELETE | `requireApiKey` | Single cadence CRUD |
| `app/api/admin/cadence-tick/route.ts` | GET, POST | `requireCronOrApiKey` / `requireApiKey` | Cron worker: advances every lead's `activeCadence`, sends due steps via `sendAutomatedEmail` |
| `app/api/outreach-logs/route.ts` | GET, POST | `requireApiKey` (POST) | Log of sent outreach; POST runs `evaluateOutreachRouting` |
| `app/api/outreach-templates/route.ts` | GET, POST | `requireApiKey` (POST) | Template CRUD, seeded from `DEFAULT_OUTREACH_TEMPLATES`; GET annotates with `computeTemplateConversions` |
| `app/api/outcome-logs/route.ts` | GET, POST | `requireApiKey` | Stage-transition outcome log (drives win-rate/velocity calibration) |
| `app/api/battlecards/route.ts` | GET, POST | `requireApiKey` (POST) | List/create competitor battlecards, seeded from `DEFAULT_BATTLECARDS` |
| `app/api/battlecards/[id]/route.ts` | GET, PUT, DELETE | `requireApiKey` | Single battlecard CRUD |

### Settings / taxonomy / search

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/settings/route.ts` | GET, PUT | none | `settings` collection: pipeline weights, stale thresholds, concentration risk, forecast calibration |
| `app/api/sales-settings/[brand]/route.ts` | GET, PUT | none | Per-brand `SalesSettings` document (`company_settings` collection), sanitized via `sanitizeSalesSettings` |
| `app/api/lead-taxonomy/route.ts` | GET | none | Serves `lib/lead-taxonomy.ts`'s controlled vocabularies live so the external enrichment-agent prompt never drifts from code |
| `app/api/search/route.ts` | GET | none | Regex-escaped (`escapeRegExp`) free-text lead search |
| `app/api/search-learning/route.ts` | GET, POST | none | "Search memory" — tracks which search queries/domains produced good leads |
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
| `app/api/admin/ticket-size-recalc/route.ts` | GET, POST | `requireCronOrApiKey` / `requireApiKey` | Recurring recompute across all `BRAND_CONFIG` brands |

### Misc

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| `app/api/health/route.ts` | GET | none | Liveness/DB-connectivity + per-brand snapshot freshness check |

---

## 3. `lib/*.ts` — Shared Library Modules

Framework-agnostic domain/business logic — pure functions and Mongo document shapes with no App-Router or UI concern. Grouped by what they're actually for, not alphabetically.

**Auth / session / tenancy** (cross-cutting — see §8.1–8.2 for how these thread through everything)
- `lib/api-auth.ts` — `requireApiKey`, `isCronRequest`, `requireCronOrApiKey`
- `lib/require-brand-access-api.ts` — `requireBrandAccessApi`
- `lib/require-brand-access.ts` — `requireBrandAccess` (Server Component page gate, calls `redirect()`)
- `lib/session.ts` — `resolveSessionFromIdToken`, `requireSuperAdminSession`
- `lib/sso.ts` — PKCE/OIDC primitives: `isSsoConfigured`, `generateCodeVerifier/Challenge/State`, `buildAuthorizeUrl`, `exchangeCodeForTokens`, `refreshTokens`, `verifyIdToken`, `getPermission`, `SSO_BASE_URL`
- `lib/sso-access.ts` — org/brand access model: `OrgAccessMap`, `SsoUserAccessRecord`, `isSuperAdminEmail`, `upsertUserSeen`, `getUserAccess`, `listAllUserAccess`, `setUserOrgAccess`, `getAccessibleBrands`, `hasAccessToBrand`, `getRoleForBrand`, `resolveLoginDestination`
- `lib/tenant.ts` — `getTenantId`, `tenantFilter`
- `lib/mongodb.ts` — `isMongoConfigured`, `getClientPromise`, default export `clientPromise`

**Taxonomy / classification**
- `lib/lead-taxonomy.ts` — controlled vocab: `SPORT_CODES`, `SPORT_ALIASES`, `resolveSportAlias`, `ORG_TYPE_CODES`, `BUSINESS_UNIT_CODES`, `GENDER_CODES`, `DEMOGRAPHIC_CODES`, `COMPETITION_LEVEL_CODES`, `RELATIONSHIP_CODES`, each with a `*_SET` and `isValid*Code` guard, plus `slugifyForTag`
- `lib/lead-classification.ts` — `generateClassificationTags`, `buildMergeKey`
- `lib/title-normalization.ts` — `SeniorityTier`, `Department`, `TitleClassification`, `normalizeTitle`

**Contacts**
- `lib/contacts.ts` — `normalizePhone`, `normalizeEmail`, `toNameCase`, `normalizeContact`, `contactKey`, `verifiableFieldsDiffer`, `dedupeContacts`, `deriveContactEmails`, `ensureContactEmailsIndex`, `getDecisionMakerContact`, `aggregateContactsAcrossLeads`
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
- `lib/pipeline-weights.ts` — `DEFAULT_PIPELINE_WEIGHTS`, `getPipelineWeights`
- `lib/pipeline-coverage.ts` — `computeCoverage`, `Coverage`, `CoverageBenchmark`
- `lib/forecast-concentration.ts` — `computeConcentration`, `getConcentrationRiskSettings`, `DEFAULT_CONCENTRATION_*`
- `lib/win-rate-calibration.ts` — `computeWinRatesFromLogs`, `mergeCalibratedWeights`, `getForecastCalibrationSettings`, `CALIBRATABLE_STAGES`

**Cadences / outreach**
- `lib/cadences.ts` — `Cadence`, `CadenceStep`, `ActiveCadence`, `sanitizeCadence(Step/Steps)`, `validateCadence`, `computeStepDueAt`, `buildInitialActiveCadence`, `advanceActiveCadence`
- `lib/outreach-send.ts` — `isResendSendConfigured`, `resolveOutboundFromAddress`, `sendAutomatedEmail`
- `lib/resend-webhook.ts` — `extractResendWebhookHeaders`, `verifyResendWebhook`, `isResendConfigured`
- `lib/template-conversion.ts` — `computeTemplateConversions`

**Dedup / merge**
- `lib/near-duplicate.ts` — `normalizeForMatch`, `similarity`, `findCandidatePairs`
- `lib/lead-merge.ts` — `FieldClassification`, `suggestPrimaryId`, `diffLeads`, `buildMergedLead`
- `lib/fingerprint.ts` — `buildFingerprint`

**Validation / kanban / stage logic**
- `lib/validate-lead.ts` — `ValidationResult`, `EMAIL_RE`, `FORBIDDEN_BRAND_TERMS`, `findForbiddenBrandTerms`, `bestContactConfidence`, `validateLeadPayload`, `validatePatchPayload`
- `lib/kanban-column.ts` — `AUTO_MANAGED_COLUMNS`, `QUALIFIED_ICE_THRESHOLD`, `deriveKanbanColumn`, `isAutoManagedColumn`, `ICE_SCORE_AGGREGATION_EXPR`
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
- `lib/desktop-scroll-passthrough.ts` — `isVerticalScrollIntent`
- `lib/saved-filters.ts` — `LeadFilter`, `SavedFilter`, `isEmptyFilter`, `addSavedFilter`, `removeSavedFilter`
- `lib/backfill-title-normalization.ts` — one-time migration for `normalizeTitle`

---

## 4. `app/lib/*.ts` — App-Internal Lib Modules

### 4.1 Why this is a separate layer from `lib/*.ts`

`app/lib/*.ts` mixes **App-Router-coupled** and **brand/UI-adjacent** concerns. The import direction is one-way, confirmed by grep: `app/lib/**` imports from `lib/**`, never the reverse. `app/types.ts` itself imports `CurrencyCode` from `app/lib/brand.ts` and `ActiveCadence` from `lib/cadences.ts` — so `app/lib/brand.ts` is upstream even of the core `Lead` type.

The concrete pattern that distinguishes the two layers: `lib/cadences.ts` has the pure `sanitizeCadence`/`advanceActiveCadence` logic, but `app/lib/` has **no** cadence store — that CRUD lives directly in `app/api/cadences/**`. Conversely, `app/lib/ticket-size-store.ts` / `app/lib/win-rate-store.ts` / `app/lib/ticket-size-calibration-store.ts` are the **Mongo-aware caching/orchestration layer** ("get cached doc, recompute if stale, persist") sitting on top of the pure calculators in `lib/ticket-size-calibration.ts` / `lib/win-rate-calibration.ts` — the `-store` suffix consistently marks this DB-orchestration role. `app/lib/brand.ts` and `app/lib/sales-settings.ts` also hold real UI-facing option lists (`CUSTOMER_TYPE_OPTIONS`, `BUYER_ROLE_OPTIONS`, etc.) that `lib/*.ts` never does.

### 4.2 The modules

- **`app/lib/brand.ts`** — `BRAND_CONFIG`, `Brand`, `CurrencyCode`, `resolveBrand`, `PRO_FIELD`/`CON_FIELD` (41 files import from it — see §8.1)
- `app/lib/activity-log-store.ts` — `ACTIVITY_LOG_COLLECTION`, `ActivityEntry`, `ActivityLogDocument`, `ensureActivityLogIndexes`, `mapOutreachLogToActivityEntry`, `mapActivityLogDoc`, `mergeActivityTimeline`
- `app/lib/forecast.ts` — `ForecastComputation`, `computeForecast(db, brand, tenantId)`
- `app/lib/forecast-snapshot.ts` — `FORECAST_SNAPSHOT_COLLECTION`, `discoverTenantIds`, `writeForecastSnapshot`
- `app/lib/velocity-metrics.ts` — `computeVelocity`, `VelocityMetrics`, `OutcomeLogRow`
- `app/lib/decline-reason-rollup.ts` — `buildDeclineMatchStage`, `shapeGroupedRows`, `shapeTotalsByReason`
- `app/lib/metrics.ts` — `metricsByStage`, `metricsByRegion`, `metricsByQuality`, `metricsByIceLevel` (legacy client-side metrics helpers)
- `app/lib/normalize-lead.ts` — `normalizeLead`, `ensureArrayField`, `extractWarnings`
- `app/lib/lead-actions.ts` — `executeLeadAction` (single mutation entrypoint shared by `/api/leads` PATCH and `/api/leads/bulk`)
- `app/lib/sales-settings.ts` — `SalesSettings` + sub-types (`ProductLine`, `DealSize`, `RevenueTarget`, etc.), `emptySalesSettings`, `sanitizeSalesSettings`, `BRAND_SALES_VOCABULARY`, `getAllowedCustomerTypes/BuyerRoles`
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
- `app/lib/saved-filters-storage.ts` — `loadSavedFilters`, `persistSavedFilters` (localStorage-backed, client-only — pairs with `lib/saved-filters.ts`'s pure logic)
- `app/lib/use-is-compact-viewport.ts` — `useIsCompactViewport` (React hook, UI-only — could never live in `lib/`)

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

Non-brand-scoped (session/super-admin) pages: `app/admin/duplicates/page.tsx` → `AdminDuplicatesClient` → `/api/duplicate-reviews` (and, via `MergeConflictModal`, `/api/duplicate-reviews/merge`); `app/admin/users/page.tsx` → `AdminUsersClient` → `/api/admin/users`, `/api/admin/users/{userId}/access`; `app/admin/prompts/[brand]/page.tsx` → `PromptEditorClient` → `/api/prompts`. `app/outreach/compose-modal.tsx` (`OutreachComposeModal`, used from lead detail/kanban) self-fetches `/api/outreach-templates` and `/api/battlecards`.

---

## 7. Data Model

See `docs/ARCHITECTURE.md` for the *meaning* of each taxonomy/scoring field — this section is the literal shape.

### 7.1 `Lead` (`app/types.ts`)

**Identity**: `_id`, `id?`, `entity_name`, `url?`, `country`, `region: string` (fixed, issue #172 — was a closed `"US"|"CEE"|"MENA"` union; a live production audit across all 3 brands found 55+ distinct real values — ISO codes, full country names, continents, sub-national regions like "Debrecen / Hajdú-Bihar" — confirming the type/reality gap and settling the decision in favor of widening rather than enumerating), `address?`, `general_contact?`, `size?`, `industry?`, `sport_or_sector?`, `level_league?`.

**Controlled taxonomy** (rulebook v1.0, additive/optional): `sportCode?`, `orgTypeCode?`, `businessUnitCode?`, `genderCode?`, `demographicCodes?: string[]`, `competitionLevelCode?`, `cityName?`, `parentOrgId?`, `parentOrgName?`, `relationshipToParent?`, `canonicalLeadName?`, `classificationTags?: string[]` (system-generated, distinct from operator-authored `tags?`), `mergeKey?`, `classificationConfidence?`, `classificationEvidence?: string[]`.

**Contacts**: `contacts?: Array<{name, title, email, phone, linkedin, role, isDecisionMaker, lastVerifiedAt, emailVerificationStatus, seniorityTier, department}>` — decision-maker status is per-contact (legacy top-level `decision_maker_*` fields retired, issue #45). `contactEmails?: string[]` (issue #142) is written on every contact-write path (`lib/contacts.ts`'s `deriveContactEmails()`) and is present in this type definition (fixed, issue #171).

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
| `activityLog` | `ActivityLogDocument` | `app/lib/activity-log-store.ts` | Inbound webhook + outreach-log merge |
| `contactSuggestions` | `ContactSuggestionDocument` | `lib/contact-reply-matching.ts` | `generateContactSuggestion()` off inbound webhook events |
| `cadences` | `Cadence` (`{id, name, steps: CadenceStep[]}`, `CadenceStep = {channel: 'email'\|'linkedin'\|'call', waitDaysAfterPrevious, ...}`) | `lib/cadences.ts` | `/api/cadences` CRUD |
| `outreach_logs` | inline shape `{id, leadId, brand, templateId, channel, subject, body, createdAt, tenantId, routingAllowed, routingReason}` | `app/api/outreach-logs/route.ts` | `/api/outreach-logs` POST |
| `company_settings` | `SalesSettings` (`ProductLine[]`, `DealSize`, `Upsell[]`, `ExampleCustomer[]`, `Seasonality`, `RevenueTarget`), keyed by brand | `app/lib/sales-settings.ts` | `/api/sales-settings/[brand]` PUT |
| `settings` (generic, keyed by `key`) | `pipeline_weights`, `stale_thresholds`, `concentration_risk_settings`, `forecast_calibration` | various `lib/*.ts` | `/api/settings` PUT |
| `winrate_calibration` | `WinRateDoc` | `app/lib/win-rate-store.ts` | Lazy recompute, 24h TTL |
| `ticket_size_calibration` | `TicketSizeCalibrationDoc` | `app/lib/ticket-size-calibration-store.ts` | Lazy recompute, 24h TTL |
| `forecast_snapshots` | — | `app/lib/forecast-snapshot.ts` | Weekly cron |

---

## 8. Cross-Cutting Concerns

### 8.1 Brand/tenant scoping

`app/lib/brand.ts` is the single source of truth: `BRAND_CONFIG` maps each `Brand` (`'cogmap'|'seyu'|'dvsc'`) to `{label, dbCollection, apiPrefix, currency}`. `resolveBrand()` normalizes a route param/alias (e.g. `"cogmapsales"` → `cogmap`) and returns `null` — never a silent wrong-brand fallback — for a genuinely unrecognized non-empty value; an empty/missing value still defaults to `'cogmap'`. 41 files import from it.

`lib/tenant.ts`'s `tenantFilter(tenantId)` builds the Mongo `$or` filter that also matches legacy docs missing `tenantId` when `tenantId === 'default'`; 30 files import it, covering essentially every read/write in `app/api/leads/**`, `app/api/battlecards/**`, `app/api/cadences/**`, `app/api/contacts/**`, `app/api/search`, `app/api/metrics/**`, `app/api/health`, `app/api/admin/cadence-tick`. `getTenantId(request)` extracts the query param with a `'default'` fallback.

⚠ **Two routes reimplement their own local copy instead of importing**: `app/api/boards/route.ts` and `app/api/health/route.ts` — a real inconsistency worth fixing if either route's tenant logic ever needs to change (currently harmless since the reimplementations match, but a future divergence risk).

Together, `BRAND_CONFIG[brand].dbCollection` picks the actual Mongo collection and `tenantFilter` further scopes rows within it — every query gets both dimensions.

### 8.2 Auth layering

Four distinct, deliberately non-overlapping guard mechanisms:

1. **`lib/api-auth.ts`** (`requireApiKey`/`isCronRequest`/`requireCronOrApiKey`) — machine-to-machine: shared `x-api-key` header (`SLG_API_KEY`) for the external research agent and admin/cron scripts, or `Authorization: Bearer $CRON_SECRET` for Vercel Cron. Fails open outside production if unconfigured, fails closed in production (issue #105). Used on write-heavy/admin routes (`cadences`, `battlecards`, `outreach-*`, `admin/*`).
2. **`lib/require-brand-access-api.ts`** (`requireBrandAccessApi`) — the route-handler combined guard: accepts the same `x-api-key` OR a valid `sso_id_token` cookie resolved via `lib/session.ts`'s `resolveSessionFromIdToken` + `lib/sso-access.ts`'s `getUserAccess`/`hasAccessToBrand`. Deliberately **not** built on top of `requireApiKey()` (would fail-open and defeat the session check) — has its own inline `hasValidApiKey`. Used on the core lead-data surface: `app/api/leads/**`, `app/api/contacts/**`, `app/api/contact-suggestions/**`.
3. **`lib/require-brand-access.ts`** (`requireBrandAccess`) — the Server Component page-level equivalent, calls Next's `redirect()` (can't return a `NextResponse`, hence a separate function from #2). Called at the top of all seven brand-scoped `page.tsx` files (§6).
4. **`lib/session.ts`**'s `requireSuperAdminSession` — strictest tier, session-only (no `x-api-key` fallback), gates `admin/users`, `admin/toggle`, `duplicate-reviews*`, `admin/duplicate-scan`, `prompts` — human-only surfaces reasoned to never need machine access.

SSO plumbing (`lib/sso.ts` PKCE flow + `lib/sso-access.ts` org-access model) underlies all four via `app/api/auth/login` → `oauth/callback` → `auth/session`, with `app/components/AuthProvider.tsx` as the client-side session context consumed by `AppNav`.

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
