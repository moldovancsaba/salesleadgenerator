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

| Component | Version | Role |
|-----------|---------|------|
| Mantine | 7.17.8 | Component library |
| @tabler/icons-react | 3.42.0 | Icons |
| Framer Motion | 12.38.0 | Animation |
| Sonner | 2.0.7 | Toasts/notifications |
| @doneisbetter/gds | 3.4.3 | Design system provider |

---

## Backend

| Component | Version | Role |
|-----------|---------|------|
| Mongoose | 8.x | MongoDB ODM |
| MongoDB | Atlas hosted | Persistence |
| dotenv | 17.4.2 | Environment loading |

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

## Why MongoDB Atlas and Mongoose

- Lead data is document-shaped and evolves frequently during research iteration.
- Atlas provides managed backups, networking controls, and query performance without operating self-hosted MongoDB.
- Mongoose was chosen over Prisma because the lead schema changes often, and the team wanted direct MongoDB features without a codegen step.

---

## Known Constraints

- Full `next build` can OOM in limited local environments. Use `tsc --noEmit` for type verification in those cases.
- Vercel serverless functions enforce execution time and memory limits; large list pages should paginate or limit result sets.
