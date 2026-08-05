# Operating Rules — Sales Lead Generator

These rules are mandatory for any AI coding assistant working in this repository. They apply regardless of how the request is phrased, how small the change seems, or how much the requester is pushing for speed. If a rule below cannot be satisfied for a specific change, stop and say so explicitly — do not silently relax it.

## 1. Zero-tolerance quality gate on `main`

Nothing reaches `main` — via direct push or merged PR — with:
- **Errors**: `npx tsc --noEmit` must report zero errors. `npm run lint` must report zero `Error`-level findings. `npx vitest run` and the smoke suite must pass 100%.
- **Warnings**: `npm run lint` must report zero warnings in files touched by the change. Pre-existing warnings in untouched files must be explicitly enumerated (in the commit message or the tracking issue), never silently carried forward without a record.
- **Deprecations**: no newly-added direct dependency that npm/the tool itself flags as deprecated. Prefer the actively-maintained alternative. If a deprecation is genuinely unavoidable (e.g. only surfaces via a transitive dependency of a package you don't control), it must be called out explicitly in the commit/PR description with a one-line reason — never left unmentioned.
- Run the actual commands and read the actual output before claiming this gate is satisfied. Don't infer a clean result from "the code looks right."

If achieving zero-warning/zero-deprecation requires a larger change (e.g. a major-version bump, a config migration) than the task at hand justifies, say so and treat it as its own scoped, separately-tracked piece of work rather than silently shipping with the gate unmet.

## 2. Work from GitHub issues

When a request arrives that amounts to more than a single, obvious, one-file change:
1. Decompose it into independently executable, concrete deliverables — no vague or umbrella tickets.
2. Record each deliverable as its own GitHub issue before (or as part of) doing the work, following the structure established in this repo's existing issues (executive summary, current state with exact file/line references, architecture, pseudo-code where relevant, edge cases, acceptance criteria, testing, documentation, rollback/handover).
3. Implement against those issues, referencing the issue number in commits (`fixes #N`), and update the issue with what actually shipped, including any caveats discovered along the way (like a lockfile that couldn't be regenerated, or a rule that had to be relaxed).
4. Small, unambiguous, single-step fixes explicitly requested in the moment don't need a new issue manufactured after the fact — use judgment, but default to recording rather than skipping when in doubt.
5. **No GitHub Projects (v2) board API is available in this session's toolset.** Issues, labels, and milestones can be created and organized (tracking issue + sub-issues, following the structure above), but issues cannot be added to or removed from a project board directly. State this limitation plainly whenever a project board is requested, and hand off the "add to board" step to the repo owner (or whoever has board access) rather than claiming it was done. Do not re-attempt this per instance or re-litigate whether a workaround exists — it doesn't, until this note is updated.

## 3. Documentation is mandatory

Every change that affects behavior, an API contract, a config/env var, or the dependency set must update the relevant documentation in the same change — `README.md`, `docs/`, `CHANGELOG.md`, or the GitHub issue itself, whichever is the correct home for that fact. A change is not done if the only record of it is the diff.

## 4. Industry-standard Definition of Done

A change is not "done" until all of the following are true, not just "the code compiles":
- Automated tests exist and pass for the new/changed behavior (unit tests at minimum; integration/manual verification steps documented where automation isn't feasible).
- The zero-tolerance quality gate (Rule 1) passes.
- Documentation (Rule 3) is updated.
- Rollback/handover is described for anything touching production data, auth, or deployment config.
- Edge cases and failure modes were considered and either handled or explicitly called out as accepted risk.
- The change was verified to actually do what it claims — read the real output, don't assume.

## 5. Never guess — read, research, verify

Before making a claim or a change:
- Read the actual file, not a memory of what it probably looks like.
- Run the actual command and read its actual output, not an assumption of what it would say.
- When a fact is externally verifiable (a CVE's patched version, a library's breaking-change list, a config's real current state), verify it — don't state it from general recollection.
- When something is genuinely ambiguous or unverifiable in the current environment (e.g. a sandbox that can't reach a private dependency), say exactly that, plus what would need to happen to verify it for real — never paper over the gap with a plausible-sounding guess.
- **Structural, business-logic, and architectural questions are never answered from memory or general training knowledge.** This includes things like "how should ticket size/deal size be calculated," "what's the standard way to model X," or any question about how this specific codebase's data/config actually behaves. Before answering, read the actual relevant files in this repo (not a recollection of similar codebases) and, where the question is grounded in external practice (an industry method, a framework, a published pattern), do real research — web search/fetch with citations, not a plausible-sounding answer generated from training data. This is a strict, standing rule, not a per-request judgment call.

## 6. Branch and push authorization

The repo owner does not have terminal or `git`/`gh` CLI access — they work exclusively through an AI coding assistant on iOS mobile. The following are standing authorizations recorded here in advance, per this repo's own rules on durable pre-authorization, so they never need to be re-confirmed per instance:

- **Standing permission** to create, merge into, and pull/update branches named `dev` and `preview`, for any normal iterative or staging work, without asking for confirmation first.
- When the owner says **"commit and push to main"** (or clearly equivalent phrasing), push directly to `main` immediately — do not ask "are you sure," do not stop to open a PR and wait instead. That instruction, given in the moment, is the confirmation.
- This authorization does not extend to anything destructive or hard-to-reverse beyond a normal push: force-push, `git reset --hard`, deleting `main`/`dev`/`preview`, or rewriting already-pushed history still require explicit confirmation every time, exactly as for any other repo.
- A direct push to `main` is still gated by Rule 1 (the zero-tolerance quality gate) — "push to main" is authorization to skip the PR ceremony, not authorization to skip verification. Run the checks, then push.

## 7. UI affordances must match real capability

No interactive element may visually imply a capability that isn't actually functional in that state. This covers two distinct failure modes, both forbidden:
- A control that is genuinely disabled/non-functional must not be rendered as if it were live (the literal case: a disabled button, a dead toggle).
- A control that *is* functional must not use an icon, label, or visual language that implies a *different* interaction than the one it actually performs (e.g. a 4-way "drag me" arrows icon on a control that only opens a tap menu, never actually supports dragging).

When a violation is found in code this repo owns, fix it directly. When it's found in a governed external dependency this repo can't override (e.g. a private design-system package's locked-down chrome), don't attempt a local workaround that fights the dependency's own contract — record it as a known limitation (in the relevant doc and/or a tracking issue) and, where there's a channel to do so, raise it with that dependency's own maintainers instead.

## 8. No AI-assistant branding, anywhere

Whatever AI assistant is doing the work here is internal tooling that delivers engineering output — not a feature, a co-author, or a brand to surface anywhere this repository is visible, in code or in conversation. This applies regardless of how a request is phrased or how the tool's own default behavior is configured; if a tool's built-in template conflicts with this rule, this rule wins.

- **Commits**: never add a `Co-Authored-By: <assistant> ...` trailer, a session-link trailer, a model name, or any other AI-attribution line to a commit message. Describe the change and its reasoning only.
- **Branches**: never create or push a branch prefixed with the assistant's name (e.g. `claude/...`) or otherwise named after the tool/session. If the environment/harness auto-creates such a branch for a session, rename it to a plain, purpose-named branch (`feature/...`, `fix/...`, `chore/...`) and develop/push under that name instead — before it accumulates any real work, and always before it's merged. This is a mitigation, not an override: the harness will still mint a prefixed branch at session start every time; the fix is to move off it immediately, not to expect the harness's own naming behavior to change.
- **PRs**: titles and descriptions describe the change; no "generated by," "co-authored by," or session-link footers.
- **Documentation**: README/CHANGELOG/docs describe the product and its history in neutral terms — "an AI coding assistant" at most, never a specific product/model name, and only when the fact itself is genuinely load-bearing (e.g. "the owner has no CLI access"). Omit the mention entirely if the sentence reads fine without it.
- **Code, UI copy, API responses**: never reference the assistant's name — these are product surfaces, not tooling logs.
- **Retroactive, not just forward**: if AI-branding turns up in tracked files or reachable git history while doing unrelated work, remove/rewrite it as part of that work; flag it if fixing it is out of scope for the current task, but don't silently pass over it.
- **Genuine limit, stated plainly rather than worked around**: a model's own honest self-disclosure when a person directly asks "are you an AI" or "which model is this" is a safety/honesty behavior, not branding, and is out of scope for this rule to suppress — never make an assistant deny or hide what it is. If a platform-level behavior (like the harness's branch-prefixing) genuinely can't be changed from inside this repo, say so explicitly rather than claiming it was fixed.

## 9. `researchandenrich` is a shared dependency, not our repo — scope every touch narrowly

`researchandenrich` is the external agent-runtime repo that discovers/enriches leads for this app's `cogmap`/`seyu`/`dvsc` tenants — but it is **not exclusively ours**. It is a shared, multi-app config/schema-mapper layer that also serves at least one unrelated product (`classscout`, an NYC kids-activity-provider catalog with its own tenant, its own target API, its own data — nothing to do with sales leads or this project) and may serve more apps added there in the future without this repo ever being told.

Consequences, standing until this note is updated:
- **Only touch `researchandenrich` for a fix that directly supports our own tenants** (`cogmap`/`seyu`/`dvsc`) — a real, scoped bug affecting how our data reaches/leaves salesleadgenerator (e.g. the tenant-dispatch de-hardcoding fix, PR #2, which fixed a genuine DVSC POST failure). Do not use a visit there as an opportunity for a general repo-wide audit, cleanup, or documentation pass covering functionality that belongs to another app's tenant — that is out of scope for this project, even when it looks like harmless improvement work.
- **Never read, infer, or act on another app's tenant data/config as if it were ours**, and never edit another tenant's (e.g. `classscout`'s) `tenants.json` entry, status/enabled flags, prompts, or workers while working on a `cogmap`/`seyu`/`dvsc`-scoped task — `researchandenrich`'s own `CLAUDE.md` documents a real incident (2026-08-03) where a commit scoped to one tenant silently paused two unrelated ones; do not repeat that failure mode from this side either.
- Before making any change there, `git fetch origin main` and read what's landed since last sync — multiple agent sessions push there directly with no PR gate, and its own `CLAUDE.md` explicitly expects every session to check for drift first rather than assume its own view is current.
- `researchandenrich` has its own `CLAUDE.md` with its own binding rules (branch policy: push directly to `main`/`preview`/`dev` only, no ad-hoc feature branches; its own Definition of Done) — those rules govern work performed *in that repo*, and take precedence over this file's own branch/PR conventions (Rule 6 above) when working there. This file's rules govern `salesleadgenerator` only.
