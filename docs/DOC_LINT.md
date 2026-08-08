# Doc Lint Checklist

**Version:** 2.4.176

Use this checklist when updating docs to avoid drift.

- [ ] Version number matches `package.json`
- [ ] No references to archived files as if current: `_archived/architecture.md`, `_archived/user-guide.md`, `_archived/STACK_DECISION.md`, `_archived/BUILD_STATUS.md`, `_archived/PIPELINE_ARCHITECTURE.md`, `_archived/PROPOSAL.md`, `_archived/roadmap.md`, `_archived/deployment.md`
- [ ] API routes listed match actual `app/api/**/route.ts` files, including their real auth guard (don't assume — grep the route file itself; this repo has shipped real gaps where a route quietly had no auth check at all, see issue #178)
- [ ] Frontend routes listed match actual `app/**/page.tsx` and route files
- [ ] Cross-links use canonical docs — the full current set (check `README.md`'s own Documentation table for the authoritative list, since it changes as docs are added): `README.md`, `CHANGELOG.md`, `roadmap.md`, `docs/ARCHITECTURE.md`, `docs/LLD.md`, `docs/OPERATOR_GUIDE.md`, `docs/STACK_AND_DEPENDENCIES.md`, `docs/LESSONS_LEARNED.md`, `docs/ISSUE_MANAGEMENT.md`, `docs/LEAD_ENRICHMENT_GUIDE.md`, `docs/LEAD_TAXONOMY_MIGRATION_PLAN.md`, `docs/INDEX.md`, `docs/DOC_LINT.md` (this file)
- [ ] Security, auth, and CORS claims match `proxy.ts` (renamed from `middleware.ts` in the Next.js 16 upgrade, 2.4.26) and `lib/api-auth.ts`
- [ ] Brand/tenant rules match `app/lib/brand.ts` and API filters
- [ ] Known issues section is updated if behavior changes
- [ ] If a feature is marked shipped, code exists; if planned, it is not already implemented
- [ ] Every doc file that exists in the repo is actually listed in `README.md`'s Documentation table — an orphaned doc (not linked from anywhere) is itself a drift bug, not just an omission (found and fixed for `docs/LLD.md`, 2026-08-08 audit)
