# Region resync, 2026-09-27 (issue #222)

Production data change. The 192 leads whose `country` was corrected in
2.4.233 (`docs/data-fixes/2026-09-26-country-corrections.md`) had `region`
deliberately left untouched at the time — it feeds the ticket-size region
multipliers, so changing it was called out as its own business decision.
This is that decision: **owner accepted the recommendation to resync
`region` from the now-corrected `country`, 2026-09-27.**

Before writing anything, all three brands' `regionMultipliers`
(`GET /api/sales-settings/[brand]`) were checked live and are `{}` for
cogmap, seyu and dvsc — no region actually drives a multiplier in
production today, for any brand. This resync has no live effect on any
forecast right now; it corrects the stored value so it's right whenever
an operator does configure one.

## Method

For each of the 192 leads from the 2026-09-26 country fix:
1. A fresh `GET` confirmed the stored `country` still matched the
   corrected value and read the current `region`.
2. Skipped with no write if `region` already equalled the corrected
   `country` (13 leads — these had already been set correctly, most
   likely by a later individual correction).
3. Otherwise, a `PUT` set `region` to the same value as the corrected
   `country` — the same value the original bug had wrongly copied into
   both fields together, so this is a direct, symmetric undo of that bug,
   not a new country-to-macro-region taxonomy (this app's `region` field
   has no controlled vocabulary; a real macro-region grouping like "CEE"
   or "Nordics" would need its own owner decision and wasn't invented
   here). Existing notes were kept first.
4. A fresh `GET` verified the new `region` and that the note was written.

## Result

179 of 192 leads updated (177 Seyu, 2 CogMap); 13 already matched and were
left alone. All 192 re-read and confirmed correct — zero mismatches. Full
per-lead before/after values are in this session's own report; the counts
above are the durable record.

## A caveat found after shipping

`docs/LEAD_ENRICHMENT_GUIDE.md` §2.2 documents `region`'s existing
convention as macro-region abbreviations (`US`, `CEE`, `MENA` are its
listed examples), not raw ISO country codes. This resync set `region` to
the same 2-letter country code as the corrected `country` for each lead,
matching the shape the original bug had already put there (it copied a
country-code-shaped literal into both fields, just the wrong one) —
not the macro-region grouping the guide's examples show. Since `region`
has no enforced format and zero live multiplier is configured anywhere,
this is a defensible, disclosed choice rather than a silent deviation,
but a future operator setting up real `regionMultipliers` should know
these 179 leads now hold country codes, not macro-region names, and
decide which key shape to standardize on.

## Rollback

Each lead's prior `region` value is recoverable from its own `notes`
field, where the correction records what it changed from (e.g. "region
corrected from 'DE' to 'ES'"). No bulk revert script exists or is
expected to be needed, given the field currently has no live effect on
any brand's forecast.
