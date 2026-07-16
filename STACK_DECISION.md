# Stack Decision — SLG v2.0

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| **Frontend** | Next.js 14 (App Router) | Server components, API routes in same repo, Vercel-optimized |
| **UI Library** | Mantine 7 | Component-rich, accessible, good mobile support |
| **Database** | MongoDB Atlas | Flexible schema for evolving lead data, Atlas managed |
| **ODM** | Mongoose 8.x | Schema validation, middleware, direct MongoDB access |
| **Hosting** | Vercel | Next.js native, preview deployments, env management |
| **Research** | OpenClaw agent | Web search + fetch, cron scheduling, memory continuity |
| **Scheduling** | OpenClaw cron | Configurable lead generation runs |

## Why Mongoose Instead of Prisma

SLG uses Mongoose for:
1. **Rapid schema evolution** — lead schema changes frequently during research iteration
2. **Direct MongoDB features** — aggregations, text search, unique indexes
3. **No codegen step** — simpler build pipeline on Vercel
4. **Existing implementation** — stable, tested, no migration needed

## Why Not Other Options

| Option | Reason Not Chosen |
|--------|------------------|
| Prisma | Codegen overhead, less flexible for evolving schemas |
| PostgreSQL | Lead data is document-shaped, benefits from MongoDB flexibility |
| React Native | Web PWA is sufficient, no app store needed |
| Firebase | Vendor lock-in, less control over schema |

## Deployment

- **Vercel project:** `salesleadgenerator`
- **Production URL:** https://salesleadgenerator.vercel.app
- **Build:** `npm run build` → `next build` → static + serverless functions

## Environment

| Variable | Set On | Purpose |
|----------|--------|---------|
| `MONGODB_URI` | Vercel production | MongoDB Atlas connection |

---

*Updated: July 16, 2026 — SLG v2.0*
