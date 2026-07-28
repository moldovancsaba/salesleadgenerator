# Lead Taxonomy Migration Plan — Rulebook v1.0 Backfill

**Version:** 2.4.117

**Status:** Plan / design document. This is **not** an execution log — no production lead has been touched by this plan. It describes how to convert the app's existing leads into the controlled taxonomy schema shipped in 2.4.109 (`lib/lead-taxonomy.ts`, `lib/lead-classification.ts`, the new `Lead` fields documented in `docs/ARCHITECTURE.md`'s "Controlled Sports-Industry Taxonomy" section).

---

## 1. Why this is a separate deliverable

The owner's request was two-part: "use this [rulebook] to improve the enrichment process and the data structure in general **and** make a plan to convert our existing data into the delivered new structure." The first half — the schema, validation, matching, and merge-engine changes — is additive and mechanical: it shipped in 2.4.109 without touching a single existing document. The second half — actually classifying **every existing lead** against the rulebook's controlled vocabularies (`sportCode`, `orgTypeCode`, `businessUnitCode`, `genderCode`, `demographicCodes`, `cityName`, `parentOrgName`, etc.) — is not mechanical. It requires the same kind of individual, evidence-based judgment call the enrichment agent itself makes for a single lead, applied at the scale of the entire database. That can't be safely batch-scripted (there is no reliable string transform from `"FC Bayern München - Youth Academy"` free text to `{sportCode: 'football', businessUnitCode: 'youth-academy', cityName: 'Munich'}`), and per CLAUDE.md Rule 2 it must be planned and tracked as its own scoped work, not silently folded into the schema delivery or attempted ad hoc in the same turn that built the schema.

## 2. Current state (gap analysis)

As of this writing:

| Brand | Collection | Total leads | Leads with any new taxonomy field set |
|---|---|---|---|
| CogMap | `leads` | 2,189 | 0 |
| Seyu | `seyu_leads` | 536 | 0 |
| **Total** | | **2,725** | **0** |

Every existing lead has `sport_or_sector` (free text, inconsistent — see the "Soccer"/"Football"/"Football (Soccer)" fragmentation documented in `docs/ARCHITECTURE.md`'s Near-Duplicate section) and `industry` (free text), but none of the controlled `*Code` fields, `cityName`, `parentOrgName`, `classificationTags`, or `mergeKey`. `country` (ISO alpha-2) is already populated for leads created after 2.4.98 and remains permanently blank for a real, counted set of leads created before it (see `docs/LESSONS_LEARNED.md`) — those pre-2.4.98 leads are lower-confidence candidates for `#country:` tag generation until `country` itself is separately backfilled or re-researched.

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

### Phase 2 — Sample-validated batch classification (proposed, not started)
The actual backfill, run in the same **dry-run → small sample → full batch** shape already proven twice in this session (the CSV-import path and the full-database duplicate-search path), because both times a step directly to "run it on everything" would have been the wrong call — the duplicate-search work specifically caught a real matching-criteria bug (§18 in `CHANGELOG.md`'s 2.4.107 entry) only because a real diagnostic run against production-scale data surfaced it before any destructive action was taken.

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

---

See also: `docs/ARCHITECTURE.md`'s "Controlled Sports-Industry Taxonomy" section (the schema this plan backfills), `docs/LEAD_ENRICHMENT_GUIDE.md` (the classification/enrichment prompt this plan's execution reuses), `docs/LESSONS_LEARNED.md` (the general pattern of dry-run-first validation this plan follows, and the real incidents — e.g. the 2.4.106→2.4.107 matching-criteria correction — that motivate it), `CHANGELOG.md` (2.4.107/2.4.108 entries, the most directly analogous prior large-scale data operation in this repo's history).
