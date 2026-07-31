# Lead Taxonomy Migration Plan — Rulebook v1.0 Backfill

**Version:** 2.4.149

**Status:** Plan / design document, now with one completed execution slice. Phase 2's mechanical `sportCode` sub-step (see §4) has actually run against production — the rest of Phase 2 (every other identity field, and the 299 leads `sportCode` couldn't mechanically resolve) is still unstarted. It describes how to convert the app's existing leads into the controlled taxonomy schema shipped in 2.4.109 (`lib/lead-taxonomy.ts`, `lib/lead-classification.ts`, the new `Lead` fields documented in `docs/ARCHITECTURE.md`'s "Controlled Sports-Industry Taxonomy" section).

---

## 1. Why this is a separate deliverable

The owner's request was two-part: "use this [rulebook] to improve the enrichment process and the data structure in general **and** make a plan to convert our existing data into the delivered new structure." The first half — the schema, validation, matching, and merge-engine changes — is additive and mechanical: it shipped in 2.4.109 without touching a single existing document. The second half — actually classifying **every existing lead** against the rulebook's controlled vocabularies (`sportCode`, `orgTypeCode`, `businessUnitCode`, `genderCode`, `demographicCodes`, `cityName`, `parentOrgName`, etc.) — is not mechanical. It requires the same kind of individual, evidence-based judgment call the enrichment agent itself makes for a single lead, applied at the scale of the entire database. That can't be safely batch-scripted (there is no reliable string transform from `"FC Bayern München - Youth Academy"` free text to `{sportCode: 'football', businessUnitCode: 'youth-academy', cityName: 'Munich'}`), and per CLAUDE.md Rule 2 it must be planned and tracked as its own scoped work, not silently folded into the schema delivery or attempted ad hoc in the same turn that built the schema.

## 2. Current state (gap analysis)

Updated 2026-07-30, after the mechanical `sportCode` backfill (`scripts/taxonomy-sportcode-backfill.ts`, §4 Phase 2 sub-step) ran against production for real via the deployed HTTPS API:

| Brand | Collection | Total leads | `sportCode` set | `sportCode` unresolved | Any *other* new taxonomy field set |
|---|---|---|---|---|---|
| CogMap | `leads` | 2,187 | 2,051 | 136 | 0 |
| Seyu | `seyu_leads` | 536 | 373 | 163 | 0 |
| **Total** | | **2,723** | **2,424** | **299** | **0** |

(Total lead counts shifted slightly from the 2,189/536 originally recorded here — normal churn from leads created/removed since this doc was first written, not a discrepancy in the backfill itself.)

`sportCode` was chosen as the first field to backfill because it's the rulebook's one non-negotiable field (§3.1) and the only one mechanically derivable from data already on every lead, via the existing tested `resolveSportAlias()` (`lib/lead-taxonomy.ts`) applied to the free-text `sport_or_sector`. Of the 2,723 leads scanned, 107 already had `sportCode` set (from the enrichment-loop pilot, CHANGELOG 2.4.114-2.4.119) and were skipped as idempotent no-ops; of the remaining 2,616, 2,317 resolved mechanically and were written with **0 apply failures**; 299 could not be resolved from stored free text (102 blank `sport_or_sector`, the rest values with no alias-table entry — e.g. "Entertainment", "Sports Media", "Multi-Sport High Performance" — see the script's own frequency-ranked output for the full list). Those 299 remain candidates for the evidence-based agent-research path (§5), not a second mechanical pass — a blank or off-vocabulary `sport_or_sector` free text is exactly the case the rulebook expects a human/agent judgment call to resolve, not a string transform.

Every existing lead has `sport_or_sector` (free text, inconsistent — see the "Soccer"/"Football"/"Football (Soccer)" fragmentation documented in `docs/ARCHITECTURE.md`'s Near-Duplicate section) and `industry` (free text). Beyond the `sportCode` slice above, none of the leads have the remaining controlled `*Code` fields, `cityName`, `parentOrgName`, `classificationTags`, or `mergeKey` populated with anything beyond the server-derived defaults (`mergeKey` is always computed on write, even from a lead with only `sportCode` set — e.g. `unknown|football|unknown|unknown|unknown|US|unknown` — see `docs/ARCHITECTURE.md`). `country` (ISO alpha-2) is already populated for leads created after 2.4.98 and remains permanently blank for a real, counted set of leads created before it (see `docs/LESSONS_LEARNED.md`) — those pre-2.4.98 leads are lower-confidence candidates for `#country:` tag generation until `country` itself is separately backfilled or re-researched.

Nothing in the app **requires** any lead to have taxonomy data — every existing feature (kanban, forecast, ticket-size estimation, near-duplicate matching, the merge engine) already tolerates its total absence, and will continue to for as long as the backfill takes. This is a quality/coverage improvement, not a blocking migration.

## 3. Goals and non-goals

**Goals:**
- Every lead eventually has a best-effort `sportCode` (the rulebook's single non-negotiable field, §3.1) and, where evidence supports it, the remaining identity fields.
- Near-duplicate matching and the merge engine benefit from real `sportCode`/`mergeKey` data instead of relying solely on free-text `sport_or_sector` alias resolution.
- The backfill is auditable: every classification decision records what evidence it was based on and how confident it is, so a wrong classification can be traced and corrected.
- The process is resumable and idempotent — re-running it after a partial run or a schema tweak does not re-classify leads that already have current, correct data, and never silently overwrites a value a human has since corrected.

**Non-goals (explicitly out of scope for this plan):**
- A formal Parent Organisation collection/object (rulebook §2.2). `parentOrgId`/`parentOrgName` exist on `Lead` as best-effort links today; building a real parent-org record type with its own CRUD, dedup, and hierarchy is Phase 3+ work, tracked separately once there's a clear need (e.g. once enough leads share a `parentOrgName` that browsing/filtering by parent becomes valuable).
- A formal Opportunity object distinct from a lead (rulebook §2.4). This app's existing `deals[]` field already partially covers that concept; formalizing it further is out of scope here.
- Automatically merging any leads as a side effect of classification. Classification only ever *adds* taxonomy fields to existing lead documents — it never merges, deletes, or restructures records. Any merge opportunities the improved matching surfaces still go through the existing human-reviewed `/admin/duplicates` queue, exactly as today.

## 4. Phased approach

### Phase 1 — Schema and tooling (shipped, 2.4.109)
Controlled vocabularies, validation, server-derived `classificationTags`/`mergeKey`, near-duplicate `sportCode` preference, merge-engine taxonomy conflict handling, and the updated enrichment-agent prompt (`docs/LEAD_ENRICHMENT_GUIDE.md` §2.6/§5 step 7). This is the foundation every later phase writes through — no backfill work could safely start before this existed, since there would be nowhere valid to write a classification to.

### Phase 2 — Sample-validated batch classification (`sportCode` sub-step shipped 2.4.130; every other field not started)
The actual backfill, run in the same **dry-run → small sample → full batch** shape already proven twice in this session (the CSV-import path and the full-database duplicate-search path), because both times a step directly to "run it on everything" would have been the wrong call — the duplicate-search work specifically caught a real matching-criteria bug (§18 in `CHANGELOG.md`'s 2.4.107 entry) only because a real diagnostic run against production-scale data surfaced it before any destructive action was taken.

**Status update (2.4.130):** the one field with a reliable mechanical source — `sportCode`, via `resolveSportAlias(sport_or_sector)` — has been backfilled for real, following exactly this dry-run → sample → full-batch sequence (`scripts/taxonomy-sportcode-backfill.ts`; results in §2 above). Every *other* identity field (`orgTypeCode`, `businessUnitCode`, `genderCode`, `cityName`, `parentOrgName`, `demographicCodes`, etc.) has no mechanical source and still requires the full evidence-based agent-research process below, at the per-lead cost proven in the 7-lead pilot loop (CHANGELOG 2.4.114-2.4.119, roughly 5 minutes/lead of agent research) — applying that to the remaining ~2,700 leads is a large, not-yet-scheduled undertaking, not a follow-up script.

1. **Dry-run, 0 writes.** Run the classification agent (the same underlying research/reasoning capability as the enrichment prompt, but a distinct run mode — see §5 below) against every lead, but only *report* proposed classifications; write nothing. Produces a spreadsheet-shape summary: how many leads got a confident `sportCode`, how many resolved to `unknown`, how many the agent flagged as genuinely ambiguous (e.g. a name suggesting two sports) for human review before any write happens.
2. **Sample, ~25-50 leads per brand, real writes.** Apply the dry-run's proposed classifications to a small, real sample (mixing high-confidence and edge-case leads deliberately, not just the easiest ones), then have a human (or a second, independent verification agent — see §6) spot-check the results against the source evidence. This is where a systematic error (a bad alias mapping, a misread evidence rule) gets caught while the blast radius is 50 leads, not 2,725 — exactly the lesson from the 2.4.106→2.4.107 correction earlier in this project's history.
3. **Full batch, brand by brand.** Once the sample validates cleanly, run the same process across the remainder of one brand fully, then the other — never both brands simultaneously on the first full run, so a brand-specific issue (e.g. Seyu's different sport mix, or CogMap's larger volume) doesn't get discovered only after both are already touched.
4. **Report actual coverage, no silent gaps.** Every batch run logs and reports: leads classified with confidence, leads left `unknown` for a specific stated reason (no usable public evidence, genuinely ambiguous), and leads skipped entirely (with why) — matching this repo's "no silent caps" convention already established for the duplicate-scan's `MAX_SCAN_SIZE` truncation reporting.

### Phase 3 — Structural follow-ons (proposed, not started, not scoped in detail here)
Once real classified data exists at volume: evaluate whether a formal Parent Organisation object is now worth building (are there enough real `parentOrgName` clusters to justify it?), whether `mergeKey` collisions across the classified set surface new safely-mergeable candidates the old free-text matching missed, and whether the Opportunity/deal model needs to formally absorb more of the rulebook's `§2.4` concept. Each of these gets its own scoped issue when Phase 2's real data makes the need concrete — speculatively designing them now, before there's real classified data to design against, would be exactly the kind of premature abstraction CLAUDE.md's own operating rules warn against.

## 5. Classification strategy — how a lead actually gets classified

Reuses the same infrastructure as ongoing enrichment (`docs/LEAD_ENRICHMENT_GUIDE.md`), not a separate one-off script, because the underlying task is identical: given a lead's current stored data and public research access, produce structured, evidence-based field values, never a guess. Concretely, one classification pass per lead:

1. Read the lead's current stored fields (`entity_name`, `url`, `sport_or_sector`, `industry`, `address`, `notes`, existing contacts) as the starting evidence.
2. Where the free-text `sport_or_sector` already resolves confidently via `resolveSportAlias()` (`lib/lead-taxonomy.ts`), that's a strong starting signal for `sportCode` — but it is **not** applied blindly as a mechanical find-replace; the agent still confirms it's consistent with the org's actual name/site/evidence, since a purely mechanical alias substitution could propagate an existing wrong `sport_or_sector` value forward with false confidence.
3. Research (public site, org registry, prior evidence) to fill in `orgTypeCode`, `businessUnitCode`, `genderCode`, `demographicCodes`, `cityName`, `parentOrgName`, `relationshipToParent`, `canonicalLeadName` — using the exact same "unknown"-not-guessed discipline documented in `docs/LEAD_ENRICHMENT_GUIDE.md` §2.6.
4. Write via the existing `PUT /api/leads/{id}` partial-update path — no new write path, no new endpoint. `classificationTags`/`mergeKey` are derived automatically by the server on that write, exactly as they are for any other enrichment update.
5. Never touch `entity_name`/`url`/other pre-existing identity fields as a side effect of a classification pass — this is additive tagging, not a correction pass; a genuine identity error spotted along the way gets flagged in `notes` for human review, matching the existing enrichment guardrail.

## 6. Verification approach

- **Independent spot-check during the Phase 2 sample step** (§4.2): a second pass — either a human reviewer or a second, independently-run agent given only the source evidence (not the first agent's proposed answer) — checks a subset of the sample's classifications for agreement. Disagreement on `sportCode` specifically (the rulebook's single non-negotiable field) is treated as a stop-and-fix signal before the full batch proceeds, not noise to average over.
- **Structural sanity checks**, cheap and mechanical, run against the written data after each batch: every `sportCode`/`orgTypeCode`/etc. is a real value from the current `lib/lead-taxonomy.ts` list (this is also enforced at write time by `lib/validate-lead.ts`, so a structural violation should be impossible, but a post-hoc scan catches any bypass of that validation, e.g. a direct DB write outside the API); no lead has a `mergeKey` inconsistent with its own stored fields (i.e., `buildMergeKey()` re-run against the stored fields produces the exact stored `mergeKey` — catches any code path that wrote the fields without going through the shared derivation function).
- **Downstream effect check**: after each brand's full batch, re-run the existing near-duplicate scan (`POST /api/admin/duplicate-scan`) and compare candidate-pair counts/composition before and after — an increase in *plausible* candidates (same `mergeKey` prefix, genuinely similar names) is the expected, desired outcome; a large increase in *implausible* candidates would indicate a classification-quality problem worth investigating before continuing to the next brand.

## 7. Risk and rollback

- **Risk: a wrong `sportCode` on a lead causes a bad automatic merge.** Mitigated structurally, not just procedurally — this app's merge engine has no automatic-merge path at all; every merge, regardless of how confidently matched, requires a human to open `/admin/duplicates`, review the actual conflict, and click Merge (`docs/ARCHITECTURE.md`'s Duplicate Lead Merge section: "no admin bypass," "server-side gated on the review's own `status === 'confirmed'`"). A classification error can at worst create or suppress a *candidate* for human review, never merge or delete a lead on its own.
- **Risk: a batch run partially completes or fails midway.** Every write is a normal, independent `PUT /api/leads/{id}` — there is no multi-document transaction and none is needed, since each lead's classification is fully self-contained. A failed/interrupted batch simply leaves the unclassified leads unclassified; re-running is safe and resumes correctly as long as the run tracks which lead IDs it already wrote (skip-if-already-classified, matching every other backfill script's idempotency convention in this repo, e.g. `lib/backfill-ticket-size.ts`).
- **Rollback**: because classification is purely additive (new fields only — no existing field is overwritten by this process), rolling back a bad batch means clearing the new fields on the affected leads (a targeted `$unset` via a small reversal script, or individual `PUT`s with the fields explicitly cleared) — it does not require restoring from a snapshot or touching any other part of the lead document. No production data has been written by this plan as of this version; this section describes the mechanism available if Phase 2 execution later needs it.
- **Risk: classification volume/cost.** ~2,725 individual research passes is a real amount of work, comparable in shape (though larger in count) to the 10-lead enrichment test already run live in this session. Phase 2 should be explicitly budgeted and run in tracked batches (§4.2-4.3), not attempted as a single unbounded sweep — matching this repo's "no silent caps" convention: if a batch run has to stop partway through a brand for any reason, that should be visible in its report, not silently incomplete.

## 8. Acceptance criteria for Phase 2 (when it is scoped and started)

- A dry-run report exists covering 100% of both brands' leads before any write.
- The sample step (§4.2) is independently verified (§6) before the full batch proceeds.
- Each brand's full batch run reports: leads classified, leads left explicitly `unknown` (with reasons), leads skipped (with reasons) — no unexplained gap between total leads and (classified + unknown + skipped).
- Post-batch near-duplicate scan comparison (§6) is reviewed before considering the brand's batch complete.
- This document, `docs/ARCHITECTURE.md`, and `CHANGELOG.md` are updated with the actual outcome once Phase 2 runs — matching this project's own standing rule that a plan document is not itself a substitute for recording what actually shipped.

## 9. Session handoff — resuming the agent-research classification loop (as of 2026-07-31, v2.4.149)

Phase 2's evidence-based agent-research classification (§5 above) is **actually running**, not just planned — it started as a live pilot (CHANGELOG 2.4.114-2.4.119, 7 leads) and has continued as an ongoing autonomous loop through 2.4.130. This section is a literal resume-from-here runbook for whichever session (this one or a fresh one) picks it up next, since the process itself lives only in conversation history and scratch files that don't survive a session handoff.

**Progress as of this checkpoint:** **95 of ~2,723 leads have full taxonomy** (`orgTypeCode` set, meaning the classification pass genuinely ran on them — either with real evidence or with an honest `orgTypeCode: "unknown"` after a real search found nothing). Separately, **2,424 of 2,723 leads have `sportCode` set** from the earlier mechanical backfill (§2/§4 above) — that's a much larger number but is *not* the same thing as full classification; those leads still need this same evidence-based pass for every other field. ~2,681 leads remain untouched by this loop. At the proven pace (~4 leads fully classified per ~15-20 minute batch cycle, run continuously), this is a genuinely large, multi-session undertaking — budget accordingly, don't assume it finishes in one sitting.

### The exact working pattern (repeat this loop)

0. **Before spending research effort on a pick, check for pre-existing un-merged duplicate records of the same real-world org.** Confirmed real (owner QA on the 2.4.131 batch, 2026-07-30): this database has multiple un-merged duplicate `entity_name` records that near-duplicate detection never caught — e.g. 4 separate "Austin FC Academy" CogMap records from different CSV-import dates, 2 "Melbourne Victory" Seyu records, and 2 "Fenerbahçe"/"Fenerbahce" Seyu records where an accent-spelling variant is exactly why exact-match dedup missed it. Classifying one copy while its sibling(s) sit fully unenriched wastes a research pass and risks two independent, possibly-inconsistent classifications of the same org. Before finalizing a batch pick, grep the candidate pool for `entity_name` near-duplicates (case/accent/spacing-insensitive) and skip or flag any hit rather than researching it blind. **Do not try to merge these yourself mid-loop** — that's exactly what `/admin/duplicates` exists for; flag found duplicate clusters in the batch's CHANGELOG entry for a human to review/merge there.

1. **Pick a batch of 4 leads** (2 CogMap + 2 Seyu), prioritizing leads with the most missing signal (no `orgTypeCode`, active pipeline only — skip `WON`/`LOST`). This Python script (recreate it in scratch, it does not persist across sessions) does the picking:

```python
import os, random, urllib.request, json

API_BASE = 'https://salesleadgenerator.vercel.app'
API_KEY = os.environ['SLG_API_KEY']  # already set in this environment

def fetch_all(brand):
    leads = []
    page = 1
    while True:
        req = urllib.request.Request(f"{API_BASE}/api/leads?brand={brand}&page={page}&limit=1000", headers={'x-api-key': API_KEY})
        with urllib.request.urlopen(req) as r:
            data = json.load(r)
        leads.extend(data['leads'])
        if not data.get('hasMore'):  # NEVER use len(batch) < limit -- a middle page can legitimately be short with hasMore still true
            break
        page += 1
    return leads

def score(l):
    s = 0
    if not l.get('contacts'):
        s += 100
    elif all(not c.get('name') or 'unknown' in c.get('name','').lower() for c in l.get('contacts', [])):
        s += 60
    if not l.get('country'):
        s += 30
    if l.get('qualityStatus') == 'DRAFT':
        s += 10
    s += (l.get('ice', {}).get('impact', 0) or 0)
    return s

for brand in ['cogmap', 'seyu']:
    leads = fetch_all(brand)
    candidates = [l for l in leads if not l.get('orgTypeCode') and l.get('kanbanColumn') not in ('WON', 'LOST')]
    candidates.sort(key=score, reverse=True)
    picks = random.sample(candidates[:40], 2)  # top-40 pool, randomized within it, for variety without always picking the literal top score
    for p in picks:
        print(json.dumps(p, indent=2))
```

2. **Freeze the exact current production prompt** from `docs/LEAD_ENRICHMENT_GUIDE.md` §5's fenced ` ```markdown ` block to a scratch file before each batch (the guide changes as real prompt bugs get fixed — always use the current version, never a stale copy). **Verify the frozen file's tail contains `## Output format` and the closing fence** — a truncated snapshot happened once (2.4.126) when a fence-line-number shift wasn't accounted for after an edit; both affected agents recovered by inferring the format from context, but don't rely on that.

3. **Launch 4 parallel research agents** (Agent tool, `general-purpose`, `run_in_background: true`, all 4 in one message), each given: the frozen prompt text, the lead's full current JSON, brand context (CogMap = cognitive-assessment product; Seyu = fan-engagement/sponsor-activation product — never let one brand's terminology leak into the other's `value_proposition`), and instructions to do real web research and fetch `GET /api/lead-taxonomy` (no auth) for the live controlled vocabulary.

4. **Validate every returned payload before applying — do not trust it blindly.** Checklist, all confirmed real, recurring issues this loop has actually caught:
   - Valid taxonomy codes (real values from `lib/lead-taxonomy.ts` / the live `/api/lead-taxonomy` response).
   - `pro_for_organization`/`con_for_organization` must be JSON arrays of strings, never a plain string — `lib/validate-lead.ts`'s `PRO_FIELD`/`CON_FIELD` checks reject anything else; a real agent output returned these as plain strings once (caught before applying, 2.4.132).
   - **`country` should be set whenever it's trivially derivable from the lead's own `address` field** (e.g. an address ending "...Istanbul, Turkey" or "...Melbourne, Australia") even if the research pass didn't touch it directly — the enrichment prompt calls this out as a priority, low-risk fill-in (§2.2/§5 step 2). A real, caught gap: two applied leads (Fenerbahçe, Melbourne Victory, batch 2.4.131) had derivable countries left null and needed a follow-up `PUT` to fix, per owner QA. **This recurred a second time** (The Hundred, Montenegrin Football Association, batch 2.4.136) — both had a clearly derivable country in their stored `address` (`"...London, UK, United Kingdom"`, `"...Montenegro, ME"`) but the research agents left the top-level `country` field untouched even while filling in `cityName`. Caught and fixed with a follow-up `PUT` before checkpointing, same as before. Since this is now a 2nd-occurrence pattern rather than a one-off, treat it as an expected gap on every batch — explicitly check the top-level `country` field against the stored `address` for every lead before considering a batch validated, don't wait for it to be flagged again. **Batch 2.4.137 explicitly reminded each research agent about this gap in-prompt and it did not recur** — worth keeping that reminder in future batch prompts rather than relying on post-hoc validation alone.
   - HTML-entity artifacts (`&amp;` for `&`, etc.) sometimes appear in agent output text fields — strip these before applying, they should never be written literally to the database. **As of 2.4.146, this is now fixed at the root rather than only caught here**: `lib/text-sanitize.ts`'s `decodeHtmlEntities()` is wired into every write/read path (`app/lib/normalize-lead.ts`'s `sanitizeString()`, `lib/contacts.ts`'s `normalizeContact()`, and directly in `PUT /api/leads/[id]`'s route handler, which previously bypassed `normalizeLead()` entirely for `value_proposition`/`notes`/pro-con arrays). This was, empirically, the single most frequent real mistake this loop caught across every batch from 2.4.132 onward — still worth a quick visual scan per batch, but no longer solely dependent on catching it manually.
   - A non-integer `ice.impact`/`confidence`/`ease` (e.g. `5.5`) recurred independently on two unrelated leads (Estonian Basketball Association, batch pre-2.4.135; Slovak Football Association, batch 2.4.139) before `lib/validate-lead.ts` was tightened in 2.4.146 to reject (`Number.isInteger`, not just `Number.isFinite`) rather than silently accept a non-integer value — this class of bug can no longer reach storage at all, on any write path, not just this loop's own manual checks.
   - `isDecisionMaker` exact-spelling key (not `decision_maker`/`decisionMaker`).
   - Never `entity_name`/`url` written directly — corrections go in `notes` only.
   - Never server-computed fields (`classificationTags`, `mergeKey`, `seniorityTier`, `department`, `ticketSizeEstimate`, etc.).
   - `ice.impact`/`confidence`/`ease` are 1-10 integers **and internally consistent with the agent's own stated reasoning** — a real, caught case: an agent's notes said "tier 4" but the submitted `ease` was 3; caught and corrected before applying.
   - No `kanbanColumn` sent unless intentionally leaving `DISCOVERED`/`QUALIFIED` alone (sending `ice` on those two auto-reclassifies the card — expected, not a bug).
   - `name`/`title` fields contain **only** the clean confirmed value — no inline sourcing caveats or alternate-title notes (those belong in `role`/`notes`); this rule was added directly to the prompt (2.4.129) after a real violation.
   - **A contact's actual job title belongs in `title`, not `role`.** A real, caught case (Stampede Sports Arena, batch 2.4.138): the agent put a real job title ("Owner / General Manager") into `role` and omitted `title` entirely on all 3 contacts — `title` is what drives the server's auto-derived `seniorityTier`/`department`, so leaving it blank silently degrades that derivation even though the payload otherwise looked complete. Check every contact has a real `title`, not just a populated `role`.
   - **Confirm the agent's final message actually contains the JSON payload, not just a prose reference to it.** A real, caught case (River City Rangers, batch 2.4.138): the agent's completion message said "the final partial-update body...is provided above as the answer" but the JSON itself was not actually present in what came through — only a prose summary was. Had to resume the same agent and explicitly ask it to resend the JSON before it could be applied. Don't assume a described-but-missing payload will show up later; verify the fenced JSON block is literally present before treating a batch item as ready to apply.
   - **`businessUnitCode: "general"` vs `"first-team"`/`"youth-academy"`/etc.**: a lead representing one sport-specific unit of a multi-sport parent club must NOT default to `general` just because the parent is multi-sport — check the lead's own `sport_or_sector`/`value_proposition` scope. This exact mistake recurred twice (Beşiktaş, Persepolis) before being written into the prompt explicitly (2.4.129).
   - **`competitionLevelCode: "elite"` vs `"professional"`**: `elite` is reserved for top-tier domestic *youth* platforms (MLS NEXT, ECNL, Girls Academy); a senior/first-team squad in a top-flight professional league (Süper Lig, J1 League, Saudi Pro League, NFL, NBA, ...) is `professional`. This was a real, reproduced miscode before being fixed directly in the prompt (2.4.125).
   - For a lead where research genuinely finds no verifiable identity (multiple similarly-named orgs, no confirmable match): apply with `orgTypeCode: "unknown"` **explicitly set** (not omitted) plus honest `notes` — this marks the lead as processed so future batches don't re-pick it, while still respecting the rulebook's "never guess" rule.
   - Watch for `sportCode`/`sport_or_sector` mismatches surviving from the mechanical backfill (e.g. a US-context "Football" org mechanically coded as soccer's `football` instead of `american-football` — a real, confirmed, NOT-fully-scanned-for-recurrence bug, see CHANGELOG 2.4.128). Correct these when spotted; a full targeted scan for other instances has not been done.
   - Watch for genuinely out-of-taxonomy leads (Seyu's pipeline includes at least one non-sport entertainment property, "Tomorrowland" — a music festival). Use `sportCode: "not-applicable"` and flag the scope question in `notes`; don't force a sports-taxonomy fit and don't decide the underlying business-scope question yourself (see issue reference below).

5. **Apply via real `PUT /api/leads/{id}?brand={brand}`** with header `x-api-key: $SLG_API_KEY`, `Content-Type: application/json`, body = the validated (and if needed, corrected) payload.

6. **Independently re-fetch and verify every write** — a fresh `GET`, not trusting the agent's or the PUT response's self-report. Print the key fields (`orgTypeCode`, `businessUnitCode`, `genderCode`, `competitionLevelCode`, `cityName`, `mergeKey`, `qualityStatus`, `ice`, `contacts`) and eyeball them against what was intended.

7. **Every ~4 leads (one batch), ship a checkpoint**: write a CHANGELOG entry (what was found/fixed, not just what was written), bump `package.json` + every doc's `**Version:**` stamp by one patch version, run the full quality gate (`npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run test:integration`, `npm run test:smoke`, `npm run audit:gds-style`, `npx next build --webpack` — all clean, per CLAUDE.md Rule 1), commit, push to `claude/knowledge-update-44cuix` (standing authorization, no need to ask). **Never push to `main`** without a fresh, explicit "push to main" instruction for that specific work.

8. **Every ~20-30 leads, post a progress comment on GitHub issue #132** with the running total and any new findings/issues filed — issue #132 is the durable, cross-session source of truth for exact progress; read its comment history first when resuming, don't trust this document's own snapshot numbers as more current than the issue. **Use a real comment-adding call (`add_issue_comment` or equivalent), never `issue_write` with `method: update`** — the latter overwrites the issue's own body instead of appending, silently destroying the running log and leaving only the latest snapshot (this happened at least once before 2.4.131; caught via owner QA, not caught internally). `CHANGELOG.md` + git history remain the accurate record regardless of which method was used for any given past update.

### Open questions this loop has surfaced but explicitly not resolved (per CLAUDE.md Rule 5 — business-taxonomy structure needs owner judgment, not an agent's unilateral guess)

- **Issue #135**: no `orgTypeCode` value fits a platform/tech-brand lead (e.g. "Strava"). Needs an owner decision: extend the vocabulary, accept `unknown` as the permanent answer, or something else.
- **Issue #136**: a recurring "is this a tournament, league, or the federation/organiser that runs it" ambiguity for major global sports properties with no clean separate legal identity — 10 leads so far have landed on 4 different `orgTypeCode` answers (`tournament`, `federation`, `competition-organiser`, and `league` for The Hundred, batch 2.4.136 — reasoned as a round-robin/table-based domestic season rather than a single knockout event). The FIFA World Cup (batch 2.4.137), the IHF World Handball Championship (batch 2.4.145), and the FIVB Volleyball World Championship (batch 2.4.149) are the three newest data points, all reasoned to `tournament` (grouped with UEFA Champions League as quadrennial/biennial knockout-style mega-competitions rather than a recurring domestic-season `league`) — via genuinely defensible but inconsistent reasoning each time. Still not resolved; needs owner adjudication across all data points collected so far.
- **Issue #143** (filed 2026-07-31, batch 10): Seyu's pipeline includes non-sport entertainment properties — Tomorrowland (2.4.130) and now Glastonbury Festival (2.4.141) are both music festivals, not sports organizations. Filed per this section's own standing instruction once a second data point turned up. Both leads were classified with `sportCode: "not-applicable"` rather than forced into a sports fit; awaiting an owner decision on whether this class of lead belongs in Seyu's scope at all.
- **Not yet scanned**: the NFL `sportCode` miscode (2.4.128, `football` → `american-football`) was a real bug in the mechanical backfill's alias resolution for US-context sports terms. Only that one instance was fixed; no full database scan for similar miscodes (any other US "Football" org, or comparable ambiguous-alias sports) has been run.

---

See also: `docs/ARCHITECTURE.md`'s "Controlled Sports-Industry Taxonomy" section (the schema this plan backfills), `docs/LEAD_ENRICHMENT_GUIDE.md` (the classification/enrichment prompt this plan's execution reuses — §5's fenced block is the literal text to give each research agent), `docs/LESSONS_LEARNED.md` (the general pattern of dry-run-first validation this plan follows, and the real incidents — e.g. the 2.4.106→2.4.107 matching-criteria correction — that motivate it), `CHANGELOG.md` (2.4.107/2.4.108 entries, the most directly analogous prior large-scale data operation in this repo's history; 2.4.121 onward for this loop's own real-time history), GitHub issue #132 (the tracking issue with the fullest real-time progress history), issues #135/#136 (open taxonomy-vocabulary questions this loop surfaced but did not resolve).
