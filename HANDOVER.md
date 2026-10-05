# HANDOVER: Sales Lead Generator
Date: 2026-10-05. Owner: moldovancsaba. Board: https://github.com/users/moldovancsaba/projects/56. Repo: https://github.com/moldovancsaba/salesleadgenerator. Production: https://salesleadgenerator.vercel.app.

The previous handover (session of 2026-08-13, about an unpushed branch) is archived at [docs/handover-2026-08-13.md](docs/handover-2026-08-13.md). Do not act on it: the work it describes (`fieldVerifications`, issue #188) shipped in 2.4.182 (commit `03446dc`, on `main`). The branch itself (tip `ce9757d` at deletion, 4 commits not in `main`) is in the backup bundle.

## What this is
A Next.js 16 sales-intelligence app: a kanban board, table view, metrics, outreach, cadences, quotes and an admin area for sports-organization leads, one workspace per brand (`cogmap`, `seyu`, `dvsc`; brands are runtime-editable in the database, issue #195). Sales teams use it; an external research agent (the OpenClaw cron in the separate `researchandenrich` repo) discovers and enriches leads and writes them through this app's API. It is NOT the research agent, and it has no unauthenticated read path to lead data (see README "API Overview").

## State today
- Version 2.4.247 (`package.json`, package name `slg-leads`). `main` and `origin/main` are both at `52bf122` (2026-10-05, AGENTS.md as canonical agent file plus MIT licence). Last code change: `a60ae23`, 2026-09-27, automation-tick scan order (#233).
- Deploys on Vercel (production URL above). `vercel.json` holds only the 7 cron entries; README documents `vercel deploy --prod`. The repo has no CI workflows (no tracked files under `.github/`). Whether pushing to `main` triggers a Vercel Git deploy is unverified.
- Database: MongoDB Atlas. `GET /api/health` on 2026-10-05 11:54 UTC returned `status: ok`, `lastError: null`, 2308 / 702 / 66 leads (cogmap / seyu / dvsc), and a forecast snapshot captured at 06:00 UTC the same day (the Monday cron time in `vercel.json`).
- Quality gate on 2026-10-05, after `npm ci`: `tsc` 0 errors, lint clean, 1170 unit tests, 5 smoke checks, all passing (commit message of `52bf122`). `npm run audit:gds-style` exits 0 (checked 2026-10-05). Integration tests: 583 passing per CHANGELOG 2.4.247 (not re-run on 2026-10-05).
- Operations are paused since 2026-09-28: the OpenClaw jobs that hit this app remotely are not running, but the app stays deployed (machine-level note: `/Users/Shared/Projects/HANDOVER.md`). Do not restart the agent jobs without the owner.
- Branches: the remote has `main` and `dev` only. On 2026-10-05 all 34 other remote branches were deleted after being backed up as a git bundle (see Traps).
- Known broken: nothing known in the code. Remaining work is data backfill and owner-blocked tasks (see In flight).

## Run, test, deploy
Install: `npm ci` (README says `npm install`). Dev server: `npm run dev`. Env var names and meaning: README "Environment variables" table and `.env.example` (names only; `.env.local` is gitignored and local).
The gate (AGENTS.md section 1; zero tolerance, run all four and read the output):
```
npx tsc --noEmit
npm run lint
npx vitest run
npm run test:smoke
```
Also available: `npm run test:integration` (in-memory MongoDB), `npm run audit:gds-style`, `npm run build` (webpack, pinned). Deploy: `vercel deploy --prod` (needs a logged-in Vercel CLI; unverified from this machine). Production env vars are set in the Vercel dashboard, not in the repo.

## In flight
Board #56 is the tracker. Open PRs: none (checked 2026-10-05 via the REST API). Open issues: 6 (REST `gh api repos/moldovancsaba/salesleadgenerator/issues?state=open`; `gh issue list` was rate-limited on GraphQL). Most important:
- #132 (P1, in progress): backfill existing leads into the controlled taxonomy; multi-session data work, log in `docs/LEAD_TAXONOMY_MIGRATION_PLAN.md`.
- #202 (P1, blocked): inbound email activation (DNS, Resend keys); owner deferred it on 2026-09-27.
- #137 (P1, blocked): duplicate leads at scale; code is done, the merge review is an owner/client task.
- #220 (P3, blocked) and its parent #210: move cron and agent to scoped API keys, then retire `SLG_API_KEY`; needs a super-admin browser session.
- #165 (P3): stays open on purpose as the onboarding-tour design record.
Per-issue detail: `roadmap.md` (last synced 2026-09-27).

## Traps and decisions
- **Board vs roadmap.md.** AGENTS.md section 2.5 and `roadmap.md` say the Projects board was unreachable from an earlier session and `roadmap.md` is the hand-kept substitute. The owner-wide rule is one board per repo, #56. Board contents were not verified for this handover (GraphQL was rate limited). Check #56 first; keep `roadmap.md` in step until the owner says otherwise; never create a second board.
- **Push model** (AGENTS.md section 6): push to `main` when a deliverable chunk passes the gate, with docs in the same commit; no PR needed. Force-push, `reset --hard` and deleting `main`/`dev` need explicit confirmation.
- **No AI attribution anywhere** (section 8): no trailers, model or provider names in commits, docs, code or PRs. Commit identity: `moldovancsaba <moldovancsaba@gmail.com>`.
- **Every change** updates docs in the same commit and bumps `package.json`, `CHANGELOG.md` and both version lines in `README.md` (no script syncs them; they have drifted before). Commits reference issues (`fixes #N`).
- **`CRON_SECRET`** is the only credential Vercel Cron can send; unset means all 7 crons get 401 (#224). README and `roadmap.md` record it as set in production; today's 06:00 UTC snapshot is consistent with that.
- **`researchandenrich` is shared** (section 9): touch it only for `cogmap`/`seyu`/`dvsc` fixes, never another app's tenant (`classscout`).
- **Route collisions**: a plain `page.tsx` and a route-group `page.tsx` for the same path fail silently; grep before adding a page (AGENTS.md, last section).
- **Deleted branches**: bundle at `/Users/Shared/Projects/.backups/branch-hygiene-2026-10-05/salesleadgenerator.bundle`, manifest `MANIFEST.md` in that folder. Restore one: `git fetch <bundle> refs/remotes/origin/<branch>:refs/heads/<branch>`. The remote `dev` branch was kept: it is 94 commits behind `main` with 3 commits not in `main` (tip `15cc053`, 2026-08-14).
- **Old credential in history** (public repo): `.env.example` once held a MongoDB connection string with credentials (added in `ed807ef`, 2026-07-20; removed in `43eeec7` and `15cc053`, 2026-08-14, leaving a rotate placeholder). Treat the old value as compromised. Whether the Atlas password was rotated is unverified; confirm with the owner. Never commit `.env*` values.
- `docs/` files carry per-document version stamps that lag `package.json`; that is normal here, `README.md` is the doc index (README states it is the single source of truth for doc paths).

## First hour for the next agent
1. Read `AGENTS.md` (sections 1, 2, 6, 8, 9), then this file, then `README.md` and `roadmap.md`.
2. `git status`, `git fetch`, confirm `main` equals `origin/main`, and `git config user.email` is `moldovancsaba@gmail.com`.
3. `npm ci`, then run the four gate commands; expect 1170 unit and 5 smoke passing.
4. `curl https://salesleadgenerator.vercel.app/api/health`: expect `status: ok`.
5. Open board #56 and compare with `gh api repos/moldovancsaba/salesleadgenerator/issues?state=open` and `roadmap.md`; fix the drift on the board.
6. Ask the owner whether to resume agent jobs (paused since 2026-09-28) and whether the old database credential was rotated.

## Where things live
- `README.md`: onboarding, env table, API overview, doc index. `CHANGELOG.md`: per-version history. `roadmap.md`: open-issue status view.
- `docs/INDEX.md` (structural index), `docs/ARCHITECTURE.md`, `docs/LLD.md` (module map), `docs/OPERATOR_GUIDE.md`, `docs/STACK_AND_DEPENDENCIES.md` (env vars, crons, dependency audit), `docs/ISSUE_MANAGEMENT.md`, `docs/LESSONS_LEARNED.md`, `docs/WEBHOOKS.md`, `docs/data-fixes/` (audit logs of production data fixes).
- Code: `app/` (pages, `app/api/` routes, `app/lib/` modules), `lib/` (shared modules), `proxy.ts` (auth gate, formerly middleware), `scripts/` (one-off ops scripts), `tests/` (unit, integration, smoke), `_archived/` (frozen historical docs).
