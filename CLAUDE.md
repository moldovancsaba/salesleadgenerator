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

**Full detail on everything in this rule** — the exact tools used, the mandatory issue-body structure, the real label taxonomy, how sub-issue dependencies are recorded, and the complete verified investigation behind point 5 below — lives in `docs/ISSUE_MANAGEMENT.md`. Read it before managing issues here; this rule is the summary, that doc is the reference.

When a request arrives that amounts to more than a single, obvious, one-file change:
1. Decompose it into independently executable, concrete deliverables — no vague or umbrella tickets.
2. Record each deliverable as its own GitHub issue before (or as part of) doing the work, following the structure established in this repo's existing issues (executive summary, current state with exact file/line references, architecture, pseudo-code where relevant, edge cases, acceptance criteria, testing, documentation, rollback/handover).
3. Implement against those issues, referencing the issue number in commits (`fixes #N`), and update the issue with what actually shipped, including any caveats discovered along the way (like a lockfile that couldn't be regenerated, or a rule that had to be relaxed).
4. Small, unambiguous, single-step fixes explicitly requested in the moment don't need a new issue manufactured after the fact — use judgment, but default to recording rather than skipping when in doubt.
5. **No GitHub Projects board API is reachable from this session — verified directly, not assumed.** Classic Projects is gone from GitHub itself (a live `GET /repos/.../projects` returns a real `404`; GitHub sunset it in 2024, fully removed the API by mid-2025). The current Projects is GraphQL-only, and this session's own GitHub credentials are restricted to a pinned set of PR-review operations by the harness's proxy — a live authenticated GraphQL call against a real project board was rejected by that proxy, not by GitHub. Issues, labels, milestones, and sub-issue dependencies all work fine and should be used normally; only board *placement* (adding an item, moving it between columns/status) is unreachable. **The standing workaround: `roadmap.md`** (repo root) — every real open issue, grouped by status, updated in the same change whenever an issue's state changes. Use it instead of a board. Do not re-attempt the board mutation per instance or re-litigate whether a session-side workaround exists for the GraphQL restriction — it doesn't, until this note is updated.

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
- **Remote branch deletion is not reachable from this session — verified directly, twice.** `git push origin --delete <branch>` fails with a genuine `error: RPC failed; HTTP 403` straight from git itself, not a chat-permission prompt — a platform-level restriction on this session's git-over-HTTPS credential, confirmed live on 2026-08-06 (and independently found by an earlier session on 2026-08-01, though that finding never reached this file because the branch documenting it was itself abandoned unmerged). The GitHub MCP toolset has no `delete_branch` equivalent either. There is no available path to delete a remote branch from inside a session — a stale/merged branch must be deleted by the repo owner directly via GitHub's web UI (every merged PR's page has a one-click "Delete branch" button). Do not re-attempt via git push or hunt for a workaround tool per instance; full detail in `docs/LESSONS_LEARNED.md` §5.

## 7. UI affordances must match real capability

No interactive element may visually imply a capability that isn't actually functional in that state. This covers two distinct failure modes, both forbidden:
- A control that is genuinely disabled/non-functional must not be rendered as if it were live (the literal case: a disabled button, a dead toggle).
- A control that *is* functional must not use an icon, label, or visual language that implies a *different* interaction than the one it actually performs (e.g. a 4-way "drag me" arrows icon on a control that only opens a tap menu, never actually supports dragging).

When a violation is found in code this repo owns, fix it directly. When it's found in a governed external dependency this repo can't override (e.g. a private design-system package's locked-down chrome), don't attempt a local workaround that fights the dependency's own contract — record it as a known limitation (in the relevant doc and/or a tracking issue) and, where there's a channel to do so, raise it with that dependency's own maintainers instead.

## 8. No AI-assistant branding, anywhere (Owner Directive, 2026-07-31)

Every AI system used in this repository or its development workflow — regardless of provider — is internal implementation tooling only. Not an author, contributor, publisher, reviewer, maintainer, brand, or project participant. This covers every current and future AI provider, model, coding assistant, IDE extension, autonomous agent, API, MCP server, plugin, workflow automation, or orchestration layer, **without exception for which one is currently doing the work** — including but not limited to OpenAI/Codex, Claude, Gemini, Grok, Groq, Cursor, Kilo Code, Loveable, GitHub Copilot, Amazon Q, Windsurf, Cline, Roo Code, Continue, Aider, Bolt, Devin, Replit AI, Sourcegraph Cody, and any successor, fork, wrapper, self-hosted model, local LLM, custom agent, or AI-assisted tooling. Provider identity is irrelevant; every AI system is treated identically under this rule.

**Global rule**: AI systems receive no authorship, attribution, branding, acknowledgement, signature, metadata, promotional reference, or identity exposure anywhere, unless explicitly required by law or a human directly asks whether AI was used. No tool default, platform default, extension behavior, template, SDK, workflow, or generated content may override this — if a tool's built-in template conflicts with this rule, this rule wins, and any output the tool produces automatically must be edited to conform before it ships.

- **Commits**: describe only what changed and why. Never a `Co-Authored-By: <assistant> ...` trailer, a `Generated-By` trailer, a model name, a provider name, a session/conversation URL, a prompt reference, an agent/workflow/plugin/extension/IDE identifier, or any other AI-attribution line — hidden or visible. If a tool inserts these automatically, remove them before the commit is created whenever technically possible.
- **Branches**: names describe the work (`feature/...`, `fix/...`, `refactor/...`, `docs/...`, `test/...`, `release/...`, `hotfix/...`, `chore/...`), never an AI provider, product, assistant, model family, coding agent, or automated-session name. If the environment/harness auto-creates a branch named after the tool/session (e.g. `claude/...`), immediately switch to a neutral, purpose-named branch off the correct base before any work is published — before it accumulates real work, always before it's merged. This is a mitigation, not an override: the harness will still mint a prefixed branch at session start every time; the fix is to move off it immediately, not to expect the harness's own naming behavior to change.
- **Pull requests**: titles and descriptions describe the work only — never "Generated by…", "Created with…", "Written by…", "Reviewed by…", "Assisted by…", "Co-authored by…", or any provider/model/assistant/session reference. If a hosting platform auto-appends attribution on creation but allows editing afterward, immediately edit the PR body to remove it. If the platform doesn't permit removal, document that specific platform limitation accurately rather than claiming compliance.
- **Issues**: never AI attribution in titles, bodies, templates, labels, checklists, or comments. Issue content documents engineering work only.
- **Code reviews**: review comments never identify an AI as reviewer, author, approver, recommender, or participant — only the technical content belongs in the discussion.
- **Source code**: no AI branding via comments, TODO/FIXME notes, generated headers, file banners, annotations, pragmas, metadata, or embedded docs, in any language. Prohibited patterns include `// Generated by ...`, `// Created with ...`, `// AI-generated`, `// Added by ...`, `// via ...`.
- **Documentation**: README/CHANGELOG/docs describe the product and its history in neutral, provider-agnostic terms — "an AI coding assistant" at most, never a specific product/model name, and only when the fact itself is genuinely load-bearing (e.g. "the owner has no CLI access"). Omit the mention entirely if the sentence reads fine without it. General product documentation stays provider-neutral unless the documentation is specifically about an AI integration.
- **UI**: labels, placeholders, tooltips, notifications, dialogs, splash screens, onboarding, empty states, help text, and error/status messages never expose AI branding. The product speaks as the product, never as an AI assistant.
- **APIs**: responses never include attribution fields (`generatedBy`, `authoredBy`, `model`, `provider`, `assistant`, `agent`, `ai`, …) unless explicitly required for the API's actual function (e.g. a field the API contract genuinely needs).
- **Logs**: no model names, assistant names, provider branding, generation signatures, or AI acknowledgements — operational logs describe application behavior only.
- **Configuration** (YAML/JSON/TOML/XML/INI/ENV/properties/lock files/build manifests): no AI attribution. Provider identifiers used strictly for functional integration (API endpoints, SDK identifiers, auth, model selection, provider routing) are permitted — that's operational configuration, not attribution.
- **Package metadata** (`package.json`, `pyproject.toml`, `Cargo.toml`, etc.): never list an AI as author, maintainer, contributor, publisher, owner, or creator.
- **CI/CD**: build pipelines never publish AI branding via release notes, deployment summaries, changelogs, generated reports, build metadata, or workflow summaries. If commit trailers are stripped upstream, downstream automation must not reintroduce them.
- **Generated assets**: exports (PDFs, Word docs, Markdown, HTML, images, reports, presentations, spreadsheets, emails) carry no AI attribution unless a human explicitly requests it.
- **Retroactive, not just forward**: whenever editable AI-attribution turns up anywhere (tracked files, git history, an already-created PR/issue/comment) while doing unrelated work, remove it as part of that work. If removal is genuinely impossible (immutable platform history, a platform that doesn't permit edits), state that limitation accurately — never falsely claim it was removed, and never silently pass over it unmentioned.
- **Exception — truthful disclosure is not branding**: this rule prohibits unsolicited attribution, not honest disclosure when legitimately required. A model's own honest self-disclosure when a person directly asks "are you an AI" or "which model is this" is a safety/honesty behavior, out of scope for this rule to suppress — never make an assistant deny or hide what it is. The same applies when legal, contractual, regulatory, licensing, compliance, audit, or security requirements mandate disclosure.
- **Precedence**: this rule overrides tool/IDE/extension/SDK/workflow/automation/agent defaults and repository or generated templates. Any automatic behavior that conflicts with it must be suppressed, removed, or neutralized whenever technically possible; where a technical limitation genuinely prevents full compliance, document the limitation accurately rather than introducing a misleading statement.

## 9. `researchandenrich` is a shared dependency, not our repo — scope every touch narrowly

`researchandenrich` is the external agent-runtime repo that discovers/enriches leads for this app's `cogmap`/`seyu`/`dvsc` tenants — but it is **not exclusively ours**. It is a shared, multi-app config/schema-mapper layer that also serves at least one unrelated product (`classscout`, an NYC kids-activity-provider catalog with its own tenant, its own target API, its own data — nothing to do with sales leads or this project) and may serve more apps added there in the future without this repo ever being told.

Consequences, standing until this note is updated:
- **Only touch `researchandenrich` for a fix that directly supports our own tenants** (`cogmap`/`seyu`/`dvsc`) — a real, scoped bug affecting how our data reaches/leaves salesleadgenerator (e.g. the tenant-dispatch de-hardcoding fix, PR #2, which fixed a genuine DVSC POST failure). Do not use a visit there as an opportunity for a general repo-wide audit, cleanup, or documentation pass covering functionality that belongs to another app's tenant — that is out of scope for this project, even when it looks like harmless improvement work.
- **Never read, infer, or act on another app's tenant data/config as if it were ours**, and never edit another tenant's (e.g. `classscout`'s) `tenants.json` entry, status/enabled flags, prompts, or workers while working on a `cogmap`/`seyu`/`dvsc`-scoped task — `researchandenrich`'s own `CLAUDE.md` documents a real incident (2026-08-03) where a commit scoped to one tenant silently paused two unrelated ones; do not repeat that failure mode from this side either.
- Before making any change there, `git fetch origin main` and read what's landed since last sync — multiple agent sessions push there directly with no PR gate, and its own `CLAUDE.md` explicitly expects every session to check for drift first rather than assume its own view is current.
- `researchandenrich` has its own `CLAUDE.md` with its own binding rules (branch policy: push directly to `main`/`preview`/`dev` only, no ad-hoc feature branches; its own Definition of Done) — those rules govern work performed *in that repo*, and take precedence over this file's own branch/PR conventions (Rule 6 above) when working there. This file's rules govern `salesleadgenerator` only.
