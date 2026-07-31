# Lead Enrichment Guide — AI Research Agent

**Version:** 2.4.144

This is the deliverable for an ongoing "enrich lead quality over time with AI research" process: a structured catalog of every field on a Lead that can legitimately be enriched, and a ready-to-use prompt for the AI agent that does the enriching. It's written to slot into this app's existing infrastructure, not to propose new infrastructure — this repo already has a dedicated **enrichment** prompt type (distinct from **discovery**, which finds new leads), editable at `/admin/prompts/[brand]` and stored per `{brand, tenantId}` in the `prompts` collection (`app/api/prompts/route.ts`). Everything below is designed to be pasted directly into that slot.

The runtime that actually calls the AI model and posts results (the OpenClaw/KiloClaw research agent) lives in a separate app, not this repo (see `app/lib/sales-settings.ts`'s own header comment and issue #99) — this guide covers the two things that *are* this repo's responsibility: which fields are safe and useful to enrich, and the exact API contract the agent must write through.

---

## 1. How enrichment differs from discovery

Discovery finds a lead that doesn't exist yet and creates it (`POST /api/leads`, gated by the creation-time quality gate described in `docs/LESSONS_LEARNED.md` §2 — it exists to stop low-signal, contact-less leads from being created, not to gate updates). Enrichment revisits a lead that **already exists** and improves specific fields on it over time — a contact who was unverifiable last quarter now has a working email, a company's size tier becomes clearer after a funding announcement, a homepage redesign changes its detectable tech stack. Enrichment never creates a new lead and is not subject to the creation-time gate.

The right write path for enrichment is **`PUT /api/leads/[id]`** — confirmed by reading `app/api/leads/[id]/route.ts` itself, whose own code comments describe it as "the agent enrichment path" in two places. It is the one lead-mutating endpoint that is `x-api-key`-only (no session option — see `docs/LESSONS_LEARNED.md` §6), matching an unattended agent that has no browser session to hold. It's also a **partial update**: send only the fields you're changing, never the whole lead.

---

## 2. The enrichable field catalog

Every field below is grouped by how confidently and how often it's worth re-researching, and by what actually happens to it server-side when the agent writes it. This is the structured format the request asked for — treat it as the source of truth for which fields belong in an enrichment payload, and how.

### 2.1 Contacts — the highest-value, fastest-decaying data

| Field (inside `contacts[]`) | Format | Re-check cadence | Notes |
|---|---|---|---|
| `name` | string | On discovery of a new/changed contact | Any casing is fine — the server title-cases it automatically. |
| `title` | string | Same as `name` | Drives auto-derived `seniorityTier`/`department` server-side — don't set those yourself, they're recomputed from `title` on every write. |
| `email` | string | **Every ~180 days**, or immediately if bounced/changed | Format-validated server-side; a changed email auto-triggers a background MX-deliverability re-check (`emailVerificationStatus`) — don't set that field yourself, it's server-computed. |
| `phone` | string, E.164-ish (`+`-prefixed) | Same as email | Non-`+`-prefixed 10-digit numbers are assumed US and auto-formatted; prefer sending a `+`-prefixed number for anywhere else. |
| `linkedin` | full profile URL | Same as email | Used only as a verifiable-field signal, not fetched/parsed. |
| `role` | string | Same as email | Free text, e.g. "Primary buyer", "Technical evaluator". |
| `isDecisionMaker` | boolean | Whenever your research changes this judgment | Multiple contacts may carry this flag (co-decision-makers). |

**Send the whole `contacts[]` array, not a delta.** `PUT` replaces it entirely (deduped by name+phone, falling back to name+email, falling back to bare name — see `lib/contacts.ts`'s `contactKey()`). Every contact you include in a `PUT` payload gets `lastVerifiedAt` stamped to *now*, unconditionally — this is exactly what separates "I re-confirmed this contact" from "I'm just passing through data I didn't touch." **Concretely: if you didn't personally re-verify a contact this run, don't include it in the payload's `contacts[]` at all — omit it, don't resend it unchanged**, or you'll falsely mark stale data as fresh. (This is a real, previously-undocumented gotcha — see `docs/LESSONS_LEARNED.md` for the general pattern of write-path assumptions not being written down anywhere until an audit surfaces them.)

**Use this exact shape for each contact object — field names are case-sensitive and there is no fuzzy matching:**

```json
{
  "name": "Jane Doe",
  "title": "VP Marketing",
  "email": "jane@example.com",
  "phone": "+1-555-0100",
  "linkedin": "https://www.linkedin.com/in/janedoe",
  "role": "Primary buyer",
  "isDecisionMaker": true
}
```

`isDecisionMaker` (this exact camelCase spelling) is the only key the server reads for the decision-maker flag — `decision_maker`, `decisionMaker`, `is_decision_maker`, or any other variant is silently ignored (the server only ever reads the literal key `isDecisionMaker`), so a contact sent under a wrong key name defaults to `false` with no error and no warning. **This is a real failure mode, not a hypothetical one**: in a live test of this prompt against 5 real leads (2026-07-28), 3 of 5 test runs independently invented a plausible-but-wrong key name (`decision_maker` twice, `decisionMaker` once) for exactly this field, because earlier revisions of this guide only described the field in prose. Omit any field you don't have a value for rather than guessing its name — every other field in the object above (`name` through `role`) follows the same exact-key-name rule.

**Staleness signal to query against**: `lib/contact-freshness.ts`'s `isContactStale()` — a contact with no `lastVerifiedAt`, or one older than `CONTACT_STALENESS_THRESHOLD_DAYS` (180 by default), is stale. Prioritize leads with stale contacts, especially ones still active in the pipeline (not `WON`/`LOST`).

### 2.2 Firmographic / identity fields — low-frequency, high-caution

| Field | Format | Re-check cadence | Notes |
|---|---|---|---|
| `entity_name` | string | **Never write — flag in `notes` only** | Changing this on an existing lead is an identity correction, not routine enrichment. **Do not include `entity_name` in your output payload even if you're confident you found the correct value** — describe what you found and your evidence in `notes` instead, for a human to review and apply deliberately (see §5's Hard Rules — a real, previously-inconsistent behavior across live test runs, tightened 2026-07-28). |
| `url` | `https://...` | **Never write — flag in `notes` only** | Same rule as `entity_name`, and the single most common trigger for it in practice: a real 2026-07-28 batch of CSV-imported leads left many with `url` set to a leftover Google-search-query string (`https://www.google.com/search?q=...`) instead of the organization's real site. Finding the real site is valuable research — write it into `notes`, never into `url` directly. |
| `address` | string | Occasionally | Country name is auto-appended if missing and no ZIP-like pattern is detected. |
| `general_contact` | string | Occasionally | Fallback contact info when no named contact exists yet. |
| `size` | one of `Small`/`Medium`/`Large`/`Enterprise` (exact enum, case-sensitive) | Whenever new evidence changes the tier | Anything else is rejected by validation — don't send free text like "mid-size" or a headcount number here. |
| `industry` | string | Occasionally | |
| `sport_or_sector` | string | Occasionally | |
| `level_league` | string | Occasionally | e.g. "Professional", "Youth", "Semi-pro" — whatever's relevant to the sport. |
| `region` | `US`/`CEE`/`MENA` (currently observed values; `region` has no server-side enum, so this is a convention, not an enforced set) | Rarely | Feeds `regionMultipliers` in the brand's Sales Settings for ticket-size estimation — get this right, it has downstream financial impact. |
| `country` | 2-letter ISO 3166-1 alpha-2 | Once, if missing | **Every lead created before 2.4.98 has a permanently blank `country`** (see `docs/LESSONS_LEARNED.md` §6) — filling this in for an existing lead that's missing it is a genuinely valuable, safe enrichment target with no downside. |

### 2.3 Qualitative / narrative fields

| Field | Format | Notes |
|---|---|---|
| `value_proposition` | string | **Checked against a forbidden-terms list per brand** (`lib/validate-lead.ts`'s `FORBIDDEN_BRAND_TERMS`) — a CogMap lead's value proposition must never mention Seyu-specific terms (fan selfies, LED screens, sponsor activation, etc.) and vice versa. A payload that trips this is rejected outright; know which brand you're writing for before generating this text. |
| `notes` | string | Free-form research notes. Append, don't replace, unless you're correcting something wrong — this field has no structured merge behavior, a `PUT` overwrites it entirely. |
| `tags` | `string[]` | Short freeform labels, filterable in the UI. |
| `product_fit_notes` | string | Specifically for *why this lead fits the product*, distinct from the general `notes` field. |

### 2.4 Forecast / deal-size input signals — the ticket-size engine's raw material

These feed `ticketSizeEstimate` (the number an operator actually reads), which is **computed server-side on every `PUT`** from whatever's in these fields plus the brand's Sales Settings — you don't compute or set `ticketSizeEstimate` yourself, ever.

| Field | Brand | Format | Notes |
|---|---|---|---|
| `estimated_participants` | CogMap | number | Feeds the per-unit pricing model. |
| `estimated_annual_revenue_usd` | CogMap | number | Legacy direct-value field — still accepted as a fallback signal, but the computed `ticketSizeEstimate` is authoritative for display; don't expect this number to be what an operator sees. |
| `recommended_tier` | CogMap | `essential`/`performance`/`elite`/`multiple` | |
| `revenue_model` | CogMap | `per_participant`/`revenue_share`/`hybrid` | |
| `pricingByCompany` | Seyu | object: `{currency, upfront_eur, monthly_eur, annual_fee_eur, discount_percent, revenue_share_percent, pricing_model, notes}` | Seyu's forecast is built entirely from this field, not from a computed `ticketSizeEstimate` the way CogMap's is. |

**Exception that must be respected**: if the lead's `ticketSizeEstimate.method === 'manual_override'`, a rep has personally overridden the modeled estimate with direct deal knowledge, and the server automatically skips recomputation on every write. Nothing you do to the fields above will visibly change the estimate for that lead, by design — this isn't a bug to work around.

### 2.5 Scoring fields — write with care, they have side effects

| Field | Format | Notes |
|---|---|---|
| `ice.impact` | 1–10 | Your assessment of deal impact if won. |
| `ice.confidence` | 1–10 | Your assessment of how confident the research is. |
| `ice.ease` | 1–10 | **Unlike lead creation, `PUT` does not recompute this for you — you must set it yourself.** Use the same rubric `computeEase()` (`app/api/leads/route.ts`) applies at creation: roughly, 1 = no named contact at all, 2 = only a general contact, 3 = named contact but no email/phone, 4 = named contact plus the lead's own `address` field, but no email/phone, 5–6 = named contact plus email or phone, 7 = named contact, `address`, email, *and* phone all present. **"Address" here means the lead's top-level `address` field is actually set in this payload (or was already stored) — not that an address merely appears somewhere in your research notes.** Sending a `ice.ease` that doesn't reflect actual contact completeness will desynchronize the score from reality; a live test (2026-07-28) caught one run scoring ease=4 on the strength of an address mentioned only in `notes`, with the structured `address` field left unset — that should have scored 3. |
| `qualityStatus` | `DRAFT`/`CHECKED`/`VERIFIED` | Promote this as your confidence in the lead's overall data quality increases through successive enrichment passes — this is exactly what the field exists for. |

**Side effect to know about**: if you send `ice` without also sending `kanbanColumn`, and the lead is currently in `DISCOVERED` or `QUALIFIED` (the two auto-managed columns), the server **automatically recomputes and moves the card** based on the new ICE score. This is intentional and correct — enriching a lead's contact completeness is exactly the kind of update that should be able to promote it from DISCOVERED to QUALIFIED. Do **not** send `kanbanColumn` yourself for one of these two columns; let the auto-classification do its job. If the lead has already been moved to `ENGAGED`/`PROPOSAL`/`WON`/`LOST` (by a human action), it's permanently opted out of auto-classification and a `PUT` with `ice` alone won't move it — that's also correct, leave it alone.

### 2.6 Controlled sports-industry taxonomy — rulebook v1.0 (2026-07-28)

These fields are new, additive, and entirely optional — a lead written before this version has none of them set, and that's fine; nothing in this app requires them. They exist to classify a lead's true commercial identity (sport, organisation type, business unit, geography) using a **controlled vocabulary** instead of free text, per the owner-supplied "Sport Sales Lead Catalogue and Deduplication Rulebook v1.0." The full vocabulary lists live in code, not duplicated here — `lib/lead-taxonomy.ts` is the single source of truth; `PUT` rejects any value not in the matching list. `GET /api/lead-taxonomy` (§3.2) serves that same source as JSON, no auth required — the way to get the current list at run time without repo access.

| Field | Format | Notes |
|---|---|---|
| `sportCode` | one of `SPORT_CODES` (`lib/lead-taxonomy.ts`) | The lead's **single** sport — a rulebook non-negotiable (§3.1): if an organisation genuinely runs two sports as separately manageable units, that is two leads, never one lead with two sports. Use `'multi-sport'` only when the buying unit itself is genuinely sport-agnostic (e.g. a multi-sport facility operator), not as a shortcut for "didn't research this." Use `'unknown'` rather than guessing. |
| `orgTypeCode` | one of `ORG_TYPE_CODES` | What kind of organisation this is (club, federation, academy, venue, agency, etc.) — orthogonal to sport. |
| `businessUnitCode` | one of `BUSINESS_UNIT_CODES` | Which internal unit this lead represents when a parent organisation has more than one (first-team vs. youth-academy vs. commercial, etc.) — a rulebook non-negotiable (§3.2): one business unit per lead. |
| `genderCode` | one of `GENDER_CODES` | `men`/`women`/`mixed`/`unknown`/`not-applicable` — identity-critical per the rulebook (§3.5) when the organisation itself splits by gender (e.g. a club's separate women's team is a separate lead, not a footnote on the men's team's record). |
| `demographicCodes` | `string[]`, each one of `DEMOGRAPHIC_CODES` | Non-exclusive — a youth academy that also runs adult classes can legitimately carry both `youth` and `adult`. |
| `competitionLevelCode` | one of `COMPETITION_LEVEL_CODES` | Recreational through international/elite. |
| `cityName` | string, free text (source spelling) | The rulebook's "source name must always be preserved" rule (§3.7/§13) — this is the human-readable city as found, e.g. `"München"`. Never write a slug here yourself; the server derives the `#city:` tag slug automatically. |
| `parentOrgId` | string (a Lead `_id` or external identifier) | Links a business-unit lead to its parent organisation record, when one exists as a lead. This app does not yet have a dedicated Parent Organisation object (see `docs/LEAD_TAXONOMY_MIGRATION_PLAN.md`'s Phase 2/3 notes) — treat this as best-effort until that lands. |
| `parentOrgName` | string, free text (source spelling) | The parent's name, kept even when `parentOrgId` is unknown — per the same "never discard a source name" rule as `cityName`. |
| `relationshipToParent` | one of `RELATIONSHIP_CODES` | How this lead relates to its parent (`owned`/`operated`/`licensed`/`franchise`/`affiliate`/`partner`/`unverified`) — use `unverified` rather than guessing. |
| `canonicalLeadName` | string | The rulebook's normalized display name (§13.2), kept separate from `entity_name` (this app's pre-existing, source-preserved name field). Only set this when you have a genuinely better canonical form to offer — omit it otherwise, don't just copy `entity_name` into it. |

**Never write `classificationTags` or `mergeKey` yourself.** Both are always recomputed server-side from the fields above on every write that touches any of them (`lib/lead-classification.ts`'s `generateClassificationTags()`/`buildMergeKey()`) — the exact same "derived, not client-supplied" pattern this app already uses for `fingerprint`/`scoreProfile`/`ticketSizeEstimate`. Anything you send in either field is silently ignored.

**Use explicit `'unknown'` (or the field's own `not-applicable`, where offered), never omit a taxonomy field you attempted but couldn't resolve, and never guess a plausible-sounding value.** This is the rulebook's single most-repeated rule (§3.6, §15.2, §21, §34): an incorrect guess is far more damaging than an honest "unknown," because it produces false-confidence duplicate matches and wrong classification tags that are hard to notice and undo later. It's fine to omit the field entirely from your `PUT` payload if you have no evidence at all and no example yet.

### 2.7 Fields the enrichment agent should never write

| Field(s) | Why not |
|---|---|
| `techSignals`, `techSignalsScannedAt`, `techSignalsScanStatus` | Server-computed only, by an SSRF-guarded homepage scan. To refresh these, trigger the `RESCAN_TECH` action (§3.3) — don't attempt to set the values directly, they'll be silently overwritten by the next real scan anyway. |
| `emailVerificationStatus` | Server-computed asynchronously after any write that changes an email. Setting it yourself has no effect — it'll be overwritten. |
| `ticketSizeEstimate` | Server-computed from §2.4's raw signals on every `PUT` (unless `manual_override` is active — see above). |
| `seniorityTier`, `department` (per-contact) | Rule-derived from `title` on every write. Setting them has no effect. |
| `classificationTags`, `mergeKey` | Server-computed from §2.6's structured fields on every write (see §2.6) — never accepted as raw input. |
| `deals[]`, `checklist[]`, `qualification`, `nextActionDueAt`/`nextActionNote` | These are rep-owned CRM fields — nothing in this codebase auto-populates them, by design (`docs/ARCHITECTURE.md`'s Deal CRUD section: "nothing in this codebase ever creates, edits, or removes [a deal] automatically"). An enrichment agent writing to these would be a new, undocumented behavior change, not routine enrichment. |
| `kanbanColumn`, `sortOrder`, `status` | Pipeline/workflow state, owned by the rep (drag-and-drop, Accept/Decline/Pin) or by auto-classification (§2.5) — not a research-agent concern. |
| `actualDealValueUsd` | The real, closed contract value — only meaningful once `WON`, captured by a human, not researched. |

---

## 3. API contract

### 3.1 Enrich a lead's fields

```
PUT /api/leads/{leadId}?brand={cogmap|seyu}
Headers: x-api-key: <SLG_API_KEY>
Content-Type: application/json

Body: only the fields being changed, e.g.
{
  "contacts": [
    { "name": "Jane Doe", "title": "VP Marketing", "email": "jane@example.com", "isDecisionMaker": true }
  ],
  "ice": { "impact": 7, "confidence": 6, "ease": 6 },
  "estimated_participants": 450,
  "country": "US",
  "sportCode": "football",
  "orgTypeCode": "club",
  "businessUnitCode": "youth-academy",
  "genderCode": "mixed",
  "cityName": "Munich"
}
```

A 400 response means validation failed — read `details` in the response body, it lists every specific rule broken (format, forbidden brand term, wrong enum value). Do not retry with the same payload; fix the specific field(s) named in the error.

### 3.2 Get the current controlled taxonomy vocabularies

```
GET /api/lead-taxonomy
```

No auth required, no params, no request body. Returns the exact same arrays `lib/lead-taxonomy.ts` exports — the live, always-current source of truth §2.6's `sportCode`/`orgTypeCode`/`businessUnitCode`/`genderCode`/`demographicCodes`/`competitionLevelCode`/`relationshipToParent` values are validated against:

```json
{
  "sportCodes": ["football", "basketball", "..."],
  "orgTypeCodes": ["club", "academy", "..."],
  "businessUnitCodes": ["first-team", "women", "..."],
  "genderCodes": ["men", "women", "mixed", "unknown", "not-applicable"],
  "demographicCodes": ["children", "youth", "..."],
  "competitionLevelCodes": ["recreational", "grassroots", "..."],
  "relationshipCodes": ["owned", "operated", "..."],
  "sportAliases": { "soccer": "football", "ice hockey": "ice-hockey", "...": "..." }
}
```

**Call this before classifying, on every run, if your runtime can make an HTTP GET request** — it's cheap (static data, no DB read) and it's the one value that can never be stale, unlike §5's inlined reference lists below, which are a text copy that could theoretically lag behind this endpoint if the underlying vocabulary is ever extended (an automated test in this repo — `tests/lib/lead-taxonomy-doc-sync.test.ts` — fails the build if that ever happens, but this endpoint is the authoritative source regardless of whether that test has run recently). If your runtime genuinely cannot make an out-of-band HTTP call, fall back to §5's inlined lists.

### 3.3 Refresh a lead's detected tech stack

```
PATCH /api/leads?brand={cogmap|seyu}&id={leadId}
Headers: x-api-key: <SLG_API_KEY>
Content-Type: application/json

Body: { "action": "RESCAN_TECH" }
```

Scans the lead's own already-stored `url` (never a URL you supply) — this is not a general-purpose fetch endpoint. Returns immediately with the scan result (5-second ceiling, never throws).

### 3.4 Which leads to enrich, and in what order

There's no dedicated "list stale leads" endpoint today — build the priority queue from `GET /api/leads?brand=<brand>` (or `GET /api/leads/columns` for a specific kanban column) and rank by, in order:
1. **Active pipeline leads only** — skip `WON`/`LOST` (terminal, no further enrichment value) and generally skip `BACKLOG` (deliberately deprioritized by a rep) unless specifically asked to also sweep it.
2. **Stale or missing contacts** — any contact with no `lastVerifiedAt`, or older than the 180-day threshold (`lib/contact-freshness.ts`). A lead with **zero** contacts at all is the highest-value target: it can never clear the creation-time quality gate's bar and is likely sitting in DISCOVERED purely on a low default score.
3. **Missing `country`** — a real, permanent gap for any lead created before 2.4.98; free, safe, high-value fix.
4. **`qualityStatus: 'DRAFT'`** leads with no contact-completeness gate ever run against them — the most under-researched tier.
5. **Higher current ICE score first** within any tier above — enriching a lead already showing promise returns value sooner than enriching one that's unlikely to ever qualify.

---

## 4. Guardrails — read before writing anything

These aren't optional style preferences; they're either enforced by the API (you'll get a 400) or they're the specific, previously-real ways this system has gone wrong (see `docs/LESSONS_LEARNED.md` for the full incident history):

- **Never fabricate a contact, email, or phone number.** An absent or unconfirmed value should be omitted, not guessed. This app has a "never fabricate" convention (CLAUDE.md Rule 7) that extends to every field you touch — a wrong confident-looking number is worse than an honest gap.
- **Only include a contact in `contacts[]` if you actually re-confirmed it this run.** Every contact sent gets `lastVerifiedAt` stamped to now, unconditionally (§2.1). Silently re-sending old, unverified data marks it as fresh and defeats the entire staleness-tracking system.
- **Never write brand-crossed terminology into `value_proposition`.** Know which brand (`cogmap` or `seyu`) you're enriching before generating this text — see §2.3's forbidden-terms list.
- **Respect `manual_override`.** If `ticketSizeEstimate.method === 'manual_override'`, don't try to work around it by writing `estimated_annual_revenue_usd` or similar expecting it to change the displayed estimate — it won't, and that's correct behavior, not a bug.
- **`size` is a strict 4-value enum.** Sending anything else (a headcount, a description) fails validation. If you're not confident which of the four tiers applies, leave `size` out of the payload entirely rather than guessing.
- **Don't set any of the server-computed fields listed in §2.7.** They'll be silently overwritten regardless, so writing them just adds noise to your payload.
- **Never guess a taxonomy code.** `sportCode`/`orgTypeCode`/`businessUnitCode`/`genderCode`/`demographicCodes`/`competitionLevelCode`/`relationshipToParent` must be a real value from `lib/lead-taxonomy.ts`'s controlled lists (fetch `GET /api/lead-taxonomy`, §3.2, for the live list) or the request is rejected outright (§2.6) — use `'unknown'` (or `'not-applicable'` where offered) rather than inventing a plausible-sounding value or a close-but-wrong spelling.
- **A rejected request isn't a system worth retrying blindly.** Read the actual `details` array in a 400 response and fix the named field(s) — this mirrors this repo's own standing rule to verify real output rather than assume a plausible-looking payload will work.

---

## 5. The enrichment prompt

Paste this into the **enrichment** slot in `/admin/prompts/[brand]` (`type=enrichment`). It's written to be brand-agnostic — the agent's own runtime substitutes brand-specific context (Sales Settings, forbidden-terms list, etc.) before each run, the same way the existing discovery prompt presumably does.

```markdown
# Lead Enrichment Agent

You are researching an EXISTING lead to improve its data quality — you are
not discovering new leads. Your job each run is to research one lead at a
time from a provided worklist and return a single, valid partial-update
payload for `PUT /api/leads/{leadId}?brand={brand}`.

## Inputs you will be given for each lead
- The lead's current stored data (all fields as currently in the database).
- The brand's Sales Settings context (what this brand sells, who buys it,
  typical deal sizes, region multipliers) — use this to judge plausibility
  of size/tier/pricing signals, not to write sales copy.
- Which specific fields triggered this lead being selected for enrichment
  (e.g. "contacts stale", "missing country", "quality status DRAFT").

## What to research and return
Focus your research effort on whichever of these gaps this lead actually
has — do not attempt to fill in fields that are already fresh and correct:

1. **Contacts.** Find or re-confirm: name, title, a real work email, phone,
   LinkedIn profile, and whether they're a genuine decision-maker for a
   purchase like this one. Only include a contact in your output if you
   actually found/re-confirmed it this pass — never carry forward an old,
   unconfirmed contact just to keep the array populated. Use this exact
   object shape — field names are case-sensitive, there is no fuzzy
   matching, and `isDecisionMaker` (this exact spelling) is the only key
   name the server reads for that flag:
   ```json
   {
     "name": "Jane Doe",
     "title": "VP Marketing",
     "email": "jane@example.com",
     "phone": "+1-555-0100",
     "linkedin": "https://www.linkedin.com/in/janedoe",
     "role": "Primary buyer",
     "isDecisionMaker": true
   }
   ```
   Omit any key you don't have a confirmed value for — never invent a
   variant spelling (`decision_maker`, `decisionMaker`, etc.); it will be
   silently ignored server-side, not an error.

   **`name` and `title` must contain ONLY the clean, confirmed value —
   never append a sourcing caveat, confidence qualifier, or alternate
   spelling inline** (e.g. `"name": "Jane Doe (site lists as \"J. Doe\")"`
   or `"title": "GM (also seen as Interim GM elsewhere)"` are both wrong).
   `title` in particular drives the server's auto-derived
   `seniorityTier`/`department` on every write — polluting it with
   parenthetical text degrades that derivation, not just the display. Put
   every caveat, alternate title, or source-disagreement note in `role`
   or `notes` instead, where it belongs and does no harm.

   **A stored contact whose `name` is a generic placeholder (e.g. "Acme
   Corp Contact", the org name plus the literal word "Contact") is not a
   real, named individual, even if its `email` is a genuine, MX-verified
   inbox.** Treat it the same as "no contact found" for research purposes
   — replace it with a real named person if you find one this pass (the
   verified org-level inbox, if still current, belongs in `general_contact`
   instead — see §2.2/§4), or leave it as the sole entry if you can't. A
   contact with an actual person's name, even one you're only partially
   re-verifying, is the "old, unconfirmed contact" the rule above means —
   don't drop a real name just because you couldn't reach them this pass.

   **How the `contacts` key itself behaves — read before deciding what to
   send.** Omitting the `contacts` key entirely leaves the lead's stored
   contacts completely untouched. Including it REPLACES the stored array
   wholesale AND marks every contact you send as verified-right-now. So:
   - Found/re-verified nothing this run → omit the `contacts` key.
   - Lead has no stored contacts (or only obvious junk/placeholder rows)
     and you found real ones → send just your verified finds; junk rows
     being replaced is correct, and say so in `notes`.
   - Lead HAS real stored contacts you did not re-verify, and you found a
     new one → re-verify the stored ones as part of this same pass (they
     are usually quick to re-check at the same sources) and send the full
     combined array. If a stored contact can no longer be confirmed
     (person left, role gone), drop it from the array and record why in
     `notes`. Never send a partial array that silently deletes stored
     contacts you simply didn't get to — and never resend a stored
     contact unchanged without actually re-checking it, since sending it
     is itself the claim "I verified this person just now."
2. **Missing `country`.** If blank, determine the lead's actual country
   (2-letter ISO code) from public sources (official site, registry,
   address) — this is a safe, high-value, low-risk fill-in.
3. **Firmographic signals** relevant to deal sizing: organization size tier
   (Small/Medium/Large/Enterprise — pick the closest real match, or omit
   the field if genuinely unclear), estimated participant/user count,
   industry, sport/sector, and (CogMap only) revenue model / recommended
   tier, or (Seyu only) pricing signals if publicly discoverable.
4. **Value proposition and notes.** Only update `value_proposition` if you
   have a materially better, more specific articulation of why this brand's
   product fits this lead than what's currently stored — don't rewrite
   working text for its own sake. Append meaningful new findings to
   `notes`; don't delete existing notes unless they're factually wrong.
5. **Re-score.** After your research, set `ice.impact` and `ice.confidence`
   to reflect your updated assessment, and set `ice.ease` yourself using
   this rubric (the server does NOT recompute this on update). Each of
   `ice.impact`/`ice.confidence`/`ice.ease` must be an integer from 1 to
   10; never send an `iceScore` field (the server validates it against
   impact×confidence×ease and rejects a mismatch — just omit it):
   - 1 = no named contact found at all
   - 2 = only a general/company-level contact found
   - 3 = a named contact, but no email or phone
   - 4 = named contact + the lead's own `address` field actually set in
     this payload (or already stored) — not merely mentioned in `notes` —
     but no email or phone
   - 5–6 = named contact + (email or phone), `address` optional
   - 7 = named contact + `address` + email + phone, all present
   "(email or phone)" in the 5–7 tiers means the NAMED contact's own
   direct channel, carried in that contact's `email`/`phone` fields — a
   company-level inbox (`info@...`, stored in `general_contact`) counts
   only toward tier 2, never toward 5–7. A switchboard number with a
   PUBLISHED person-specific extension counts as that contact's phone
   for this rubric; a bare switchboard number with no personal extension
   does not. `general_contact` itself IS a writable field in your
   payload: free text for the org-level channel (e.g.
   "info@example.com / +1-555-0100") — when you confirm a company inbox
   or switchboard number, write it there, not only into `notes`.

   **`phone` and extension notation.** A real corruption happened here on
   2026-07-28 ("+1-804-823-9191 ext. 5" silently stored as the wrong
   "+180482391915") and is now fixed server-side (issue #133,
   `lib/contacts.ts`'s `normalizePhone()`): a recognized extension marker
   (`ext`/`ext.`/`extension`/`x`/`#`/a comma-pause, in any common spacing)
   is now truncated off before the number is normalized, so it can no
   longer fuse into the subscriber number. Still write ONLY the plain
   dialable number in `phone` and keep the extension in the contact's
   `role` text or in `notes` — the server drops the extension entirely
   rather than storing it, so it's lost from `phone` either way; keeping
   it in `role`/`notes` is the only way it survives at all.
6. **Promote `qualityStatus`** from DRAFT toward CHECKED or VERIFIED as your
   confidence in the lead's overall data quality genuinely increases through
   this research pass — don't promote it reflexively just because you ran.
7. **Classify the lead against the controlled sports-industry taxonomy**
   (rulebook v1.0, §21/§31) — this is what lets duplicate detection and
   reporting work on structured facts instead of free text.

   **Before classifying, if you can make an HTTP GET request: fetch
   `GET /api/lead-taxonomy` (no auth, no params) and use ITS values as
   authoritative** — it's always current, unlike the reference lists
   below, which are a static copy that could in principle lag behind it.
   If you cannot make an out-of-band HTTP call, use the reference lists
   below instead.

   For each of the fields below, either write a real value from its
   controlled list, write the literal string `"unknown"` (or
   `"not-applicable"` where that's an offered value), or omit the field
   entirely if you have no evidence at all — **never invent a
   plausible-sounding code that isn't in the list you were given**, and
   never guess when evidence conflicts:
   - `sportCode` — the lead's single sport. If the organisation genuinely
     runs more than one sport as separately manageable units, say so in
     `notes` and flag it for human review rather than picking one; don't
     silently collapse two real leads into one sport code.
   - `orgTypeCode`, `businessUnitCode`, `genderCode`, `demographicCodes`,
     `competitionLevelCode` — as directly evidenced by your research.
     Two disambiguation rules, both from real runs hitting the ambiguity:
     - `businessUnitCode`: when the lead represents the WHOLE organisation
       (not one internal unit of a parent), use `general` — the specific
       unit codes (`youth-academy`, `first-team`, `commercial`, ...) are
       reserved for leads that represent an actual sub-unit. Describe
       what the whole org spans in `notes` instead of encoding it here.
       **A specific, recurring case**: a multi-sport club (fields
       football plus basketball, volleyball, etc. as separate sections)
       whose lead's own stored `sport_or_sector` is football-specific —
       that lead represents the football section, i.e. `first-team`
       (or `youth-academy` if it's specifically the academy), NOT
       `general`. `general` is for a lead that genuinely represents the
       whole multi-sport entity across all its sections, which is a
       different (rarer) case. This exact mistake — defaulting to
       `general` for a sport-specific lead just because the parent club
       is multi-sport — has recurred more than once; check the lead's
       own `sport_or_sector`/`value_proposition` scope before picking.
     - `competitionLevelCode`: when one organisation verifiably spans
       multiple levels (recreational through elite is common for large
       clubs), set the HIGHEST level it genuinely competes at and record
       the full span in `notes` — don't pick a middle value or `unknown`
       when the top of the pyramid is evidenced. `national`/
       `international` are for genuinely national-team/international
       representative competition (a country's senior/youth national
       team, continental club competitions) — a club or academy in a
       top domestic YOUTH platform (MLS NEXT, Girls Academy, ECNL, or
       an equivalent country's own top domestic YOUTH league) is
       `elite`, even though that platform itself is nationally
       organized. The distinction is WHO is competing (a club/academy
       vs. a representative national side), not how the competition is
       scoped geographically. **A club's SENIOR/first-team squad
       competing in its country's top-flight professional league
       (Süper Lig, J1 League, Saudi Pro League, Premier League, and
       equivalents) is `professional`, not `elite`** — `elite` in this
       vocabulary is specifically reserved for top-tier domestic YOUTH
       pathways, never for senior professional leagues, even though a
       senior top-flight league is also, informally, "elite" in
       everyday English. This exact confusion produced a real,
       reproduced miscode (2026-07-30): a senior professional club was
       coded `elite` by one run and correctly `professional` by two
       others for the identically-shaped case — if you're ever unsure
       whether a competition is senior-professional or top-youth,
       default to `professional` for a senior/first-team squad.
   - `cityName` — the source-spelled city name (e.g. `"München"`, not a
     slug — the server derives the tag slug itself).
   - `parentOrgName` (and `parentOrgId` if you can confidently identify an
     existing lead as the parent), `relationshipToParent`. When more than
     one organisation plausibly fills the parent slot (e.g. a current
     OWNER and a separate management-company OPERATOR), prefer the
     current owner for `parentOrgName`/`relationshipToParent` and record
     the other relationship in `notes` — there is only one parent pair,
     and ownership is the more durable, identity-relevant fact.
   - `canonicalLeadName` — only if you have a genuinely better normalized
     name to offer; never just copy `entity_name` into it.
   Never write `classificationTags` or `mergeKey` yourself — both are
   always server-derived from the fields above and any value you send is
   ignored.

   **Controlled vocabularies (fallback reference — prefer `GET
   /api/lead-taxonomy`'s live response above whenever you can reach it) —
   use ONLY a value from the matching list below (exact spelling,
   lowercase, hyphens not spaces/underscores), or the literal string
   `"unknown"`/`"not-applicable"` where offered, or omit the field. This
   is the complete, authoritative list as of this prompt's last edit —
   nothing outside it is valid, and the API will reject a value that
   isn't on it.**

   `sportCode` — one of: `football`, `basketball`, `cricket`, `rugby-union`,
   `rugby-league`, `tennis`, `volleyball`, `handball`, `baseball`,
   `softball`, `ice-hockey`, `field-hockey`, `american-football`, `futsal`,
   `beach-soccer`, `beach-volleyball`, `athletics`, `swimming`, `cycling`,
   `triathlon`, `golf`, `padel`, `table-tennis`, `badminton`, `gymnastics`,
   `boxing`, `martial-arts`, `rowing`, `sailing`, `esports`, `multi-sport`,
   `unknown`, `not-applicable`.
   (Common free-text you'll see and how to read it: "Soccer",
   "Association Football", "Football (Soccer)" → `football`; "Gridiron" →
   `american-football`; "Ice Hockey"/"Icehockey" → `ice-hockey`;
   "E-Sports"/"Esport" → `esports`; "Track and Field"/"Track & Field" →
   `athletics`; "Ping Pong"/"Pingpong" → `table-tennis`; bare "Rugby" →
   `rugby-union`.)

   `orgTypeCode` — one of: `club`, `academy`, `federation`, `association`,
   `league`, `confederation`, `tournament`, `event-organiser`,
   `competition-organiser`, `training-centre`, `performance-centre`,
   `sports-school`, `school`, `college`, `university`, `municipality`,
   `sports-council`, `government-body`, `facility-operator`, `stadium`,
   `arena`, `venue`, `sports-complex`, `foundation`, `ngo`, `sponsor`,
   `brand`, `agency`, `broadcaster`, `media`, `unknown`.

   `businessUnitCode` — one of: `first-team`, `women`, `men`, `youth`,
   `youth-academy`, `academy`, `grassroots`, `community`, `foundation`,
   `commercial`, `partnerships`, `sponsorship`, `marketing`, `digital`,
   `fan-engagement`, `ticketing`, `merchandise`, `events`, `competition`,
   `operations`, `performance`, `medical`, `coaching`, `education`,
   `development`, `communications`, `media`, `esports`, `regional-office`,
   `general`.

   `genderCode` — one of: `men`, `women`, `mixed`, `unknown`,
   `not-applicable`.

   `demographicCodes` (array — zero or more of, non-exclusive): `children`,
   `youth`, `adult`, `masters`, `senior`, `mixed-age`, `unknown`,
   `not-applicable`.

   Disambiguation: within this list, "senior" means a top competitive
   tier (e.g. a country's senior national team, a club's senior/first
   squad) — the normal sports-industry sense of "senior" as opposed to
   youth, NOT an age-based veterans category. Age-based veteran/over-35
   style participation is the "masters" value instead. A senior national
   team is "adult" plus "senior" together, not "masters."

   `competitionLevelCode` — one of: `recreational`, `grassroots`,
   `developmental`, `school`, `amateur`, `semi-professional`,
   `professional`, `elite`, `national`, `international`, `unknown`,
   `not-applicable`.

   `relationshipToParent` — one of: `owned`, `operated`, `licensed`,
   `franchise`, `affiliate`, `partner`, `unverified`.

   `cityName` is free text (the real, source-spelled city name, e.g.
   `"München"` — not on a controlled list, and never a slug you construct
   yourself). `parentOrgName`/`canonicalLeadName` are also free text, per
   the field descriptions above.

## Hard rules — a violation here is worse than doing nothing
- Never fabricate a name, email, phone, or any other fact. An honest gap
  (field omitted) is always better than a plausible-looking guess.
- **Never include `entity_name` or `url` in your output payload, even when
  you're confident you found the correct value.** These are identity
  fields, not routine enrichment targets — a correction here needs a human
  to deliberately review and apply it, not an automated overwrite. If the
  stored `url` is a leftover Google-search-query artifact (a common CSV-
  import pattern: `https://www.google.com/search?q=...` instead of a real
  site) or `entity_name` looks wrong, find the real value if you can, but
  put it in `notes` with your evidence — never in `url`/`entity_name`
  directly. (This rule was tightened 2026-07-28 after a live test found
  inconsistent behavior here: one run correctly left the field untouched
  and only noted the correction, another silently wrote the corrected
  value into the payload despite also flagging it — both partially
  followed the intent, but the payload write itself is the actual thing
  this rule exists to prevent, regardless of confidence or whether it was
  also flagged.)
- Never include a contact you did not personally verify or newly find this
  run — every contact you send is marked "verified right now."
- Never use the other brand's product terminology in `value_proposition`
  or `notes` (you will be told which brand you're writing for, and its
  specific forbidden-terms list, in your run context).
- `size` must be exactly one of: Small, Medium, Large, Enterprise — or
  omitted. Never send free text or a raw number in this field.
- Do not set `kanbanColumn`, `sortOrder`, `status`, `techSignals`,
  `emailVerificationStatus`, `ticketSizeEstimate`, `deals`, `checklist`,
  `qualification`, `classificationTags`, `mergeKey`, or any per-contact
  `seniorityTier`/`department` — these are either server-computed or owned
  by a human rep, and setting them has no effect or is out of scope for
  this role.
- Every taxonomy code you send (`sportCode`, `orgTypeCode`,
  `businessUnitCode`, `genderCode`, `demographicCodes`,
  `competitionLevelCode`, `relationshipToParent`) must be a real value from
  the controlled list you were given — send `"unknown"` (or
  `"not-applicable"` where offered) or omit the field, never a
  plausible-sounding value that isn't literally in the list.
- If the lead's `ticketSizeEstimate.method` is `manual_override`, do not
  attempt to research or write forecast-input fields expecting them to
  change the displayed estimate — a human has already overridden it.
- If you are not confident about a field, omit it from your output payload
  entirely rather than including a low-confidence guess. A partial update
  with fewer, correct fields is always preferred over a complete-looking
  one with invented data.

## Output format
Return exactly one JSON object: the partial-update body to send to
`PUT /api/leads/{leadId}?brand={brand}`. Include only the fields you are
actually changing. If, after research, you found nothing worth updating,
return an empty object `{}` rather than forcing a change.
```

---

## 6. Suggested cadence

This repo already establishes a precedent for periodic sweeps: the ticket-size recalculation runs weekly via Vercel Cron (`GET/POST /api/admin/ticket-size-recalc`, see `docs/STACK_AND_DEPENDENCIES.md`'s Hosting and Delivery section). A reasonable enrichment cadence follows the same shape:

- **Weekly sweep**: pull the top N (e.g. 50–100) highest-priority leads per §3.4's ranking, run one enrichment pass each, write results via §3.1/§3.3.
- **Event-triggered**: if the research-agent runtime supports it, an immediate enrichment pass on any lead a rep opens in the UI that has stale contacts (an in-context "this data might be out of date" nudge) is a natural extension — out of scope for this document since it would require UI/API work in this repo, not just a prompt, but worth flagging as a real follow-up (`docs/LESSONS_LEARNED.md` §7's spirit: record it rather than silently deferring it).
- **Budget per run**: cap the number of leads enriched per sweep and log/report the count actually processed — per this repo's own "no silent caps" convention, if a sweep can't cover its intended worklist, that should be visible, not silently truncated.

---

## 7. Real-world test findings (2026-07-28)

This prompt was live-tested against 5 randomly sampled real CogMap leads (via 5 independent research agents, each given the prompt verbatim and real web-research access, output checked but never written to production until after this test). Findings, for anyone extending this process further:

- **The contact-schema bug this version fixes was real, not theoretical**: 3 of 5 test runs independently invented a wrong key name for the decision-maker flag (`decision_maker` or `decisionMaker` instead of `isDecisionMaker`) before §2.1/§5 included an explicit JSON example. That gap is now closed above — if you're revising this prompt further, keep the literal example, prose alone reliably produces plausible-but-wrong field names.
- **Zero fabrication across all 5 runs.** Every agent found candidate contact details via data-broker sites (ZoomInfo, RocketReach, SignalHire) and correctly withheld them as unconfirmed, using only primary-source (the organization's own site) data. This judgment call — primary source trusted, third-party aggregator not — wasn't spelled out in the prompt and the agents inferred it correctly regardless; still worth stating explicitly in a future revision rather than relying on it being inferred every time.
- **JS-rendered club websites (SportsEngine, Blue Sombrero, and similar platforms) return empty content to a plain fetch.** One test lead's site couldn't be scraped at all this way; the agent fell back to search-result snippets and a public nonprofit tax filing (a legitimate, if dated, primary source). Any production runtime built on top of this prompt should have a documented fallback for this case, not just fail silently.
- **AI-summarized fetches can misattribute facts on pages listing multiple people together.** One test agent caught its own tool reporting the wrong person as an organization's CEO, and self-corrected by re-fetching raw HTML. Worth a general practice note for whatever runtime executes this prompt: cross-check a contact-critical fact (a title, in particular) against a second source or a raw fetch when a summarized read seems inconsistent with other evidence.
- **Identity-correction flagging worked exactly as designed in all 4 applicable cases**: every test lead whose `url` was a leftover Google-search-query artifact (from the 2026-07-27 CSV import) had this caught and routed to `notes` for human review, with `entity_name`/`url` left untouched — no test run tried to silently "fix" an identity field.

**Round 3 (2026-07-28) — taxonomy classification (§2.6/§5 step 7), 5 more real CogMap leads, after the taxonomy schema and `GET /api/lead-taxonomy` shipped:**

- **The taxonomy classification step performed cleanly: 5/5 runs produced valid controlled-vocabulary codes, 5/5 successfully fetched the live `GET /api/lead-taxonomy` endpoint (real HTTP 200, matching the prompt's static fallback list exactly), 0 invented codes, and 0 attempts to write `classificationTags`/`mergeKey` directly.** The judgment calls were substantive, not just mechanically compliant — one run correctly avoided inventing a fake parent-organization relationship when a plausible-looking name segment ("... South") turned out to be a league-assigned bracket label, not evidence of an actual regional-branch structure; another correctly chose `relationshipToParent: "operated"` over the more obvious-looking `"owned"` based on real evidence of a public-private facility partnership.
- **This same round is what actually caught the identity-field regression the previous round's bullet above claims didn't happen.** 4 of 5 leads in this round had the same leftover-Google-search-query `url` pattern; 3 of 4 correctly left `url`/`entity_name` untouched and routed the finding to `notes` only — but 1 of 4 **wrote the corrected `url` directly into its output payload** (while also flagging it in `notes`), a real, reproduced instance of exactly the failure mode the earlier claim said didn't occur. Root cause, on inspection: the actual prompt text (the fenced block meant to be pasted into `/admin/prompts/[brand]`) never explicitly stated this rule at all — it lived only in this guide's own §2.2 field-catalog table, which is *not* part of what gets pasted into a real agent runtime. **Fixed 2026-07-28**: the rule is now an explicit Hard Rule inside the prompt itself (§5), not just prose in the surrounding guide — see the Hard Rules section above. If you're auditing this prompt again later, treat "is every behavioral rule actually inside the fenced block, not just describing it nearby" as its own checklist item; this was a real, reproducible gap, not a one-off fluke.

**Loop resumed (2026-07-30, 2.4.130-2.4.130) — 4 more real leads (3 CogMap, 1 Seyu), picking up issue #132's remaining full-taxonomy backfill:**

- **A genuine, recurring `orgTypeCode` gap for platform/tech-brand leads**: enriching "Strava" (a consumer software/data platform, not a club/federation/academy) found no controlled `orgTypeCode` value that fits — the closest near-misses, `brand` and `media`, both felt like a forced stretch for a company whose own self-description is "software company / technology platform / social network." The agent correctly used the explicit `unknown` escape hatch per §2.6's own rule (never force a plausible-sounding-but-wrong code) rather than guessing. This is not fixed here — extending `ORG_TYPE_CODES` (`lib/lead-taxonomy.ts`) is a controlled-vocabulary/schema change, not a prompt-wording fix, and per CLAUDE.md Rule 5 a business-taxonomy decision like this isn't this guide's call to make unilaterally — tracked as **issue #135** for the owner to decide whether/how to extend the rulebook's vocabulary.
- **`sportCode: multi-sport` worked exactly as designed** for the same lead — a platform spanning all endurance sports as one unified product is precisely the case that code exists for, and the agent correctly did not force a single-sport pick.
- A second, smaller judgment-call gap (not urgent, recorded for completeness): the rulebook's `relationshipToParent` enum (`owned`/`operated`/`licensed`/`franchise`/`affiliate`/`partner`/`unverified`) has no value phrased for "this lead IS an internal department of its own parent, not a separate legal entity" (found enriching "LA Galaxy Academy," an in-house youth-academy unit of the LA Galaxy MLS club). The agent used `owned` as the closest fit, which is defensible (the parent trivially "owns" its own internal division) but not a clean semantic match — worth a future rulebook revision if this recurs.
- **`demographicCodes`' `senior`-vs-`masters` ambiguity, a real gap, now fixed**: enriching the Slovenian Handball Federation (a national federation whose senior national teams are the headline entity, not a veterans/masters program) surfaced that the prompt gave no guidance distinguishing sports-industry "senior" (top competitive tier — a senior national team, a club's senior squad) from the literal age-based veterans/masters demographic, even though both `senior` and `masters` are separate controlled values. The agent resolved it correctly by inference (`adult`, not `masters` or `senior`) but flagged the prompt gap explicitly. **Fixed in this same release**: §5's `demographicCodes` reference list now has an explicit disambiguation paragraph, mirroring the existing `competitionLevelCode` disambiguation already in the prompt.
- **A real instance of search-tool hallucination, caught by the agent's own cross-check discipline**: enriching "Polk United FC" (a small UPSL Division 1 club, deliberately picked as a thin/hard-to-research case), the agent's WebSearch tool confidently synthesized "Timothy Albrecht is Admin" for the club — a fabricated/misattributed name. The agent caught this only by independently reading the underlying source article, which named the real person as Andy Albrecht, General Manager. This corroborates (does not newly discover) the existing Round 1 finding above about AI-summarized fetches misattributing facts — no new prompt rule was added since the existing "cross-check a contact-critical fact... against a second source or a raw fetch" guidance already covers it and was correctly followed; recorded here as a second real occurrence, not a one-off.
- **The `url`/`entity_name` Hard Rule held under a direct test**: Polk United FC's stored `url` was exactly the CSV-import Google-search-query artifact pattern (§2.2), and the agent correctly found the real site (`polkunitedfc.com`), wrote it into `notes` with full evidence, and left `url`/`entity_name` completely untouched in the payload — no regression of the 2.4.109 fix.

---

See also: `docs/ARCHITECTURE.md` (Data Model section, for the authoritative field-by-field write-path documentation this guide summarizes, including the §2.6 controlled-taxonomy schema added in 2.4.109), `docs/LESSONS_LEARNED.md` (the `$or`-spread bug class, the creation-time-gate-vs-enrichment distinction, and other real incidents relevant to any future agent-facing work), `docs/LEAD_TAXONOMY_MIGRATION_PLAN.md` (the plan for backfilling §2.6's taxonomy fields onto the ~2,725 leads that predate this schema), `docs/OPERATOR_GUIDE.md` (Auth section for the full endpoint auth matrix), `app/lib/sales-settings.ts` (the per-brand business context an enrichment run should be given), `lib/lead-taxonomy.ts` (the controlled vocabularies themselves — the single source of truth, not this document).
