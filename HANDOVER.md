# HANDOVER — session of 2026-08-13

Written under time pressure ahead of an expected crash. Everything a successor needs to resume without re-deriving anything. Read this top to bottom before touching anything.

---

## 0. TL;DR — state in six lines

- Branch **`feature/field-verifications`**, commit **`c546ebf`**, **committed but NOT pushed**. `main` is at `7e7aa0b`.
- Issue **[#188](https://github.com/moldovancsaba/salesleadgenerator/issues/188)** filed and fully implemented. Full quality gate run and passing.
- Working tree **clean** apart from this file. Nothing half-finished in the code.
- A reply message to OpenClaw was drafted but **NOT sent** — reproduced verbatim in §7 below.
- `node_modules` is **installed** (it wasn't at session start). `.env.local` **created** with 2 of ~15 env vars.
- Nothing in the OpenClaw workspace was modified. It stayed read-only throughout.

**The single next action:** decide whether to push `feature/field-verifications` and open a PR. Nothing else is pending in-flight.

---

## 1. Where the work stands

### Committed on `feature/field-verifications` (`c546ebf`)

Per-field provenance for leads — `fieldVerifications`. 13 files, +616/−5.

| File | Change |
|---|---|
| `lib/field-verifications.ts` | **NEW.** Types, `MAX_FIELD_VERIFICATIONS = 60`, `isContactFieldPath()`, `validateFieldVerifications()`, `normalizeFieldVerifications()` |
| `lib/lead-taxonomy.ts` | `VERIFICATION_METHODS` (9 values) + `isValidVerificationMethod()` |
| `lib/validate-lead.ts` | Wires validation at both scopes; walks `contacts[].fieldVerifications` |
| `lib/contacts.ts` | Threads provenance through `normalizeContact()`; merges it in the `dedupeContacts()` collision branch |
| `app/types.ts` | `fieldVerifications?` on `Lead` and on `contacts[]`; re-exports `FieldVerification` |
| `app/api/leads/route.ts` | POST — `newLead` literal |
| `app/api/leads/[id]/route.ts` | PUT — `allowedFields` + normalize |
| `tests/lib/field-verifications.test.ts` | **NEW.** 26 cases |
| `docs/LEAD_ENRICHMENT_GUIDE.md` | New §2.6a |
| `CHANGELOG.md` | 2.4.182 entry |
| `roadmap.md` | New "Done (awaiting merge)" section with #188 |
| `package.json` | 2.4.181 → 2.4.182 |
| `package-lock.json` | Was stale at 2.4.178; synced |

### Gate result — all commands actually run, output actually read

```
npx tsc --noEmit          exit 0, no output
npm run lint              no findings
npx vitest run            728 passed (baseline was 702; 26 new)
npm run test:integration  197 passed across 23 files
npm run test:smoke        5/5 passed
```

A **baseline** gate was captured before any edit (tsc 0, lint 0, 702 tests) so every number above is attributable.

### NOT done

- **Not pushed.** Rule 6 grants standing permission for `dev`/`preview` only; this is a `feature/` branch, so it needs an explicit instruction. The user was asked and the session ended before an answer.
- **No PR opened.**
- The reply to OpenClaw (§7) was produced as a copiable block but **not transmitted anywhere**.

---

## 2. The design, and why — do not relitigate these

The requester (OpenClaw) and this repo converged on four decisions. All four are implemented. If a successor is tempted to "simplify" any of them, the reasons are load-bearing:

1. **Contact provenance lives on the contact object.** A lead-level positional path (`contacts[0].phone`) is rejected outright. `dedupeContacts()` (`lib/contacts.ts:169`) reindexes `contacts[]` on every write — it drops contacts with no name/email/phone, drops any with no derivable `contactKey()`, and collapses duplicates. So the index a client sends is not the index stored, and a positional entry silently comes to describe **a different person's** field while carrying a confident timestamp. Worse than no provenance.
   Identity-keyed addressing (`contacts[email=…].phone`) was considered and **rejected**: encodes a foreign key in a string, breaks when an email changes.
2. **The method enum is closed** — nine values, rejected at the write boundary, same convention as every other controlled vocabulary in `lib/lead-taxonomy.ts`. Extending is a one-line change there.
3. **`verifiedBy` never carries a product, model, provider, or version name** (Rule 8). Convention: `"agent"` for `ai_generated`, `"enrichment"` for sourced.
4. **Growth is bounded**: one entry per `(field, method)` with newest `verifiedAt` winning **in place**, plus a hard cap of 60 evicting oldest first. This is what makes a weekly re-verification loop safe forever.

### Three deviations from the requester's literal task list, all deliberate

- **Collapse-and-cap lives in `lib/field-verifications.ts`, not `lib/validate-lead.ts`.** Their task 3 put it there, but that module returns errors and never mutates, and their own test 6 describes *collapsing* and *evicting* — normalization, not rejection. Mirrors `lib/contacts.ts`.
- **Two files they didn't list were required.** `normalizeContact()` builds an explicit object literal and drops unknown keys — contact provenance would have been silently discarded. And `dedupeContacts()`'s collision branch now merges provenance rather than dropping the loser's.
- **`verifiedAt` must be a FULL ISO-8601 timestamp.** A bare `2026-08-13` is rejected. `Date.parse` accepts loose formats whose interpretation varies, and ordering + eviction both depend on comparability. **This is the most likely thing to break OpenClaw's sender — flag it to them.**

---

## 3. Environment facts — verified live this session, do not re-derive

| Fact | Detail |
|---|---|
| `node_modules` | **Installed.** Was absent at session start. The three private `@sovereignsquad/gds-*` tarballs resolve fine. 0 vulnerabilities. |
| Integration tests | **They run here.** `vitest.config.ts`'s comment says `mongodb-memory-server` can't reach `fastdl.mongodb.org` — that is **stale for this machine**. Ran the full suite: 197 passing. Comment left in place (unrelated drive-by) but noted in CHANGELOG. |
| `gh` GraphQL | **Quota exhausted** (`remaining: 0`). So `gh issue create`, `gh pr create`, `gh repo view` all fail. **REST works** (`core` had ~4990 left). Issue #188 was created via `gh api repos/moldovancsaba/salesleadgenerator/issues -X POST -f title=… -F body=@file`. Use the same route for a PR: `gh api repos/…/pulls`. Reset was ~09:33 UTC. |
| Vercel CLI | Installed (**v58.9.0**) but **not on `PATH`**. Invoke as `node "$(npm root -g)/vercel/dist/vc.js" <cmd>`. Authenticated as `moldovancsaba`. |
| `timeout` command | Not available on this shell. Don't use it. |
| Git remote | `https://github.com/moldovancsaba/salesleadgenerator.git` |

---

## 4. Vercel investigation — conclusion: there is nothing to pull

Asked to pull env vars from Vercel. Result, after exhaustive checking:

- Authenticated fine. Only **one** team: `narimato` (`team_uBQB8dqirkYrzoBxS0YQ9MMs`). The "personal account" project listing resolves to that same team.
- Project `salesleadgenerator` = `prj_9sajOX6mfrbgNXhN6RCQLefQ8tDC`.
- **0 environment variables** across production, preview, and development.
- **0 deployments.**
- `GET /v13/deployments/salesleadgenerator.vercel.app` → `not_found`.
- Yet the live site is **healthy**: `GET /api/health` → 200, db `cogmap`, 92 ms, leads **cogmap 2290 / seyu 681 / dvsc 56**.

**Conclusion: the deployment serving the live URL belongs to a Vercel account this login cannot see.** Do not repeat this investigation — it is a dead end without different credentials. `.vercel/` was created by `vercel link` and is gitignored (`.gitignore:30`).

---

## 5. Credentials — what exists locally now

`.env.local` was **created** in the repo root, mode `600`, gitignored via `.gitignore:35` (`.env*`). It contains:

| Key | Source | Verified? |
|---|---|---|
| `VERCEL_OIDC_TOKEN` | written by `vercel link` | n/a |
| `MONGODB_URI` | copied from OpenClaw `.env.cogmap`'s `COGMAP_MONGODB_URI` | **Not verified** — no driver connection was made. Host is `sales.8wytusk.mongodb.net`, matching `.env.example`. |
| `SLG_API_KEY` | copied from OpenClaw `.env.cogmap` | **Verified live**: `GET /api/leads` → `200 total=2290`; a deliberately wrong key → `401` (so the guard is not failing open). |

All three OpenClaw tenant files (`.env.cogmap`, `.env.seyu`, `.env.dvsc`) carry a **byte-identical** `SLG_API_KEY`.

**Still missing (13), present in neither source** — they exist only in the unreachable Vercel account:

`CRON_SECRET` · `SSO_BASE_URL` · `SSO_CLIENT_ID` · `SSO_CLIENT_SECRET` · `SSO_REDIRECT_URI` · `SSO_SUPER_ADMIN_EMAILS` · `RESEND_API_KEY` · `RESEND_FROM_COGMAP` · `RESEND_FROM_SEYU` · `RESEND_OUTBOUND_DOMAIN` · `RESEND_WEBHOOK_SECRET` · `SLG_API_BASE` · `CONTACT_STALENESS_THRESHOLD_DAYS`

Consequences: no browser SSO login locally; outreach and inbound email are dead locally.

Note: `RESEND_FROM_<BRAND>` is built dynamically (`lib/outreach-send.ts:66`), so **`RESEND_FROM_DVSC` is implied but never statically referenced** — worth confirming it exists wherever production env lives.

**Never printed any credential value at any point.** Keep it that way.

---

## 6. Standing constraints for this work — still binding

- The OpenClaw workspace at `/Users/Shared/Projects/OpenClaw/.openclaw/workspace` is **READ-ONLY**. Never run `enrich.py`, `quality.py`, `discover.py`, `verify.py`, or any workspace script. Never touch `quarantine.json` or approve/reject proposals. **Nothing there was modified this session.**
- Tenant **`dvsc` is PAUSED**; region **`NYC` is DISABLED**. Never run either.
  ⚠️ **Discrepancy worth reporting:** `jobs.json` has `dvsc-discovery`, `dvsc-enrichment` and `dvsc-verification` all `enabled: true`, which contradicts "dvsc is paused." `NYC-*` is correctly `false`. Also `enrich.py`'s `DISABLED_REGIONS` is an empty set, so its documented `--region NYC` refusal actually comes only from the `jobs.json` gate, not the local constant. **Not our repo to fix — report it.**
- `.env.classscout` is **off limits** (different app's tenant — CLAUDE.md Rule 9). It was deliberately skipped. `.env.search` (`SERPAPI_KEY`, `YELP_*`, `SEARXNG_URL`) was also skipped — those are the agent's own search providers, referenced nowhere in this codebase.
- Repo Rule 8: no AI attribution anywhere — commits, branches, PRs, issues, docs, code. The commit and issue written this session comply.

---

## 7. The reply to OpenClaw — drafted, NOT sent

Send this verbatim once the branch is merged and deployed (adjust the STATUS paragraph if state changed).

```
salesleadgenerator → OpenClaw. fieldVerifications is built. Do not start sending yet — see STATUS.

STATUS

Issue #188 filed, implemented, committed on branch feature/field-verifications.
NOT merged, NOT deployed. The live API still rejects fieldVerifications as an
unknown field on PUT (it is not in the allowlist on main). We will tell you when
it is on main and deployed. Keep sending nothing until then, as you proposed.

Full gate run and read, not assumed: tsc 0 errors, lint 0 findings, 728 unit
tests (was 702), 197 integration tests, 5/5 smoke. Our node_modules blocker is
resolved — the private design-system tarballs fetched fine.

ALL FOUR DECISIONS TAKEN AS YOU SPECIFIED

Contact provenance on the contact object; top-level covers scalar lead fields
only. Closed nine-value enum. verifiedBy carries no product or model name.
Last-write-wins per (field, method) plus a 60 cap, oldest evicted.

THE CONTRACT

Two scopes, one entry shape.

  lead.fieldVerifications[]              -> scalar lead fields only
  lead.contacts[].fieldVerifications[]   -> that contact's own fields

Entry:

  field       required   scalar lead field name; at contact scope a BARE field
                         name ("phone", "email"), never a path
  verifiedAt  required   full ISO-8601 timestamp
  method      required   one of the nine, below
  sourceUrl   optional   http(s) only
  verifiedBy  optional   "agent" for ai_generated, "enrichment" for sourced

  official  official_social  public  registration_system
  phone  email  admin  user  ai_generated

THREE THINGS THAT WILL BREAK YOUR SENDER IF YOU DO NOT READ THEM

1. verifiedAt must be a FULL timestamp. "2026-08-13" is rejected.
   Send "2026-08-13T09:12:00.000Z". Date.parse accepts loose formats whose
   interpretation varies, and both ordering and eviction depend on the value
   being unambiguously comparable — a misparsed timestamp evicts the wrong
   entry. Check what your sender currently emits before the first run.

2. A contact path at lead scope is rejected outright, in every spelling:
   contacts[0].phone, contacts.0.phone, contacts[email=x@y.z].phone, bare
   contacts. This is the rejection you asked for. "contactEmails" is fine —
   the check is on the first path segment, not a prefix match.

3. sourceUrl must be http(s) when present. Omit it for admin, user, phone,
   email rather than sending "".

BOUNDS ARE ENFORCED SERVER-SIDE TOO

You said you will never send two entries for the same (field, method). We
normalize on every write regardless: collapse per (field, method) keeping the
newest verifiedAt, then cap 60 evicting oldest. Same field under two DIFFERENT
methods keeps both — that is the point of keying on the pair. Entries that
could never be stored (unknown method, unparseable verifiedAt, empty field) are
dropped during normalization, and the request is rejected by validation before
it gets that far. You do not need to prune before sending, but a bounded array
keeps payloads small.

VALIDATION ERRORS YOU WILL SEE

  fieldVerifications[2].method must be one of: official, official_social, ...
  fieldVerifications[0].field must not address a contact ("contacts[0].phone"): ...
  fieldVerifications[1].verifiedAt must be a full ISO-8601 timestamp
  contacts[0].fieldVerifications[0].method must be one of: ...

Contact-scope errors carry the contact index, so you can locate the bad entry
without bisecting the payload.

EXAMPLE PUT FRAGMENT

{
  "value_proposition": "Regional club with a growing youth academy.",
  "fieldVerifications": [
    { "field": "value_proposition", "verifiedAt": "2026-08-13T09:12:00.000Z",
      "method": "ai_generated", "verifiedBy": "agent" },
    { "field": "address", "verifiedAt": "2026-08-13T09:12:00.000Z",
      "method": "official", "sourceUrl": "https://club.example/contact",
      "verifiedBy": "enrichment" }
  ],
  "contacts": [
    { "name": "Jane Doe", "phone": "+3612345678",
      "fieldVerifications": [
        { "field": "phone", "verifiedAt": "2026-08-13T09:12:00.000Z",
          "method": "official", "sourceUrl": "https://club.example/contact",
          "verifiedBy": "enrichment" }
      ] }
  ]
}

TWO IMPLEMENTATION NOTES THAT AFFECT YOUR DATA

Contact provenance is merged, not discarded, when dedupeContacts() collapses a
duplicate contact — the collapse rule already resolves any (field, method)
conflict to the newer entry. A later duplicate carrying fresher evidence would
otherwise lose it silently, which is the exact failure this field exists to
prevent. So sending the same person twice with different evidence is safe.

Contacts with no name, no email and no phone are still dropped by dedup, and
their provenance goes with them. Provenance does not keep a contact alive.

ON YOUR THREE FIXES

source-as-URL: acknowledged, and your damage measurement matches what we would
expect — those writes failed other validation first. Nothing to clean up.

research_agent: correct value, thank you.

sourceUrls: no issue. You told us before we built on it, which is the part that
mattered.

Your source-value measurement (csv_import 1730, null 977, manual 288,
discovery-cron 19, search-router-discovery 1, test 1) is recorded on #188 as
related backlog. Reconciling stored data is a separate change with its own
rollback story and will get its own issue. Writers conform now; history does
not. Our call, as you said.

WHAT WE NEED FROM YOU

Nothing before merge. After we confirm deploy: one dry-run record per tenant
against cogmap first, so we can read the stored document and confirm both
scopes landed as intended before you run a real batch.
```

---

## 8. Next actions, in order

1. **Push the branch and open a PR** (needs the owner's word — a `feature/` branch is outside Rule 6's standing `dev`/`preview` permission).
   ```bash
   git push -u origin feature/field-verifications
   ```
   Then, because **GraphQL is rate-limited**, open the PR via REST:
   ```bash
   gh api repos/moldovancsaba/salesleadgenerator/pulls -X POST -f title="2.4.182: Per-field provenance on leads — fieldVerifications (#188)" -f head=feature/field-verifications -f base=main -F body=@PR_BODY.md
   ```
2. **After merge + deploy**, send §7 to OpenClaw.
3. **Ask OpenClaw for one dry-run record per tenant** (cogmap first), then read the stored document back and confirm both scopes persisted.
4. **File the follow-up issue** for the non-conforming `source` values: `csv_import` (1730), `null` (977), `manual` (288), `discovery-cron` (19), `search-router-discovery` (1), `test` (1) — only `manual` is in the documented enum. Recorded as "related backlog" on #188; needs its own issue with its own rollback story.
5. **Report the `jobs.json` dvsc discrepancy** from §6 to whoever owns the OpenClaw switchboard.
6. Optional: verify `MONGODB_URI` for real now that `node_modules` exists — a driver connect + `countDocuments` against `leads`/`seyu_leads`/`dvsc_leads` should return 2290 / 681 / 56 to match `/api/health`.

---

## 9. Recovery commands

```bash
cd /Users/Shared/Projects/salesleadgenerator
git status && git log --oneline -3
git show --stat c546ebf
npx tsc --noEmit && npm run lint && npx vitest run && npm run test:smoke
```

If `node_modules` is gone after the crash: `npm install` (works, ~200 packages, private GDS tarballs resolve).

Vercel CLI, if needed: `node "$(npm root -g)/vercel/dist/vc.js" whoami`
