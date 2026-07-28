# Lead Enrichment Guide — AI Research Agent

**Version:** 2.4.104

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
| `entity_name` | string | Only to correct a factual error | Changing this on an existing lead is an identity correction, not routine enrichment — flag these for human review rather than silently overwriting. |
| `url` | `https://...` | Only if the company's domain genuinely changed | Same caution as `entity_name`. |
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

### 2.6 Fields the enrichment agent should never write

| Field(s) | Why not |
|---|---|
| `techSignals`, `techSignalsScannedAt`, `techSignalsScanStatus` | Server-computed only, by an SSRF-guarded homepage scan. To refresh these, trigger the `RESCAN_TECH` action (§3.2) — don't attempt to set the values directly, they'll be silently overwritten by the next real scan anyway. |
| `emailVerificationStatus` | Server-computed asynchronously after any write that changes an email. Setting it yourself has no effect — it'll be overwritten. |
| `ticketSizeEstimate` | Server-computed from §2.4's raw signals on every `PUT` (unless `manual_override` is active — see above). |
| `seniorityTier`, `department` (per-contact) | Rule-derived from `title` on every write. Setting them has no effect. |
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
  "country": "US"
}
```

A 400 response means validation failed — read `details` in the response body, it lists every specific rule broken (format, forbidden brand term, wrong enum value). Do not retry with the same payload; fix the specific field(s) named in the error.

### 3.2 Refresh a lead's detected tech stack

```
PATCH /api/leads?brand={cogmap|seyu}&id={leadId}
Headers: x-api-key: <SLG_API_KEY>
Content-Type: application/json

Body: { "action": "RESCAN_TECH" }
```

Scans the lead's own already-stored `url` (never a URL you supply) — this is not a general-purpose fetch endpoint. Returns immediately with the scan result (5-second ceiling, never throws).

### 3.3 Which leads to enrich, and in what order

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
- **Don't set any of the server-computed fields listed in §2.6.** They'll be silently overwritten regardless, so writing them just adds noise to your payload.
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
   this rubric (the server does NOT recompute this on update):
   - 1 = no named contact found at all
   - 2 = only a general/company-level contact found
   - 3 = a named contact, but no email or phone
   - 4 = named contact + the lead's own `address` field actually set in
     this payload (or already stored) — not merely mentioned in `notes` —
     but no email or phone
   - 5–6 = named contact + (email or phone), `address` optional
   - 7 = named contact + `address` + email + phone, all present
6. **Promote `qualityStatus`** from DRAFT toward CHECKED or VERIFIED as your
   confidence in the lead's overall data quality genuinely increases through
   this research pass — don't promote it reflexively just because you ran.

## Hard rules — a violation here is worse than doing nothing
- Never fabricate a name, email, phone, or any other fact. An honest gap
  (field omitted) is always better than a plausible-looking guess.
- Never include a contact you did not personally verify or newly find this
  run — every contact you send is marked "verified right now."
- Never use the other brand's product terminology in `value_proposition`
  or `notes` (you will be told which brand you're writing for, and its
  specific forbidden-terms list, in your run context).
- `size` must be exactly one of: Small, Medium, Large, Enterprise — or
  omitted. Never send free text or a raw number in this field.
- Do not set `kanbanColumn`, `sortOrder`, `status`, `techSignals`,
  `emailVerificationStatus`, `ticketSizeEstimate`, `deals`, `checklist`,
  `qualification`, or any per-contact `seniorityTier`/`department` — these
  are either server-computed or owned by a human rep, and setting them has
  no effect or is out of scope for this role.
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

- **Weekly sweep**: pull the top N (e.g. 50–100) highest-priority leads per §3.3's ranking, run one enrichment pass each, write results via §3.1/§3.2.
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

---

See also: `docs/ARCHITECTURE.md` (Data Model section, for the authoritative field-by-field write-path documentation this guide summarizes), `docs/LESSONS_LEARNED.md` (the `$or`-spread bug class, the creation-time-gate-vs-enrichment distinction, and other real incidents relevant to any future agent-facing work), `docs/OPERATOR_GUIDE.md` (Auth section for the full endpoint auth matrix), `app/lib/sales-settings.ts` (the per-brand business context an enrichment run should be given).
