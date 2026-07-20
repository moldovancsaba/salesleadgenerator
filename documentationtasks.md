# Documentation Quality Backlog — Sales Lead Generator

**Version:** 2.1.0

---

## General Tasks

### Versioning
- [ ] Ensure all docs reference the current version from `package.json`
- [ ] Update `CHANGELOG.md` for every release
- [ ] Avoid hard-coded version strings in architecture or operator docs

### Cross-Linking
- [ ] README should point to canonical docs only
- [ ] Avoid duplicating API details across README, OPERATOR_GUIDE, and ARCHITECTURE
- [ ] Keep `docs/INDEX.md` up to date when docs are added/removed

### Route and Endpoint Accuracy
- [ ] Verify documented API routes match `app/api/**/route.ts`
- [ ] Verify frontend routes match actual page and component structure
- [ ] Update examples if endpoints change

### Code and Doc Sync
- [ ] If a feature is marked shipped, confirm it exists in code
- [ ] If a feature is marked planned, confirm it is not already implemented
- [ ] Update `PROPOSAL.md` and `roadmap.md` when workstreams complete

### Security and Auth Claims
- [ ] Ensure auth, CORS, and middleware docs match `middleware.ts` and `lib/api-auth.ts`
- [ ] Update known issues if security behavior changes

### Archived References
- [ ] Do not reference archived files: `docs/architecture.md`, `docs/user-guide.md`, `STACK_DECISION.md`, `BUILD_STATUS.md`, `development.md`
- [ ] If historical context is needed, point to `_archived/` explicitly

### Doc Lint
- [ ] Use `docs/DOC_LINT.md` before merging doc changes
- [ ] Review stale references during PR review
