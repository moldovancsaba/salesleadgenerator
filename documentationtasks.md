# Documentation Quality Backlog — Sales Lead Generator

**Version:** 2.1.0

---

## General Tasks

### Versioning
- [x] Ensure all docs reference the current version from `package.json`
- [x] Update `CHANGELOG.md` for every release
- [x] Avoid hard-coded version strings in architecture or operator docs

### Cross-Linking
- [x] README should point to canonical docs only
- [x] Avoid duplicating API details across README, OPERATOR_GUIDE, and ARCHITECTURE
- [x] Keep `docs/INDEX.md` up to date when docs are added/removed

### Route and Endpoint Accuracy
- [x] Verify documented API routes match `app/api/**/route.ts`
- [x] Verify frontend routes match actual page and component structure
- [x] Update examples if endpoints change

### Code and Doc Sync
- [x] If a feature is marked shipped, confirm it exists in code
- [x] If a feature is marked planned, confirm it is not already implemented
- [x] Update `PROPOSAL.md` and `roadmap.md` when workstreams complete

### Security and Auth Claims
- [x] Ensure auth, CORS, and middleware docs match `middleware.ts` and `lib/api-auth.ts`
- [x] Update known issues if security behavior changes

### Archived References
- [x] Do not reference archived files: `docs/architecture.md`, `docs/user-guide.md`, `STACK_DECISION.md`, `BUILD_STATUS.md`, `development.md`
- [x] If historical context is needed, point to `_archived/` explicitly

### Doc Lint
- [x] Use `docs/DOC_LINT.md` before merging doc changes
- [x] Review stale references during PR review

### Completed Audits
- [x] Initial documentation audit and rewrite
- [x] README.md, CHANGELOG.md, docs/ARCHITECTURE.md, docs/OPERATOR_GUIDE.md, docs/STACK_AND_DEPENDENCIES.md, docs/INDEX.md, docs/DOC_LINT.md created/updated
- [x] PROPOSAL.md and roadmap.md cleaned up
- [x] Stale docs archived
- [x] Tech stack audit completed; results in `developmentgaps.md`
- [x] GDS localization verified; local install present at `node_modules/@doneisbetter/gds`
- [x] 2026-07-20 doc sync: updated CHANGELOG.md, PROPOSAL.md, docs/ARCHITECTURE.md, docs/OPERATOR_GUIDE.md to match shipped 2.1.0 state; doc lint passed
- [x] 2026-07-20 route audit: confirmed `/api/leads`, `/api/health`, `/api/admin/*`, `/api/outreach-*`, `/api/search*`, `/api/stats`, `/api/boards`, and frontend routes `/sales/[brand]`, `/outreach/templates` are documented
