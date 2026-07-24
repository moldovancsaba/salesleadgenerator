# Stack and Dependencies — Sales Lead Generator

**Version:** 2.4.29

---

## Runtime

| Component | Version | Role |
|-----------|---------|------|
| Node.js | 24.x on Vercel | Runtime |
| Next.js | ^16.2.11 (was 15.5.21) | App framework and API routes — bumped in 2.4.26, see Dependency Audit below. Convention file is `proxy.ts` (was `middleware.ts` pre-16). `dev`/`build`/`vercel-build` npm scripts are pinned to `--webpack` (see Tooling table). |
| React | ^19.2.8 (was 18.3.0) | UI runtime — bumped in 2.4.25, see Dependency Audit below |
| TypeScript | ^6.0.3 | Type safety (bumped from 5.x in 2.4.24 — see Dependency Audit below) |

---

## Frontend

| Component | Version | Status | Role |
|-----------|---------|--------|------|
| Mantine (`@mantine/core`, `hooks`, `modals`, `notifications`) | 9.4.2 (was 7.17.8) | Active | Component library — bumped in 2.4.27, see Dependency Audit below |
| @tabler/icons-react | 3.45.0 | Active | Icons |
| @sovereignsquad/gds-admin, gds-core, gds-theme | 3.11.1 | Active | Private design-system components/theme, installed from GitHub release tarballs (not the npm registry) — required for all UI/UX work per project policy. `gds-core` was a declared-but-unimported dependency until 2.3.1, when `app/card.tsx` started importing `ProductCard` from `@sovereignsquad/gds-core/client` (replaced by a flat, borderless `LeadCard` in 2.4.17 — see `docs/ARCHITECTURE.md`'s "Kanban Lead Card"). As of 2.4.10, `app/kanban.tsx` also imports `KanbanBoard` from `@sovereignsquad/gds-core/client` (`enableDrag` turned off again in 2.4.17, after a live production crash — see `docs/ARCHITECTURE.md`'s "Kanban Board and Drag-and-Drop"), and `app/components/Providers.tsx`'s theme adopts an `Input.vars` mobile-zoom-guard override modeled on GDS's own theme. **A 2.4.10 attempt to bump this to 3.11.0 was reverted in 2.4.11** after Vercel's `npm install` hit a real `404` (the `3.11.0` git tag existed, but its release tarball was never actually published — a bug in GDS's own release-automation workflow). **2.4.12 re-bumped to 3.11.1**, GDS's re-cut of the same release with the pipeline fixed; this time the tarballs were independently verified before shipping — fetched directly via `WebFetch` (a network path this sandbox's blocked `curl`/`Bash` can't reach), confirmed as real gzip archives containing the expected `package.json` `version`/`name`, and their SHA-512 `integrity` hashes computed twice independently (OpenSSL and Node `crypto`, matching) rather than guessed. **2.4.13 fixed a second, different real build failure this uncovered**: `next build` failed with `Module not found: Can't resolve '@dnd-kit/core'` (and `sortable`/`utilities`) — see the `@dnd-kit/*` row below. |
| @dnd-kit/core, sortable, utilities | ^6.3.1, ^10.0.0, ^3.2.2 | Active | Direct dependencies as of 2.4.13. `@sovereignsquad/gds-core@3.11.1`'s own `package.json` declares these as regular (non-peer) `dependencies` — they should install transitively, but this repo's `package-lock.json` had been out of sync with the real dependency tree for a long time (confirmed identical at a commit predating any GDS work this session did), so the transitive subtree of the tarball-installed `gds-core` was never discovered. Declared directly here so they're unambiguously present regardless of any lockfile-caching quirks around the privately-tarball-installed GDS packages. Added via a real `npm install` against the public `registry.npmjs.org` (confirmed reachable from this sandbox, unlike `github.com`), not hand-edited — real resolved URLs/`integrity` hashes. |

There is no Framer Motion or Sonner dependency in this project — both were previously listed here in error; verified against `package.json`, neither package appears anywhere in it.

---

## Backend

| Component | Version | Status | Role |
|-----------|---------|--------|------|
| Mongoose | ^9.8.0 (was 8.24.1) | Ops-scripts only | Used only as a connection helper (`mongoose.connect()`, then dropped straight to `mongoose.connection.db.collection(...)`) in standalone maintenance scripts (`scripts/seed.js`, `scripts/check-db.js`, `scripts/audit-db.js`, `scripts/fix-*-region*.js`). The unused `models/Lead.ts`/`OutcomeLog.ts`/`SearchLearning.ts` schema files (never imported by the app itself, drifted from the real data shape) were deleted in 2.4.7 — the app's own reads/writes have exclusively used the raw driver since before this repo's own tracked history, and nothing anywhere signaled an intended future Mongoose migration path. Bumped to 9.8.0 in 2.4.28 — see Dependency Audit below for the real hidden risk this bump uncovered. The original rationale for choosing Mongoose/MongoDB at all (`_archived/STACK_DECISION.md` — historical, several of its specifics are now out of date) is preserved there rather than repeated here. |
| mongodb driver | **direct dependency, `^6.20.0`, added explicitly in 2.4.28** | Active | Raw `MongoClient` used in `lib/mongodb.ts` and every API route handler. **Was never actually declared in `package.json`** before 2.4.28 — it only existed in `node_modules` as a hoisted transitive dependency of `mongoose`. Bumping `mongoose` to 9.x (which bundles `mongodb@~7.5` instead of 8.x's `~6.20`) silently promoted this hoisted copy to 7.5.0 on `npm install` — a major-version bump of the app's live database driver as an undeclared side effect of an "ops-scripts only" dependency change. Fixed by declaring `mongodb` directly here, pinned to the version this app's code has always actually been verified against — the same "declare it directly, don't rely on another package's transitive hoisting" precedent already set for `@dnd-kit/*` in 2.4.13. |
| MongoDB | Atlas hosted | Active | Persistence |
| dotenv | ^17.4.2 | Scripts-only | Used in `scripts/*.js` and `scripts/*.mjs`; not used in app code |

---

## Tooling

| Component | Version | Status | Role |
|-----------|---------|--------|------|
| ESLint | ^9.39.5 | Active | Flat config (`eslint.config.mjs`), importing `eslint-config-next/core-web-vitals`'s own native flat-config array directly (the repo's prior `@eslint/eslintrc` `FlatCompat` bridge was removed in 2.4.26 — `eslint-config-next` has shipped genuine flat config for a while; the bridge was unneeded and became a real crash source under ESLint 10, see below). Run via the plain `eslint .` CLI (`npm run lint`), not the deprecated `next lint` wrapper. **ESLint 10.7.0 was attempted in 2.4.26 and reverted** — `@typescript-eslint/parser@8.65.0` throws `scopeManager.addGlobals is not a function` under ESLint 10's core API, a confirmed open upstream bug (typescript-eslint issues #11829/#11830). Revisit once typescript-eslint ships `ScopeManager.addGlobals()` support. |
| eslint-config-next | ^16.2.11 (was 15.5.13) | Active | Next.js's recommended ESLint ruleset — bumped alongside `next` in 2.4.26 (versioned in lockstep with the Next.js major it supports). `react-hooks/set-state-in-effect`, a new rule in this version's bundled `eslint-plugin-react-hooks`, is disabled repo-wide in `eslint.config.mjs` — see that file's comment for the rationale (a deliberate, safe, pervasive pattern, not a real bug). |
| Vitest | ^4.1.10 | Active | Unit tests (`tests/lib/*.test.ts`, `vitest.config.ts`) — deliberately excludes `tests/integration/**` from the default run |
| tsx | ^4.7.0 | Active | Runs the smoke test (`tests/smoke/*.smoke.ts`) directly |
| mongodb-memory-server | ^11.2.0 | Active (2.4.23) | Real in-process MongoDB for `tests/integration/*` (`npm run test:integration`, `vitest.integration.config.ts`), so route handlers are tested against genuine Mongo query/aggregation behavior rather than a mock. Downloads a real `mongod` binary from `fastdl.mongodb.org` on first use — **confirmed blocked by this development sandbox's own network policy** (verified via its proxy status endpoint: a policy-level `403` on `CONNECT`, the same restriction class as GitHub release-asset downloads, not a version/mirror mismatch). Works normally in environments where that host is reachable (a developer's own machine, most CI runners). |

---

## Hosting and Delivery

| Component | Notes |
|-----------|-------|
| Vercel | Production hosting, preview deployments |
| MongoDB Atlas | Managed database cluster |
| PWA | Web app manifest, standalone mode, minimal shell-only service worker (`public/sw.js`), CSS + JS zoom lock (`app/globals.css`, `app/components/PwaSetup.tsx`) — see `docs/ARCHITECTURE.md`'s "PWA and Zoom Lock" section |

---

## Agent and Scheduling

| Component | Role |
|-----------|------|
| OpenClaw agent | Research, enrichment, and kanban feedback learning |
| OpenClaw cron | Scheduled discovery and enrichment runs |

---

## Auth and Middleware

| Component | Behavior | Evidence |
|-----------|----------|----------|
| CORS/security headers | Applied in `proxy.ts` (was `middleware.ts` pre-Next.js-16 — renamed in 2.4.26, Next 16's mandatory convention-file rename; content and behavior unchanged, only the exported function renamed `middleware` → `proxy`) for `/api/*` | `proxy.ts` |
| API key auth | `requireApiKey` in `lib/api-auth.ts` guards write/admin routes | `lib/api-auth.ts` |
| API key fail-open | If `SLG_API_KEY` is unset entirely, all requests are allowed through (documented, intentional trade-off for local/dev use) | `lib/api-auth.ts` |
| Read access | Public for listings and health | Route handlers |

**Note:** as of 2.2.0, when `SLG_API_KEY` *is* set, a request must send the exact matching `x-api-key` header — a missing header is rejected (401) identically to a wrong one. Earlier versions incorrectly allowed a missing header through even when a key was configured; this was fixed as a security patch.

---

## Dependency Audit (2.4.22, updated 2.4.28 — "deliver the rest" migration complete)

`npm outdated` confirms every installed package satisfies its own declared semver range (no drift). Sequenced migration in progress ("deliver the rest," follow-on to 2.4.22's housecleaning pass) — real dependency constraints discovered via verification, not assumed:

| Package | Current | Target | Status |
|---------|---------|--------|--------|
| typescript | **6.0.3** (was 5.9.3) | 7.0.2 | **Bumped to 6 in 2.4.24. 7 is explicitly blocked**: `@typescript-eslint/parser` (used transitively by `eslint-config-next`) has a hard runtime rejection of TS 7.0 — confirmed via a real `npm run lint` failure, not assumed. TS 7.0 GA'd 2026-07-08; its own ecosystem hasn't caught up yet (tracked upstream: see typescript-eslint issue #10940 for TS ≥7.1 support). Revisit once that lands. |
| eslint | **9.39.5** (attempted 10.7.0, reverted) | 10.7.0 | **Attempted in 2.4.26 after the sequencing block above cleared** (`eslint-config-next@16.2.11` accepts `eslint: >=9.0.0`). Blocked by a *different*, genuinely open upstream issue: `@typescript-eslint/parser@8.65.0` throws `scopeManager.addGlobals is not a function` under ESLint 10's core API (typescript-eslint issues #11829/#11830 — no fix released yet). Reverted to 9.39.5. Revisit once typescript-eslint ships support. |
| react, react-dom | **19.2.8** (was 18.3.1) | — | **Bumped in 2.4.25.** All direct dependencies verified peer-compatible before bumping (`npm view <pkg> peerDependencies` for `@mantine/core@7.17.8`: `^18.x \|\| ^19.x`; `@dnd-kit/*`, `@tabler/icons-react`: open lower bounds; `@sovereignsquad/gds-theme` — the only GDS package declaring peers — explicitly supports `react: ^18.2.0 \|\| ^19.0.0`). `tsc`/`eslint`/`vitest`/smoke/build all clean; real-browser check (Playwright against the pre-installed Chromium) on the kanban board, outreach templates page, and landing page found no React-specific console errors (no hydration warnings, no ref/prop-type issues) — only the expected `503`s from this sandbox's missing `MONGODB_URI`, unrelated to this bump. |
| @types/react, @types/react-dom | **19.2.17 / 19.2.3** (was 18.3.x) | — | **Bumped alongside `react`/`react-dom` in 2.4.25** — kept in lockstep so the type definitions match the installed runtime. |
| @mantine/core, hooks, modals, notifications | **9.4.2** (was 7.17.8) | — | **Bumped directly 7→9 in 2.4.27** (single jump — real research found the 7→8 leg changes only `@mantine/dates`/`@mantine/carousel`/`@mantine/code-highlight`/`Portal`/`Switch`/`Popover`/`Menu.Item` defaults, none of which this codebase uses; the 8→9 leg was already confirmed inapplicable). `@sovereignsquad/gds-theme`'s peers (`^7.9.0 \|\| ^8.3.0 \|\| ^9.0.0`), Mantine 9's own React peer (`^18.x \|\| ^19.x`, satisfied by the installed 19.2.8), and `postcss-preset-mantine`/`postcss-simple-vars`'s generic (non-Mantine-versioned) PostCSS peers were all verified compatible before bumping. `showNotification` (the only direct `@mantine/notifications` API this app calls, in `app/detail.tsx`) confirmed still exported in 9.4.2. Full gate clean; real-browser check across 6 pages found zero Mantine/React console errors. |
| next | **16.2.11** (was 15.5.21) | — | **Bumped in 2.4.26.** `middleware.ts` renamed to `proxy.ts` (mandatory convention-file rename, content unchanged). `dev`/`build`/`vercel-build` pinned to `--webpack` after finding two distinct, confirmed Turbopack-specific bugs in this release: a production-build page-collection failure on `/api/admin/data-hygiene`, and a dev-mode rendering crash on the kanban board (`/sales/[brand]`) — both resolved cleanly under webpack, neither reproducible there. **Does NOT resolve the 3 CVEs below, contrary to what this table previously stated** — empirically re-verified via `npm ls postcss`/`npm ls sharp` after the bump: identical vulnerable versions still bundled. Full gate clean: `tsc`/`eslint`/`vitest` (49/49)/smoke (5/5)/`next build --webpack` (all 23 routes). |
| eslint-config-next | **16.2.11** (was 15.5.21) | — | **Bumped alongside `next` in 2.4.26.** |
| mongoose | **9.8.0** (was 8.24.1) | — | **Bumped in 2.4.28, the final step of "deliver the rest."** Ops-scripts only (see Backend table above) — real research confirmed the connect/disconnect/collection API surface these scripts use is byte-for-byte unchanged in v9, and Node 22.22.2/24.x satisfies v9's `>=20.19.0` floor. **Uncovered a real hidden risk in the process**: mongoose 9.x bundles `mongodb@~7.5` (was `~6.20` in mongoose 8.x), and since this app's own `mongodb` driver had never been declared as a direct dependency (only ever hoisted transitively from mongoose), bumping mongoose alone silently promoted the app's *live* database driver to 7.5.0 — see the `mongodb driver` row in the Backend table above for the fix (pinned `mongodb` directly at `^6.20.0`). |
| @types/node | 20.19.43 | 26.1.1 | **Not part of the "deliver the rest" plan** — the original 7-step migration scope was integration tests, TypeScript, React, Next.js/ESLint, Mantine, and Mongoose only. Left as its own, separately-scoped future item; bumping devDependency-only Node types 20→26 needs its own review of any `@types/node` surface this repo's code actually touches, not a drive-by bump alongside this closed-out effort. |

`npm audit` (read-only) surfaces 3 high-severity advisories — PostCSS XSS/arbitrary-file-read and `sharp`'s bundled `libvips` CVEs — both confirmed via `npm ls` to live **inside `next`'s own `node_modules`** (`next → postcss@8.4.31`, `next → sharp@0.34.5`). **Corrected in 2.4.26**: this table previously claimed the pending Next.js 16 upgrade would resolve these as a side effect. That was wrong — empirically re-verified via `npm ls postcss`/`npm ls sharp` after installing `next@16.2.11`: the identical vulnerable versions are still bundled, unchanged, in Next.js's own dependency tree. There is currently no available fix short of Next.js's own upstream bumping these bundled versions in a future release; this is not this app's own top-level `postcss` (already current). `npm audit fix --force`'s auto-suggested resolution is a downgrade to `next@9.3.3`, which is nonsensical and was not applied. The real, low-severity mitigating context: this app never imports `next/image` (zero `sharp` exposure) and never processes untrusted CSS at build time (low real `postcss` exploit surface). Recorded here explicitly, per this repo's own rule that an unavoidable transitive issue must be named rather than silently carried forward.

---

## Known Package-Manager Constraint

`@sovereignsquad/gds-admin`, `gds-core`, and `gds-theme` are installed directly from GitHub release-asset URLs (not the npm registry). Any CI/build environment whose network egress policy blocks `github.com` release-asset downloads cannot run `npm install` against the real `package.json` — Vercel's build environment is unaffected and installs them normally.
