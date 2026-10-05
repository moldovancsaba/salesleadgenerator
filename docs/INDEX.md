# Documentation Index

**Version:** 2.4.247

---

## Primary Documentation Index

`README.md` is the single source of truth for documentation paths and descriptions. This file exists for structural navigation only; do not duplicate the doc index here.

---

## Detailed Documentation

- `docs/ARCHITECTURE.md` — system context, request flows, data model, module map, auth, deployment
- `docs/OPERATOR_GUIDE.md` — daily workflow, outreach, filters, API examples, known issues
- `docs/STACK_AND_DEPENDENCIES.md` — runtime, framework, UI, DB, hosting, agent/runtime stack
- `docs/DOC_LINT.md` — doc lint checklist for maintaining documentation quality

---

## Supporting Documentation

- `AGENTS.md` / `CLAUDE.md` — mandatory operating rules for any AI coding assistant working in this repo (`AGENTS.md` is canonical, `CLAUDE.md` an identical copy)
- `HANDOVER.md` — current handover for the next agent (state, commands, open work, traps), dated 2026-10-05
- `CHANGELOG.md` — version history, feature baselines, and (since 2026-07-27) documented root causes for real bugs found post-release
- `docs/LESSONS_LEARNED.md` — recurring mistake patterns, sandbox/verification limitations, and architectural rationale ("why do we do what we do")
- `docs/LEAD_ENRICHMENT_GUIDE.md` — enrichable lead-field catalog and the ready-to-use AI enrichment-agent prompt
- `docs/LEAD_TAXONOMY_MIGRATION_PLAN.md` — plan for converting existing leads into the controlled sports-industry taxonomy schema (rulebook v1.0)

## Archived Documentation

`PIPELINE_ARCHITECTURE.md`, `PROPOSAL.md`, `roadmap.md`, and `deployment.md` were archived to `_archived/` on 2026-07-27 — all four were severely stale (15-80 versions behind) and fully superseded by `docs/ARCHITECTURE.md` and `CHANGELOG.md`. See `README.md`'s "Archived Documentation" table.

- `docs/handover-2026-08-13.md` — handover of the 2026-08-13 session, archived 2026-10-05; superseded by `HANDOVER.md`

---

## Usage

Start with `README.md` for onboarding and the full documentation index. Use `docs/ARCHITECTURE.md` for system design. Use `docs/OPERATOR_GUIDE.md` for daily usage and API integration. Use `CHANGELOG.md` for version history.
