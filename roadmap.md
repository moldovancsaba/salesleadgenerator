# Roadmap — Sales Lead Generator

**Why this file exists:** GitHub's Projects (v2) board for this repo cannot be read or written from this session — its only API is GraphQL, and this session's GitHub credentials are restricted to a pinned set of PR-review operations (verified directly: a live authenticated GraphQL call was rejected by the session's own proxy, not by GitHub). Classic Projects (the old REST-based board) is gone from GitHub entirely — sunset 2024, fully removed mid-2025 (confirmed live: `GET /repos/.../projects` returns a real `404` from GitHub itself). This file is the substitute: every real open issue, grouped by status, kept in sync by hand whenever an issue's state changes. It is not a replacement for the issues themselves — every row here is a real GitHub issue, this is just a single-page view of all of them.

**Keeping this in sync:** whenever an issue opens, closes, or changes status/priority, update its row here in the same change. If this file and GitHub ever disagree, GitHub is the source of truth — fix this file, not the other way around.

**Full methodology** — the exact tools used to manage issues, the mandatory issue-body structure, the real label taxonomy, how dependencies between issues are recorded, and the complete verified investigation behind why no board is reachable — lives in `docs/ISSUE_MANAGEMENT.md`. This file is just the live status view; that one is the reference.

**Not the same file as `_archived/roadmap.md`** — that's a frozen, historical feature-status log (v2.4.61), superseded by `CHANGELOG.md`, sharing this file's basename by coincidence rather than by relation. See `README.md`'s "Archived Documentation" table.

Last synced: 2026-08-08, against `moldovancsaba/salesleadgenerator`'s real open-issue list (6 issues).

---

## In Progress

| # | Title | Priority | Notes |
|---|---|---|---|
| [#132](https://github.com/moldovancsaba/salesleadgenerator/issues/132) | Backfill existing leads into the controlled taxonomy schema (rulebook v1.0, Phase 2) | P1 | 318 of 2,874 leads classified as of the last batch (2026-08-08), re-derived live from `GET /api/leads` rather than trusted from any prior branch's own claim (see `docs/LESSONS_LEARNED.md` §3 — an orphaned branch's claimed progress was found not to match production). Picking now weighted toward QUALIFIED/ENGAGED/PROPOSAL-stage leads (sales-team-active), not just backlog — see `docs/LEAD_TAXONOMY_MIGRATION_PLAN.md` §9. Real, ongoing, multi-session effort — not completable in one sitting. |

## Done (awaiting merge)

| # | Title | Priority | Notes |
|---|---|---|---|
| [#188](https://github.com/moldovancsaba/salesleadgenerator/issues/188) | Per-field provenance on leads: `fieldVerifications` with a closed method enum | P2 | Built on `feature/field-verifications`, `origin/main` merged in. Additive only — new optional field at two scopes (lead-level for scalar fields, per-contact for contact fields), closed nine-value method enum, bounded by last-write-wins per `(field, method)` plus a 60-entry cap. Full gate run and passing: tsc 0, lint 0, 728 unit, 197 integration, 5/5 smoke. **Urgency note:** the enrichment agent is already sending this field to production, where it is accepted with `200` and silently dropped (it isn't in `PUT`'s `allowedFields` on `main`), so every enrichment run until this merges produces records whose origin cannot be reconstructed. |

## Ready (unblocked, unstarted)

| # | Title | Priority | Notes |
|---|---|---|---|
| [#137](https://github.com/moldovancsaba/salesleadgenerator/issues/137) | Duplicate lead records at scale: 43.8% of Seyu, 10.7% of CogMap | P1 | Root-cause matching-algorithm fix already shipped. What remains needs a real browser session at `/admin/duplicates` (super-admin SSO) — confirmed blocked via both `x-api-key` and direct MongoDB attempts. **Needs the owner**, not another agent turn. |
| [#125](https://github.com/moldovancsaba/salesleadgenerator/issues/125) | Adopt GDS zone-based kanban scroll routing once available | P2 | See Blocked below — the local workaround (2.4.95) is a live, tested fix; this issue tracks retiring it once the upstream dependency ships the real one. |
| [#165](https://github.com/moldovancsaba/salesleadgenerator/issues/165) | New-user onboarding tour: step-by-step spotlight walkthrough (design record) | P3 | Design plan, decision now made (2026-08-08, owner-confirmed): `driver.js`, per this issue's own recommendation. Implementation tracked separately in #185. |
| [#185](https://github.com/moldovancsaba/salesleadgenerator/issues/185) | Implement new-user onboarding tour using driver.js | P3 | Follow-up to #165 now that the library decision is made. Unblocked, unstarted — a real multi-part UI build (tour controller, stable selectors on 7 target elements, keyboard/screen-reader accessibility, mobile verification). |

## Blocked

| # | Title | Priority | Blocked on |
|---|---|---|---|
| [#125](https://github.com/moldovancsaba/salesleadgenerator/issues/125) | Adopt GDS zone-based kanban scroll routing once available | P2 | An upstream feature in `sovereignsquad/general-design-system` — a full implementation plan is drafted in the issue itself, ready to file there, but this session's GitHub access can't reach that repo. Needs a human or a session scoped to that repo to actually file it. |

*(#125 appears in both Ready and Blocked above — it's unblocked as tracking/documentation work, but the actual fix is blocked on the external dependency.)*

## Recently closed (context)

| # | Title | Resolution |
|---|---|---|
| [#189](https://github.com/moldovancsaba/salesleadgenerator/issues/189) | `main` is red: credential scrub left webhook test fixtures undecodable | Fixed (PR #190) — the 2026-08-14 scrub replaced webhook test fixtures with a placeholder that isn't valid base64, so `standardwebhooks`' eager decode threw before any assertion ran (14 tests failing). Fixture is now derived in-file from a fixed byte pattern: decodable, deterministic, obviously synthetic, no literal for a scanner to match. Also restored two negative tests that had been given the same placeholder as the valid secret and would have passed vacuously. |
| [#172](https://github.com/moldovancsaba/salesleadgenerator/issues/172) | `Lead.region` type contradicts real free-text behavior | Fixed (2.4.179, PR #184) — live production audit found 55+ real values, widened type to `string`; also converted `AddLeadModal`/`FilterBar`'s hardcoded 3-value `Select` to free-text `TextInput`, matching `country`'s existing pattern. |
| [#179](https://github.com/moldovancsaba/salesleadgenerator/issues/179) | Next.js 16.3.0 GA may fix the two CVEs docs said had no upstream fix | Fixed (2.4.178) — bumped `next`/`eslint-config-next` to 16.3.0, confirmed both CVEs resolved via `npm ls`/`npm audit`. Also resolved 3 unrelated pre-existing `npm audit` findings (`brace-expansion`, `js-yaml`, `nanoid`) via `npm audit fix`. |
| [#178](https://github.com/moldovancsaba/salesleadgenerator/issues/178) | `GET /api/stats` and `GET /api/boards` have no auth check at all | Fixed (2.4.177, PR #181) — gated both with `requireApiKey`, matching every other data-exposing admin route. |
| [#171](https://github.com/moldovancsaba/salesleadgenerator/issues/171) | `Lead` type missing `contactEmails` field | Fixed (2.4.175, PR #177) — added `contactEmails?: string[]` to `app/types.ts`. |
| [#170](https://github.com/moldovancsaba/salesleadgenerator/issues/170) | Sales Settings hardcodes "(€)" on pricing labels regardless of brand | Fixed (2.4.175, PR #177) — labels now derive the symbol from `BRAND_CONFIG[brand].currency` via a new shared `CURRENCY_SYMBOLS` map. |
| [#169](https://github.com/moldovancsaba/salesleadgenerator/issues/169) | Manually-added deals default to USD regardless of brand | Fixed (2.4.171, PR #175) — root cause was deeper than the title: every ticket-size currency computation site ignored the operator's saved Sales Settings currency selection in favor of the brand's fixed default. Fixed at every call site; Sales Settings currency option preserved, now actually honored. |
| [#166](https://github.com/moldovancsaba/salesleadgenerator/issues/166) | 4 bugs/type gaps surfaced during the docs/LLD audit | Split into #169–#172 above for independent tracking. |
| [#163](https://github.com/moldovancsaba/salesleadgenerator/issues/163) | Apply #136's federation/tournament rule to the 4 remaining leads | Resolved — all 4 researched and reclassified with real citations. |
| [#142](https://github.com/moldovancsaba/salesleadgenerator/issues/142) | Reply matching + contact-enrichment suggestions from inbound email | Shipped (2.4.165). Live webhook trigger still pending two owner-only infra steps (Resend/DNS) — tracked in `docs/STACK_AND_DEPENDENCIES.md`, not a separate issue. |
| [#135](https://github.com/moldovancsaba/salesleadgenerator/issues/135) / [#136](https://github.com/moldovancsaba/salesleadgenerator/issues/136) / [#143](https://github.com/moldovancsaba/salesleadgenerator/issues/143) | Taxonomy governance decisions (brand convention, federation/tournament rule, entertainment-event value) | Resolved per owner decision, retroactively applied to known data points. |

---

## Legend

- **Priority**: P1 = high, P2 = medium, P3 = low — matches each issue's own GitHub label.
- **Status groups** here mirror what a project board's columns would show (In Progress / Ready / Blocked) — primarily derived from each issue's own `status:` label, not a separate tracking mechanism, with documented exceptions noted inline where a single issue's real-world state doesn't collapse cleanly into one label (e.g. #125 above, which carries only `status: blocked` but is tracking-work-unblocked/fix-blocked at once).
