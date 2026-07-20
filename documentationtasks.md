# Documentation Tasks — Sales Lead Generator

## Audit Findings
- README mixes summary, API reference, UX notes, and deployment docs
- docs/user-guide.md repeats README content and omits current limitations
- docs/architecture.md is high-level only; no low-level design
- PIPELINE_ARCHITECTURE.md is the most structured doc but incomplete for runtime behavior
- STACK_DECISION.md still references v2.0 while README/package.json/BUILD_STATUS use 2.1.0
- development.md + roadmap.md mix shipped, planned, and aspirational work without clear separation
- PROPOSAL.md contains workstreams that are partially implemented but not marked as such
- Some endpoint and UX claims are stale vs. actual codebase
- No single source of truth; 4–5 markdown files overlap

## Version Baseline
- Current app version: **2.1.0**
- Single source of truth: `package.json`
- All docs must reference 2.1.0 going forward

## Deliverables

### D1 — README.md Rewrite
- [x] Make README an onboarding-first doc only
- [x] Remove duplicated API reference, architecture prose, and UX details
- [x] Add correct version header and compatibility statement
- [x] Add single canonical links to ARCHITECTURE.md, OPERATOR_GUIDE.md, and CHANGELOG.md
- [x] Fix any stale endpoint, route, or UX claims against current code

### D2 — docs/ARCHITECTURE.md Low-Level Design
- [x] Add system context diagram: frontend, API routes, MongoDB, research agent, cron
- [x] Document request/response flow for list, create, action, health, outreach endpoints
- [x] Add module/responsibility map for `app/lib/*`, `models/*`, and API route handlers
- [x] Document data flow for lead creation, normalization, dedup, and scoring
- [x] Document auth, middleware, CORS, and security header enforcement
- [x] Add deployment and environment diagram/notes

### D3 — docs/OPERATOR_GUIDE.md
- [x] Replace current docs/user-guide.md with operator-focused guide
- [x] Daily workflow for pipeline operators
- [x] Filter, search, drag, outreach, and action workflows
- [x] Current limitations and known issues section
- [x] API integration quickstart for integrators
- [x] Escalation and admin endpoint usage

### D4 — CHANGELOG.md
- [x] Create CHANGELOG.md with v2.1.0 baseline
- [x] Document shipped features from BUILD_STATUS.md, development.md, and roadmap.md
- [x] Mark proposed work from PROPOSAL.md as pending or done
- [x] Add version compatibility rules going forward

### D5 — docs/STACK_AND_DEPENDENCIES.md
- [x] Replace/merge STACK_DECISION.md into a current stack doc
- [x] Update version to 2.1.0
- [x] Include runtime, framework, UI, DB, hosting, and agent/runtime dependencies
- [x] Document why Mongoose and MongoDB Atlas are used vs alternatives
- [x] Document known build constraints, e.g., `next build` OOM risk

### D6 — Route and Endpoint Audit
- [x] Verify documented API routes match `app/api/**/route.ts`
- [x] Verify frontend routes match `app/sales/**`, `app/outreach/**`, `app/detail.tsx`, etc.
- [x] Update all docs with corrected endpoint/route list
- [x] Add canonical API reference section in README with current examples

### D7 — Proposal and Roadmap Cleanup
- [x] Update PROPOSAL.md: mark completed workstreams, remove duplicates
- [x] Update roadmap.md: separate shipped, in-progress, and planned clearly
- [x] Add traceability from roadmap items to docs/tasks

### D8 — Doc Lint and Cross-Linking
- [x] Add doclint task or checklist to catch future drift
- [x] Ensure all docs link to each other instead of duplicating content
- [x] Add a docs README or index pointing to D1–D7 outputs
