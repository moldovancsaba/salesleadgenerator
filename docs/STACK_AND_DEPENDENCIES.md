# Stack and Dependencies — Sales Lead Generator

**Version:** 2.4.6

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
| @sovereignsquad/gds-admin, gds-core, gds-theme | 3.10.0 | Active | Private design-system components/theme, installed from GitHub release tarballs (not the npm registry) — required for all UI/UX work per project policy. `gds-core` was a declared-but-unimported dependency until 2.3.1, when `app/card.tsx` started importing `ProductCard` from `@sovereignsquad/gds-core/client`. |

There is no Framer Motion or Sonner dependency in this project — both were previously listed here in error; verified against `package.json`, neither package appears anywhere in it.

---

## Backend

| Component | Version | Status | Role |
|-----------|---------|--------|------|
| Mongoose | ^8.0.0 | Declared, but unused | `models/*.ts` define schemas (`Lead`, `OutcomeLog`, `SearchLearning`) but none are imported anywhere in the app — all real reads/writes use the raw `mongodb` driver. `models/Lead.ts`'s pro/con fields were corrected to the generic `pro_for_organization`/`con_for_organization` naming in 2.3.0, matching the real schema. Whether to delete these unused files entirely or wire them into a future Mongoose migration path is still an open decision. |
| mongodb driver | via mongoose's dependency, used directly | Active | Raw `MongoClient` used in `lib/mongodb.ts` and every API route handler |
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
