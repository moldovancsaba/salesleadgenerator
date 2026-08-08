# Issue Management — Sales Lead Generator

**Version:** 2.4.176

This is the canonical, detailed reference for how work is tracked in this repository: how issues are created and structured, how they're labeled and sequenced, how dependencies between them are recorded, what tooling and credentials actually do the work, and — critically — the exact, verified boundary of what's reachable from an AI coding session versus what genuinely requires a human. Written so any future agent (or human) picking up this repo cold can operate the same system correctly on the first try, without rediscovering any of this by trial and error.

If you are a new agent session starting work here, read this file in full before creating, closing, or re-organizing any issue.

---

## 1. The short version

- Every non-trivial piece of work is a real GitHub Issue on `moldovancsaba/salesleadgenerator`, created via the GitHub MCP tools (§2), following a fixed structural template (§3) mandated by `CLAUDE.md` Rule 2.
- Issues are organized with labels (§4) and, where one deliverable depends on another, real GitHub sub-issue links (§5) — never informal "see #N" prose alone when a structural link is possible.
- **There is no reachable GitHub Projects board from an agent session** — verified directly, not assumed (§6). `roadmap.md` (repo root) is the standing, hand-maintained substitute: every real open issue, grouped by status, kept in sync in the same change as any issue-state change (§7).
- The full lifecycle — decompose, file, work, ship, close, re-sync `roadmap.md` — is walked through end to end in §8.

---

## 2. Access mechanism — what actually talks to GitHub

Issue/label/milestone/sub-issue CRUD happens through the **GitHub MCP server**'s tools, prefixed `mcp__github__*` in an agent session's toolset — not the `gh` CLI (not installed in this environment) and not hand-rolled REST calls in the common case. The tools actually used for issue work:

| Tool | Purpose |
|---|---|
| `mcp__github__issue_write` | Create (`method: 'create'`) or update (`method: 'update'`) a single issue — title, body, labels, state, state_reason, milestone. **Never use `method: 'update'` to append progress notes** — it overwrites the issue's own body, destroying whatever was there before. Use `add_issue_comment` for that (this exact mistake happened once historically in a sibling repo, `researchandenrich` — see that repo's own `docs/LEAD_TAXONOMY_MIGRATION_PLAN.md` for the incident, not repeated here). |
| `mcp__github__add_issue_comment` | Append a comment (progress notes, resolution write-ups, batch updates) without touching the body. This is how an issue accumulates a running history over multiple sessions. |
| `mcp__github__sub_issue_write` | `method: 'add'` links a child issue under a parent (real GitHub sub-issue relationship, shows up in both issues' UI, not just a body-text cross-reference). Takes the child's **numeric database `id`** (returned by `issue_write`'s `create` response, e.g. `5041773676`), not its human-facing issue **number** (e.g. `163`) — mixing these up is the single most common mistake when linking. `method: 'remove'`/`'reprioritize'` also exist. |
| `mcp__github__list_issues` | List/filter issues (state, labels, pagination). Use `fields` to request only what's needed (`number`, `title`, `labels`, `body`, etc.) — omitting `body` keeps large listings cheap. |
| `mcp__github__issue_read` | `method: 'get'` for one issue's full detail; `get_comments`/`get_sub_issues`/`get_parent`/`get_labels` for the specific sub-resource. |
| `mcp__github__search_issues` | Full-text/qualifier search — use before filing a new issue to avoid an accidental duplicate. |

Every one of these is a normal, scoped REST call under the hood and works reliably — none of what follows in §6 affects issue CRUD itself, only project-board mutation.

---

## 3. The mandatory issue structure (CLAUDE.md Rule 2)

Every issue of real scope follows this section shape — copy it, don't improvise a lighter version:

```
## Executive Summary
One paragraph: what this is and why it matters.

## Current State
Verified by reading the actual code — exact file/line references, not
"probably" or "should be." State plainly if something couldn't be verified
in this session's environment, rather than guessing.

## Architecture / Design
(where relevant) runtime flow, contracts/APIs, pseudo-code, UX states,
data model.

## Non-Goals
What this issue deliberately does NOT cover, so its scope can't drift.

## Edge Cases
Concrete scenarios the design/fix must handle or explicitly defer.

## Acceptance Criteria
A checklist — each item independently verifiable, not vague.

## Testing
What automated coverage is added; what can only be verified manually,
and how.

## Documentation
Which real doc(s) need updating as part of this change, if any.

## Rollback / Handover
(for anything touching production data, auth, or deploy config)

## Dependencies / Execution Order
(where relevant) what this blocks, what blocks it — see §5 for how a
real structural dependency gets recorded, not just prose here.
```

Not every section applies to every issue (a pure doc-audit finding doesn't need "Rollback," a report-only issue doesn't need "Acceptance Criteria" in the checklist sense) — omit what's genuinely not relevant, but don't skip a section that *is* relevant because the issue feels small. Real examples of this template in full: [#142](https://github.com/moldovancsaba/salesleadgenerator/issues/142), [#165](https://github.com/moldovancsaba/salesleadgenerator/issues/165), [#169](https://github.com/moldovancsaba/salesleadgenerator/issues/169).

**When a request is small and unambiguous** (CLAUDE.md Rule 2.4), a full issue isn't mandatory — use judgment, but default to recording rather than skipping when in doubt.

---

## 4. Label taxonomy (real, observed usage — not aspirational)

Four independent label axes, applied in combination (an issue typically carries 3-4 labels: one type, one priority, one status, one area):

| Axis | Real values in use | Notes |
|---|---|---|
| **Type** | `bug`, `enhancement`, `chore` | What kind of change this is. |
| **Priority** | `priority: p1`, `priority: p2`, `priority: p3` | p1 = high/urgent, p3 = low. No p0 has been used in this repo to date. |
| **Status** | `status: ready`, `status: in progress`, `status: blocked`, `status: backlog` | The single field `roadmap.md` groups by (§7). Keep this current — it's the whole point of the roadmap substitute. |
| **Area** | `area: leads`, `area: taxonomy`, `area: kanban`, `area: onboarding`, `area: enrichment`, (others as new domains appear) | Free-form but consistent — check existing labels via `list_issues` before inventing a new `area:` value that's really a duplicate of an existing one under a different name. |

There is no dedicated `list_labels`/`get_label`-listing tool in this session's toolset (only `get_label` by exact name) — the taxonomy above was compiled by observing real usage across all 158 issues in this repo's history, not from a canonical source. If you add a genuinely new label value, it becomes real usage the moment you use it — no separate "register the label" step exists or is needed (GitHub creates a label on first use via `issue_write`'s `labels` array).

**Milestones**: `issue_write` accepts a `milestone` number, but no milestone has actually been used in this repo to date. Available if a future body of work genuinely warrants grouping by target release rather than by the label axes above — don't add one speculatively.

---

## 5. Recording real dependencies between issues

Two mechanisms, used for different things — don't conflate them:

1. **Prose, in the issue body's own "Dependencies / Execution Order" section** — for describing *why* one thing needs another, sequencing across many issues, or a dependency on something outside this repo entirely (e.g. #125's dependency on an upstream `sovereignsquad/general-design-system` feature this session can't file directly). This is the common case and needs no special tooling.
2. **A real structural parent/child link via `sub_issue_write`** — for genuine "this is a sub-task of that larger tracking issue" relationships, where GitHub's own UI should show the nesting (progress bar on the parent, "Sub-issues" section). Real example: [#163](https://github.com/moldovancsaba/salesleadgenerator/issues/163) was linked as a sub-issue of the ongoing taxonomy-backfill tracking issue [#132](https://github.com/moldovancsaba/salesleadgenerator/issues/132) via `sub_issue_write({method: 'add', issue_number: 132, sub_issue_id: <163's numeric id>})`.

Use (2) when a piece of work is genuinely a formal sub-task of a parent tracking issue (the `#131` → `#135`/`#136`/`#137`/`#138`-family pattern used throughout this repo's taxonomy/sales-support epics is the model to follow). Use (1) for everything else — a "blocked by"/"blocks" relationship between otherwise-independent issues doesn't need a structural parent/child link, prose is honest and sufficient.

---

## 6. What is NOT reachable from an agent session — verified, not assumed

**GitHub Projects (the kanban-style board) cannot be read or written from this session, for two separate, both-confirmed-live reasons:**

1. **Classic Projects (the old column/card REST API) is gone from GitHub itself.** GitHub sunset it 2024-08-23 and fully removed API access by mid-2025 (GHES 3.17, June 2025). Live-tested, 2026-08-05: `GET /repos/moldovancsaba/salesleadgenerator/projects` returns a real `404 Not Found` straight from GitHub's own servers — not a tooling gap, the feature doesn't exist anymore.
2. **The current Projects is GraphQL-only, and this session's own credentials are deliberately restricted from it.** A real `GH_TOKEN`/`GITHUB_TOKEN` exists in this environment and REST calls through it work fine (proven: a plain `GET /repos/moldovancsaba/salesleadgenerator` succeeds). But a raw GraphQL call to `api.github.com/graphql` — the *only* API surface Projects (v2) exposes, there is no REST equivalent — is intercepted before it reaches GitHub, by this session's own proxy, with an explicit message: *"This GraphQL query is not enabled for this session — only the pinned set of PR-review operations is served."* Tested against both a repository-owned project query and a user-owned one (`https://github.com/users/moldovancsaba/projects/56`, confirmed to be a real, existing board) — identical block both times, confirming it's a blanket session-level restriction, not specific to any one board or query shape.
3. **No tool in this session's available toolset exposes GitHub Projects at all** — searched exhaustively by every reasonable name; every match was an unrelated tool (Asana, a design-system project tool, or other GitHub tools like issues/PRs/branches).

None of this reflects a missing GitHub capability — GitHub Projects genuinely works, for a human logged into the web UI, or for a session/token whose GraphQL access isn't restricted the way this one is. It is specific to what an agent session in this environment can reach today. **Do not re-attempt to reach it "a different way" per instance** — every plausible alternative (classic API, GraphQL directly, every tool name search) has already been tried and the exact failure point identified and recorded here. If this changes (a future session's credentials are less restricted, or GitHub ships something new), update this section — don't silently start claiming success without re-verifying.

---

## 7. `roadmap.md` — the standing substitute

Since no board is reachable, **`roadmap.md`** (repo root) is the single-page view of all real open work, grouped by the same `status:` label axis from §4 (In Progress / Ready / Blocked), plus a short "Recently closed" section for context. It is a **substitute for board placement**, not for the issues themselves — every row is a real GitHub issue with a real link; this file adds nothing that isn't independently true on GitHub.

**Keeping it in sync is a discipline, not automation** — there is no script or CI check enforcing this. Whenever an issue opens, closes, or its `status:`/`priority:` label changes, update `roadmap.md`'s corresponding row **in the same change**, exactly the same discipline `CLAUDE.md` Rule 3 already requires for every other doc. If `roadmap.md` and GitHub's real issue list ever disagree, GitHub is the source of truth — fix the file, not the other way around, and treat the mismatch as a signal that a sync step was missed and should be found.

---

## 8. Full lifecycle, start to finish

1. **Decompose** — a request bigger than a single obvious change gets broken into independently executable deliverables (CLAUDE.md Rule 2.1). No umbrella tickets covering unrelated work.
2. **Check for an existing issue first** — `search_issues` or a targeted `list_issues` call, to avoid filing a duplicate of something already tracked.
3. **File the issue** — `issue_write` with `method: 'create'`, full structure per §3, labels per §4.
4. **Link structural dependencies**, if any — `sub_issue_write` per §5.
5. **Add the new issue to `roadmap.md`** in the correct status group — same change if practical, immediately after if the issue was filed as its own standalone step.
6. **Do the work** — implement, test, document, run the full quality gate (`CLAUDE.md` Rule 1).
7. **Reference the issue in the commit** (`fixes #N` or a plain `#N` mention, per how final the commit is relative to the issue's full scope).
8. **Ship** — branch, PR, CI/deploy green, merge (per `CLAUDE.md` Rule 6's branch/push rules).
9. **Close with a real resolution comment** — `add_issue_comment` documenting what actually shipped (including caveats — a lockfile that couldn't be regenerated, a rule that had to be relaxed, a decision that got made along the way), then `issue_write` with `method: 'update'`, `state: 'closed'`, `state_reason: 'completed'` (or `'not_planned'` if the issue is being closed without being done, with the comment explaining why).
10. **Update `roadmap.md`** — move the closed issue into "Recently closed" (or drop it, if the section is getting long — it's context, not a permanent archive) and remove it from its prior status group.
11. **If the fix surfaced further real findings not fixed in the same pass**, don't silently drop them — file them as their own new issue(s) (back to step 1) rather than letting them evaporate. Real precedent: [#166](https://github.com/moldovancsaba/salesleadgenerator/issues/166) (found during a docs audit) was itself later split into [#169](https://github.com/moldovancsaba/salesleadgenerator/issues/169)–[#172](https://github.com/moldovancsaba/salesleadgenerator/issues/172) for independent tracking once picked up, with #166 closed pointing at all four.

---

## 9. Cross-references

- `CLAUDE.md` Rule 2 — the mandatory workflow rules this document explains in full detail.
- `roadmap.md` — the live, current status board substitute.
- `docs/ARCHITECTURE.md`'s "Project & Issue Management" section — a short pointer back here, in context with the rest of the system's architecture.
- `docs/LLD.md`'s "GitHub Issue Management & Tooling" section — the same tooling detail from §2 above, positioned alongside this repo's other implementation-depth internals.
