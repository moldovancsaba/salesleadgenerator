# Lessons Learned — Sales Lead Generator

**Version:** 2.4.149

This document exists because the operator asked directly: *"I miss a lot of learning information — what went wrong, what do we have to care about in the future, why do we do what we do, the known limitations."* It is not a changelog (see `CHANGELOG.md` for the full, dated, per-release record) — it's the synthesis: recurring mistake patterns worth watching for, the sandbox's real limitations, and the reasoning behind decisions that look arbitrary without the history. Every claim below cites the real incident it's drawn from; treat this as a companion to `CHANGELOG.md`, not a replacement.

---

## 1. The recurring bug class: object-spread key collisions on `$or`

Two real, separate, live production bugs — found in two different files, on two different occasions — shared the exact same root cause:

```js
// WRONG — later key silently wins, discarding the earlier one
{ ...tenantFilter(tenantId), $or: [...] }
```

`lib/tenant.ts`'s `tenantFilter()` itself returns an object keyed on `$or` (`{$or: [{tenantId: 'default'}, {tenantId: {$exists: false}}]}` for the `'default'` tenant, which is this app's only tenant in practice). Any code that spreads `tenantFilter(...)` into the same object literal as its own `$or` clause silently discards whichever one comes second — plain JavaScript object-literal semantics, not a MongoDB quirk.

- **First instance (2.4.99):** `app/api/leads/[id]/route.ts`'s `tryFindLead()` — its final fallback branch spread the id/`_id` match's `$or` together with `tenantFilter()`'s own `$or`, discarding the id match entirely. A request for a well-formed but nonexistent id matched an **arbitrary other lead** instead of 404ing. `GET` could show the wrong lead. `PUT` (the research agent's enrichment path) could silently overwrite an unrelated lead's fields. `DELETE` could delete the wrong lead. Confirmed live: a real `DELETE` followed by a real `GET` for the same id returned an unrelated lead's full document.
- **Second instance (2.4.100), found one commit later:** `app/api/search/route.ts`'s `buildSearchFilter()` had the identical shape. `GET /api/search` had **zero tenant isolation** — any tenant's leads were returned to any caller. The 2.4.99 fix's own changelog entry claimed a grep of `app/`/`lib/` found no other instance of this pattern; that grep missed this one, because it searched by pattern-matching the code shape rather than exhaustively re-checking every route that combines a tenant filter with its own query.

**The lesson, concretely:** whenever combining two Mongo filter objects that might each contain a `$or` (or any other operator key), use `{ $and: [filterA, filterB] }`, never object spread. This is now the pattern in `app/api/leads/route.ts`, `app/api/leads/columns/route.ts`, `app/api/leads/[id]/route.ts`, and `app/api/search/route.ts`. **If you're adding a new route that filters by tenant, grep for `tenantFilter(` first and confirm the combining code uses `$and`, not spread — don't assume the fix generalized just because it shipped once.**

---

## 2. The creation-time quality gate is agent-defense, not a data-quality gate — and that distinction has bitten twice

`POST /api/leads`'s creation-time gate (`computeEase()` / `bestContactConfidence()` in `app/api/leads/route.ts`) blocks a very-low ease/confidence lead unless it has a verified contact. It exists **specifically to stop the autonomous research agent (OpenClaw cron) from writing low-signal, contact-less leads it half-discovered** — not as a general "no lead may ever lack complete data" rule. Nothing in the codebase said this out loud before this document; both incidents below happened because the gate's *purpose* wasn't written down anywhere, only its *mechanics*.

- **CSV import (2026-07-27):** a one-time bulk import of 1,730 curated, human-sourced leads was rejected at creation — the rows had no contact yet, pending manual enrichment. The gate was doing exactly its job against agent noise, but had no way to distinguish that from a legitimate bulk import of real leads. Worked around via a temporary admin bulk-import route (built, used once, then deleted — see the CHANGELOG's 2026-07-27 CSV import entry).
- **13 pre-existing test failures (fixed in 2.4.99):** the shared `createLead()` integration-test fixture had no contact, tripping this same gate on every test that used it — a baseline gap that had been carried forward, undiagnosed, since 2.4.93. Fixing it (adding a real contact to the fixture) is what surfaced the `tryFindLead()` bug described in §1, because the last test needed a genuinely-nonexistent id to test against.

**The lesson:** when a write path is rejected unexpectedly, check whether the rejecting gate is scoped to a specific caller (the research agent) before assuming it's a general data-integrity rule that the new data must conform to. A one-off, human-directed operation (a bulk import, a migration script) may legitimately need to bypass a gate that exists to stop a *different* caller's bad behavior.

---

## 3. Verification discipline: "grepped and found nothing" is not the same as "fixed everywhere"

The 2.4.99 changelog entry for the `tryFindLead()` fix said: *"Grepped the rest of `app/`/`lib/` for the same anti-pattern — no other instance found."* That grep was wrong — not because grep lies, but because the anti-pattern doesn't have one canonical textual shape (`{...a, $or: [...]}` vs `{$or: [...], ...a}` vs the two objects being built in different variables and merged elsewhere all look different to a grep, but are the same bug). The second instance was found only because a full documentation audit re-read the actual logic of every route file, not because a follow-up grep caught it.

**The lesson:** a "no other instances found" claim after a pattern-fix is only as strong as the search method. A textual grep for a specific shape is a reasonable first pass, but for a *semantic* bug class (two filter objects being combined unsafely), the reliable check is reading each candidate site's actual logic, not re-running the same grep. When in doubt, say "grep found none, but this bug class isn't reliably grep-able" rather than "no other instances exist."

---

## 4. Real, repeated dependency-upgrade blockers — and how they were actually resolved

Several dependency bumps were attempted, hit a real blocker, and were reverted — each time, the reversion was verified (not assumed) and the blocker documented with its exact error and the upstream tracking issue to watch, per `docs/STACK_AND_DEPENDENCIES.md`'s own policy of never silently carrying forward an unexplained pin.

- **ESLint 9 → 10, attempted twice.** First attempt (2.4.26) hit `typescript-eslint`'s `scopeManager.addGlobals is not a function` crash. That was later confirmed fixed upstream, so a second attempt was made (2026-07-25) — which hit a *different* crash instead (`eslint-plugin-react@7.37.5`'s `contextOrFilename.getFilename is not a function`, because ESLint 10 removed a legacy API that plugin still calls). Reverted to 9.39.5 again, for a different reason than the first time. **Lesson: confirming the original blocker is fixed does not mean the upgrade is now safe — the ecosystem has more than one point of incompatibility, and each attempt needs its own full verification, not just a re-check of the one thing that failed last time.**
- **TypeScript 6 → 7, attempted per a written migration plan.** `tsc --noEmit` passed clean, but `npm run lint` failed: `@typescript-eslint/parser` has a hard runtime rejection of TS 7.0 (TS 7.0 was only two weeks old at the time; its lint ecosystem hadn't caught up). Reverted rather than forcing a fragile workaround for a two-week-old release. **Lesson: `tsc` passing is necessary but not sufficient to confirm a TypeScript bump is safe — the full quality gate (including lint) must pass, and a suspiciously-recent upstream release is itself a signal to expect ecosystem lag.**
- **GDS `gds-core` 3.10.0 → 3.11.0, reverted within one version.** Vercel's `npm install` hit a real `404` — the `3.11.0` git tag existed but its release tarball was never actually published (a bug in the design system's own release automation, not this app's). Reverted to the last commit known to have deployed successfully, byte-for-byte (exact URLs/versions/integrity hashes), not re-derived. **Lesson: a git tag existing is not proof a release's actual downloadable artifact exists — verify the tarball itself (or the actual `npm install`/build result), not just the tag.**
- **`enableDrag` (GDS kanban drag-and-drop), enabled then reverted (2.4.10–2.4.17).** It was the one genuinely new runtime code path in that GDS adoption that had never actually executed in a successful production build — every earlier deploy attempt had failed before reaching it — until a live client-side exception was reported in production. Confirmed as the actual fix via real-device production re-verification (not just "should fix it"), then deliberately left off going forward — the keyboard/tap "Move to column" menu covers the same functionality without the crash risk, and the owner explicitly accepted that trade-off rather than asking for drag back.

**The general lesson across all four:** a revert is not a failure to hide — each one is recorded with the exact error, why it happened, and the specific upstream issue that would need to change before retrying. That's the standard to hold every future blocked upgrade to.

---

## 5. Sandbox environment limitations — real, and inconsistent across sessions

- **`mongodb-memory-server`'s `fastdl.mongodb.org` reachability is genuinely session-dependent, not a fixed fact.** An earlier session (2.4.23-era) found it blocked (`403` on `CONNECT`). Later sessions (2026-07-25, and again 2026-07-27 while fixing the search-route bug — full integration suite ran, 114/114 passing) found it reachable. **Never assume a prior session's network-reachability finding still holds — re-verify each session**, and if it's blocked, fall back to route-mocked browser verification rather than skipping integration coverage silently.
- **Direct MongoDB Atlas TCP and direct `github.com`/`api.github.com` access are blocked from this sandbox**, but HTTPS to the deployed Vercel production app (`https://salesleadgenerator.vercel.app`) is reachable, as is `raw.githubusercontent.com` via `WebFetch`. When direct DB access isn't available, production behavior can still be verified live through the deployed app's own API — this was how the CSV-import blocker and the country-field bug were confirmed real before fixing them, not assumed from reading code alone.
- **Real signed SSO ID tokens cannot be fabricated in this sandbox.** Session-auth-gated route logic can only be tested by mocking the auth dependency boundary (`vi.mock('@/lib/session', ...)`) — there is no way to get a true end-to-end authenticated click-through for anything behind SSO login in this environment. Any claim of "verified via a real authenticated session" from inside this sandbox should be treated skeptically; it's almost certainly a mocked boundary, not a real token.
- **The repo owner has no terminal, `git`/`gh` CLI, or Vercel-dashboard access** — they work exclusively through Claude Code on iOS mobile. This is why one-time migrations (the CSV import) use a temporary admin API route (built, used once, then deleted, with the deletion itself recorded in `CHANGELOG.md`) rather than a local script the owner could run themselves — and why setting Vercel environment variables (e.g. the SSO credentials obtained 2026-07-26, still unset in Vercel production as of this writing) is a standing operational gap that has to be handed off explicitly, not silently worked around.

---

## 6. Why some things are the way they are (architectural rationale that isn't obvious from the code alone)

- **`enableDrag` is off, and the keyboard/tap "Move to column" menu is the primary way to move cards** — not a fallback for people who can't use drag. See §4 above: this was a deliberate trade-off after a real production crash, re-confirmed fixed, then kept off anyway by owner choice.
- **The near-duplicate detection engine (`lib/near-duplicate.ts`, issue #73) was originally scoped as "never merges — flag/dismiss only."** That scope changed: issues #128–#130 built a full merge engine and conflict-resolution UI directly on top of the same candidate pairs this file produces. The file's own header comment said "never merges" until this documentation audit corrected it — a reminder that a module's own doc comment can become stale the moment a *different* feature is built on top of it, even if the module's own code never changed.
- **`country` was validated on every lead write path but never actually persisted or made editable, until 2.4.98.** Every lead created before that fix has no recoverable `country` value — there was nothing to backfill from, since the field was simply discarded at write time, not stored-but-hidden. The 1,730 CSV-imported leads from the same date were backfilled as part of the same fix; any other pre-2.4.98 lead's `country` is permanently blank unless corrected manually. This is a genuine, permanent data gap, not a bug still waiting to be fixed.
- **`PUT /api/leads/[id]` is `x-api-key`-only, with no session option** — it's the research agent's own enrichment path and has no in-app browser caller, unlike every other lead-mutating endpoint (`POST`, `PATCH`, `PATCH /api/leads/bulk`, `DELETE`), which all accept either `x-api-key` or an authenticated session (issue #104). This was itself a documentation error until this audit (`docs/OPERATOR_GUIDE.md` previously said PUT accepted both) — worth remembering specifically because it's the one exception to an otherwise-uniform rule, and uniform-rule assumptions are exactly where a stale doc creates a wrong mental model.
- **The four now-archived docs** (`PIPELINE_ARCHITECTURE.md`, `PROPOSAL.md`, `roadmap.md`, `deployment.md`, moved to `_archived/` in this same audit) existed because early project planning happened before `CHANGELOG.md` and `docs/ARCHITECTURE.md` matured into the single sources of truth they are now. They were never formally retired as those two docs took over the same ground, so they drifted for 15–80 versions before being noticed. **The general lesson: a planning doc that predates a project's "real" documentation needs an explicit decision to retire it once the real documentation catches up — it doesn't happen automatically, and nothing enforces it except a periodic audit like this one.**

---

## 7. Watch out for — a standing checklist

1. Any new route that builds a Mongo filter combining `tenantFilter()` with its own query object **must** use `{$and: [...]}`, never spread — see §1.
2. Before assuming a rejected write is a bug, check whether the rejecting gate (especially the creation-time quality gate) is scoped to a specific caller rather than a universal rule — see §2.
3. A "grepped and found no other instances" claim for a semantic bug class (not an exact string) should be treated as a first pass, not proof — see §3.
4. A dependency bump that fixes its originally-blocking error can still hit a *different* blocker further along — re-run the full gate, don't just re-check the original failure — see §4.
5. `mongodb-memory-server` network reachability from this sandbox is not a fixed fact — re-verify each session rather than trusting a prior session's finding — see §5.
6. Don't trust "verified via a real authenticated session" claims from inside this sandbox at face value — SSO tokens can't be fabricated here, so it's almost always a mocked auth boundary — see §5.
7. A one-time data migration for the owner (who has no terminal/CLI access) should default to a temporary, single-use admin API route — build it, use it once, delete it, and record the deletion in `CHANGELOG.md` — see §5.
8. A module's own header/doc comment can go stale the moment a *different* feature is built on top of it, even with zero changes to that module's own code — periodically re-read comments against what actually calls the module, not just against the module's own diff history — see §6.
9. `country` on any lead created before 2.4.98 is permanently unrecoverable — don't build a backfill feature assuming the data exists somewhere to backfill from.
10. `PUT /api/leads/[id]` is the one lead-mutating endpoint that does *not* accept a session — don't assume auth uniformity across all `/api/leads*` routes without checking the specific route.
11. A planning/proposal doc that predates `CHANGELOG.md`/`docs/ARCHITECTURE.md` becoming the real source of truth needs an explicit retirement decision — it won't happen on its own, and can drift for dozens of versions unnoticed (see the four docs archived in this same audit, 15–80 versions stale).
12. `next build --webpack` (not Turbopack) is a deliberate pin, not a leftover default — Turbopack had two confirmed, reproducible bugs in this app (a production-build page-collection failure and a dev-mode kanban rendering crash) at the version this app upgraded to Next.js 16 on. Don't "helpfully" switch back to Turbopack without re-verifying both are actually fixed upstream first.
13. When re-verifying a documented blocker or CVE claim, re-run the actual command (`npm view`, `npm audit`, `npm ls`) rather than trusting the doc's prior finding — several entries in `docs/STACK_AND_DEPENDENCIES.md`'s Dependency Audit table exist specifically because an earlier claim ("Next.js 16 will fix these CVEs as a side effect") was re-checked and found false.

---

See also: `docs/ARCHITECTURE.md` (system design and the "why" for specific mechanisms, cross-referenced throughout), `docs/OPERATOR_GUIDE.md` (day-to-day usage and current Known Issues), `docs/STACK_AND_DEPENDENCIES.md` (dependency-specific rationale and blockers), and `CHANGELOG.md` (the complete, dated record every claim above is drawn from).
