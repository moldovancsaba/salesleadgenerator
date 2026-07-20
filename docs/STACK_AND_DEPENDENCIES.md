# Stack and Dependencies — Sales Lead Generator

**Version:** 2.1.0

---

## Runtime

| Component | Version | Role |
|-----------|---------|------|
| Node.js | 24.x on Vercel | Runtime |
| Next.js | 14.2.x | App framework and API routes |
| React | 18.3.0 | UI runtime |
| TypeScript | 5.x | Type safety |

---

## Frontend

| Component | Version | Status | Role |
|-----------|---------|--------|
| Mantine | 7.17.8 | Active | Component library |
| @tabler/icons-react | 3.42.0 | Active | Icons |
| Framer Motion | 12.38.0 | Unused | Declared but no application usage found |
| Sonner | 2.0.7 | Unused | Declared but no application usage found |
| @doneisbetter/gds | 3.4.3 | Underused | Provider wired; no GDS UI components composed in app code |

---

## Backend

| Component | Version | Status | Role |
|-----------|---------|--------|
| Mongoose | 8.x | Active | Schema/index management in `models/*.ts` |
| mongodb driver | 8.x | Active | Raw `MongoClient` used in `lib/mongodb.ts` and `scripts/*.js` |
| MongoDB | Atlas hosted | Active | Persistence |
| dotenv | 17.4.2 | Scripts-only | Used in `scripts/*.js` and `scripts/*.mjs`; not used in app code |

---

## Hosting and Delivery

| Component | Notes |
|-----------|-------|
| Vercel | Production hosting, preview deployments |
| MongoDB Atlas | Managed database cluster |
| PWA | Web app manifest, standalone mode |

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
| API key fallback | Allows request through if `SLG_API_KEY` is unset or header is missing | `lib/api-auth.ts` |
| Read access | Public for listings and health | Route handlers |
