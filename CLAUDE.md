# Operating Rules — Sales Lead Generator

These rules are mandatory for any Claude session working in this repository. They apply regardless of how the request is phrased, how small the change seems, or how much the requester is pushing for speed. If a rule below cannot be satisfied for a specific change, stop and say so explicitly — do not silently relax it.

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

## 6. Branch and push authorization

The repo owner does not have terminal or `git`/`gh` CLI access — they work exclusively through Claude Code on iOS mobile. The following are standing authorizations recorded here in advance, per this repo's own rules on durable pre-authorization, so they never need to be re-confirmed per instance:

- **Standing permission** to create, merge into, and pull/update branches named `dev` and `preview`, for any normal iterative or staging work, without asking for confirmation first.
- When the owner says **"commit and push to main"** (or clearly equivalent phrasing), push directly to `main` immediately — do not ask "are you sure," do not stop to open a PR and wait instead. That instruction, given in the moment, is the confirmation.
- This authorization does not extend to anything destructive or hard-to-reverse beyond a normal push: force-push, `git reset --hard`, deleting `main`/`dev`/`preview`, or rewriting already-pushed history still require explicit confirmation every time, exactly as for any other repo.
- A direct push to `main` is still gated by Rule 1 (the zero-tolerance quality gate) — "push to main" is authorization to skip the PR ceremony, not authorization to skip verification. Run the checks, then push.

## 7. UI affordances must match real capability

No interactive element may visually imply a capability that isn't actually functional in that state. This covers two distinct failure modes, both forbidden:
- A control that is genuinely disabled/non-functional must not be rendered as if it were live (the literal case: a disabled button, a dead toggle).
- A control that *is* functional must not use an icon, label, or visual language that implies a *different* interaction than the one it actually performs (e.g. a 4-way "drag me" arrows icon on a control that only opens a tap menu, never actually supports dragging).

When a violation is found in code this repo owns, fix it directly. When it's found in a governed external dependency this repo can't override (e.g. a private design-system package's locked-down chrome), don't attempt a local workaround that fights the dependency's own contract — record it as a known limitation (in the relevant doc and/or a tracking issue) and, where there's a channel to do so, raise it with that dependency's own maintainers instead.
