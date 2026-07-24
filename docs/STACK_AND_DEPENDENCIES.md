# Stack and Dependencies — Sales Lead Generator

**Version:** 2.4.15

---

## Runtime

| Component | Version | Role |
|-----------|---------|------|
| Node.js | 24.x on Vercel | Runtime |
| Next.js | ^15.5.13 (resolves 15.5.21) | App framework and API routes |
| React | 18.3.0 | UI runtime |
| TypeScript | 5.x | Type safety |

---

## Frontend

| Component | Version | Status | Role |
|-----------|---------|--------|------|
| Mantine (`@mantine/core`, `hooks`, `modals`, `notifications`) | 7.17.8 | Active | Component library |
| @tabler/icons-react | 3.45.0 | Active | Icons |
| @sovereignsquad/gds-admin, gds-core, gds-theme | 3.11.1 | Active | Private design-system components/theme, installed from GitHub release tarballs (not the npm registry) — required for all UI/UX work per project policy. `gds-core` was a declared-but-unimported dependency until 2.3.1, when `app/card.tsx` started importing `ProductCard` from `@sovereignsquad/gds-core/client`. As of 2.4.10, `app/kanban.tsx` also imports `KanbanBoard` from `@sovereignsquad/gds-core/client` (with `enableDrag`), and `app/components/Providers.tsx`'s theme adopts an `Input.vars` mobile-zoom-guard override modeled on GDS's own theme. **A 2.4.10 attempt to bump this to 3.11.0 was reverted in 2.4.11** after Vercel's `npm install` hit a real `404` (the `3.11.0` git tag existed, but its release tarball was never actually published — a bug in GDS's own release-automation workflow). **2.4.12 re-bumped to 3.11.1**, GDS's re-cut of the same release with the pipeline fixed; this time the tarballs were independently verified before shipping — fetched directly via `WebFetch` (a network path this sandbox's blocked `curl`/`Bash` can't reach), confirmed as real gzip archives containing the expected `package.json` `version`/`name`, and their SHA-512 `integrity` hashes computed twice independently (OpenSSL and Node `crypto`, matching) rather than guessed. **2.4.13 fixed a second, different real build failure this uncovered**: `next build` failed with `Module not found: Can't resolve '@dnd-kit/core'` (and `sortable`/`utilities`) — see the `@dnd-kit/*` row below. |
| @dnd-kit/core, sortable, utilities | ^6.3.1, ^10.0.0, ^3.2.2 | Active | Direct dependencies as of 2.4.13. `@sovereignsquad/gds-core@3.11.1`'s own `package.json` declares these as regular (non-peer) `dependencies` — they should install transitively, but this repo's `package-lock.json` had been out of sync with the real dependency tree for a long time (confirmed identical at a commit predating any GDS work this session did), so the transitive subtree of the tarball-installed `gds-core` was never discovered. Declared directly here so they're unambiguously present regardless of any lockfile-caching quirks around the privately-tarball-installed GDS packages. Added via a real `npm install` against the public `registry.npmjs.org` (confirmed reachable from this sandbox, unlike `github.com`), not hand-edited — real resolved URLs/`integrity` hashes. |

There is no Framer Motion or Sonner dependency in this project — both were previously listed here in error; verified against `package.json`, neither package appears anywhere in it.

---

## Backend

| Component | Version | Status | Role |
|-----------|---------|--------|------|
| Mongoose | ^8.0.0 | Ops-scripts only | Used only as a connection helper (`mongoose.connect()`, then dropped straight to `mongoose.connection.db.collection(...)`) in standalone maintenance scripts (`scripts/seed.js`, `scripts/check-db.js`, `scripts/audit-db.js`, `scripts/fix-*-region*.js`). The unused `models/Lead.ts`/`OutcomeLog.ts`/`SearchLearning.ts` schema files (never imported by the app itself, drifted from the real data shape) were deleted in 2.4.7 — the app's own reads/writes have exclusively used the raw driver since before this repo's own tracked history, and nothing anywhere signaled an intended future Mongoose migration path. The original rationale for choosing Mongoose/MongoDB at all (`_archived/STACK_DECISION.md` — historical, several of its specifics are now out of date) is preserved there rather than repeated here. |
| mongodb driver | direct dependency | Active | Raw `MongoClient` used in `lib/mongodb.ts` and every API route handler |
| MongoDB | Atlas hosted | Active | Persistence |
| dotenv | ^17.4.2 | Scripts-only | Used in `scripts/*.js` and `scripts/*.mjs`; not used in app code |

---

## Tooling

| Component | Version | Status | Role |
|-----------|---------|--------|------|
| ESLint | ^9.17.0 | Active | Flat config (`eslint.config.mjs`), bridging `eslint-config-next`'s legacy-format `next/core-web-vitals` preset via `@eslint/eslintrc`'s `FlatCompat` (that package doesn't yet ship a native flat-config export). Run via the plain `eslint .` CLI (`npm run lint`), not the deprecated `next lint` wrapper. |
| eslint-config-next | ^15.5.13 | Active | Next.js's recommended ESLint ruleset |
| Vitest | ^4.1.10 | Active | Unit tests (`tests/lib/*.test.ts`) |
| tsx | ^4.7.0 | Active | Runs the smoke test (`tests/smoke/*.smoke.ts`) directly |

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
| CORS/security headers | Applied in `middleware.ts` for `/api/*` | `middleware.ts` |
| API key auth | `requireApiKey` in `lib/api-auth.ts` guards write/admin routes | `lib/api-auth.ts` |
| API key fail-open | If `SLG_API_KEY` is unset entirely, all requests are allowed through (documented, intentional trade-off for local/dev use) | `lib/api-auth.ts` |
| Read access | Public for listings and health | Route handlers |

**Note:** as of 2.2.0, when `SLG_API_KEY` *is* set, a request must send the exact matching `x-api-key` header — a missing header is rejected (401) identically to a wrong one. Earlier versions incorrectly allowed a missing header through even when a key was configured; this was fixed as a security patch.

---

## Known Package-Manager Constraint

`@sovereignsquad/gds-admin`, `gds-core`, and `gds-theme` are installed directly from GitHub release-asset URLs (not the npm registry). Any CI/build environment whose network egress policy blocks `github.com` release-asset downloads cannot run `npm install` against the real `package.json` — Vercel's build environment is unaffected and installs them normally.
