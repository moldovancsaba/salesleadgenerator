# Doc Lint Checklist

Use this checklist when updating docs to avoid drift.

- [ ] Version number matches `package.json`
- [ ] No references to archived files as if current: `_archived/architecture.md`, `_archived/user-guide.md`, `_archived/STACK_DECISION.md`, `_archived/BUILD_STATUS.md`
- [ ] API routes listed match actual `app/api/**/route.ts` files
- [ ] Frontend routes listed match actual `app/**/page.tsx` and route files
- [ ] Cross-links use canonical docs: `README.md`, `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/OPERATOR_GUIDE.md`, `docs/STACK_AND_DEPENDENCIES.md`
- [ ] Security, auth, and CORS claims match `middleware.ts` and `lib/api-auth.ts`
- [ ] Brand/tenant rules match `app/lib/brand.ts` and API filters
- [ ] Known issues section is updated if behavior changes
- [ ] If a feature is marked shipped, code exists; if planned, it is not already implemented
