# Development Gaps — Tech Stack Audit

**Version:** 2.1.0

This file is based on direct file inspection, not guesswork. Evidence paths are included for every claim.

---

## Audit Scope

- `package.json`
- `next.config.js`, `tsconfig.json`, `postcss.config.js`, `.env.local`, `.vercel/project.json`
- Import scans across `app/`, `lib/`, `models/`, `scripts/`
- Runtime/routing inspection of `middleware.ts`, `lib/mongodb.ts`, `lib/api-auth.ts`
- Actual `app/api/**/route.ts` and `app/**/*.tsx` files

---

## Declared Stack

From `package.json`:

- **Framework:** Next.js 14.2.x
- **Runtime:** Node.js 24.x on Vercel
- **UI:** Mantine 7.17.8, @tabler/icons-react 3.42.0
- **Design system:** @doneisbetter/gds 3.4.3
- **Notifications/toasts:** sonner 2.0.7
- **Animation:** framer-motion 12.38.0
- **Database:** MongoDB Atlas via mongoose 8.x
- **Build/style:** postcss 8.4.0, postcss-preset-mantine 1.18.0, postcss-simple-vars 7.0.1
- **Auth/env:** dotenv 17.4.2
- **Types:** TypeScript 5.x, @types/node 20.x, @types/react 18.x, @types/react-dom 18.x

From configs:

- `next.config.js`: empty/default Next.js config
- `tsconfig.json`: strict TypeScript with path alias `@/*`
- `postcss.config.js`: Mantine preset + simple-vars breakpoint overrides
- `.vercel/project.json`: Vercel project `salesleadgenerator`
- `.env.local`: Vercel OIDC token only

---

## Used Stack

### Confirmed used
- **Next.js API routes:** `app/api/boards/route.ts`, `app/api/health/route.ts`, `app/api/leads/route.ts`, `app/api/outcome-logs/route.ts`, `app/api/outreach-logs/route.ts`, `app/api/outreach-templates/route.ts`, `app/api/search-learning/route.ts`, `app/api/search/route.ts`, `app/api/stats/route.ts`
- **Mantine core:** imported in `app/outreach/compose-modal.tsx`, `app/outreach/templates/page.tsx`, `app/kanban.tsx`, `app/sales/[brand]/page.tsx`, `app/detail.tsx`, `app/search-learning.tsx`, `app/components/unified-card.tsx`, `app/components/gds/primitives.ts`, `app/components/ui/index.tsx`, `app/metrics.tsx`
- **Mantine notifications:** `showNotification` imported in `app/sales/[brand]/page.tsx` and `app/detail.tsx`
- **Mantine modals:** used via modal system in detail/outreach flows
- **Tabler icons:** imported in outreach compose, templates, kanban, pipeline page, detail, search-learning, metrics, and `app/components/gds/primitives.ts`
- **Mongoose/models:** `models/Lead.ts`, `models/OutcomeLog.ts`, `models/SearchLearning.ts`
- **MongoDB driver:** `lib/mongodb.ts` uses `mongodb` `MongoClient`
- **API auth:** `lib/api-auth.ts` enforces `x-api-key` for write/admin routes
- **Middleware:** `middleware.ts` sets CORS and security headers for `/api/*`
- **dotenv:** used only in `scripts/*.js` and `scripts/*.mjs`
- **GDS provider:** `app/components/gds-provider.tsx` imports from `@doneisbetter/gds/client`

### Confirmed unused or minimally used
- **sonner:** declared in `package.json`, no import/usage found in `app/`, `lib/`, `models/`, or `scripts/`
- **framer-motion:** declared in `package.json`, no import/usage found in `app/`, `lib/`, `models/`, or `scripts/`
- **@doneisbetter/gds:** installed and provider-wired, but no GDS components are used beyond `GdsProvider`, `GdsToastProvider`, `GdsNotificationProvider`, `GdsConfirmProvider`, `CommandRegistryProvider`, and `resolveGdsThemePreset`
- **postcss-simple-vars:** used only for Mantine breakpoint overrides in `postcss.config.js`; no app-level custom CSS variables are defined
- **dotenv in app code:** not used; app relies on Vercel runtime env

---

## Abandoned or At-Risk Stack

### Likely abandoned
- **sonner**
  - Evidence: declared dependency, zero application usage.
  - Risk: dead dependency; increases bundle size and maintenance surface.
- **framer-motion**
  - Evidence: declared dependency, zero application usage.
  - Risk: same as sonner; also suggests planned motion system was never completed.

### Underused but present
- **@doneisbetter/gds**
  - Evidence: provider setup exists, but no GDS UI components are composed in app code.
  - Risk: installed complexity without payoff; token/theme unification opportunity is missed.

### Config/runtime drift
- **Mongoose vs mongodb driver split**
  - Evidence: `models/*.ts` use Mongoose; `lib/mongodb.ts` and `scripts/*.js` use raw `mongodb` `MongoClient`.
  - Risk: two DB access paths; schema validation and connection behavior differ.
- **API key auth is soft**
  - Evidence: `lib/api-auth.ts` returns `null` when `SLG_API_KEY` is unset, and also when header is missing even if key is set.
  - Risk: protected routes may behave as public without intentional config review.
- **Multiple env var names for DB**
  - Evidence: `MONGODB_URI`, `MONGODB_URI_LEADS`, `MONGODB_URI_CLASCOUT` are accepted in several route files.
  - Risk: unclear which DB is active; possible cross-project config bleed.

---

## Unification Recommendations

### Remove dead dependencies
- Remove `sonner` and `framer-motion` unless there is a concrete planned feature requiring them.
- Remove unused PostCSS plugin config if no custom CSS variables are needed beyond Mantine defaults.

### Converge database access
- Choose one MongoDB access strategy:
  - Option A: Mongoose everywhere, including `lib/mongodb.ts` and scripts.
  - Option B: native `mongodb` driver everywhere, including models and scripts.
- Current evidence favors keeping Mongoose for schema/index management, but `lib/mongodb.ts` should use Mongoose or a shared client wrapper instead of raw `MongoClient`.

### Harden auth semantics
- Make `requireApiKey` behavior explicit:
  - if `SLG_API_KEY` is set, reject missing/invalid keys
  - if unset, either fail closed in non-local environments or document allowed-open behavior
- Avoid silent public access in production-like environments.

### Normalize env/config
- Use one DB URI variable name in production, or document exact per-environment mapping.
- Move Vercel OIDC token out of `.env.local` if it is not used by the app.

### Adopt GDS deliberately
- Either:
  - Remove GDS entirely if it will not be used, or
  - Start replacing inline styles and repeated Mantine composition with GDS tokens/components in one focused UI layer
- Current middle state is the worst option: dependency cost without design-system payoff.

### Consolidate style strategy
- Use Mantine theme tokens and component props as the primary style mechanism.
- Reserve inline styles for truly one-off responsive behaviors.
- Centralize breakpoints in theme instead of duplicated `767px` checks.

---

## Delivery Plan

### Phase 1 — Stop the drift
1. Audit test coverage for auth, DB, and API routes.
2. Decide on Mongoose-only vs driver-only database access.
3. Decide on GDS adoption vs removal.
4. Remove `sonner` and `framer-motion` if not adopted within agreed timeline.

### Phase 2 — Converge stack
5. Update `lib/mongodb.ts` to match chosen DB strategy.
6. Update `scripts/*` to match chosen DB strategy.
7. Update `lib/api-auth.ts` to explicit open/closed behavior.
8. Rename/normalize DB env vars or document mapping.

### Phase 3 — Theme/style unification
9. Introduce shared local design tokens if GDS is removed.
10. If GDS is kept, replace highest-traffic inline styles with GDS/Mantine theme usage.
11. Centralize breakpoints and remove duplicated media-query literals.

### Phase 4 — Verification
12. Run `tsc --noEmit`.
13. Run API route verification against local/test deployment.
14. Update `development.md`, `CHANGELOG.md`, and `documentationtasks.md` with outcomes.

---

## Risk Notes

- **DB split:** highest operational risk because schema, validation, and connection pooling differ.
- **Auth softness:** security risk if this app is exposed beyond internal use.
- **Env drift:** moderate risk; unclear DB target can cause silent cross-tenant writes in multi-database setups.
