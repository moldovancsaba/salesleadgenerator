# Operator Guide — Sales Lead Generator

**Version:** 2.4.137
**App:** https://salesleadgenerator.vercel.app

---

## Contents

- [Audience](#audience)
- [Signing In and Access](#signing-in-and-access)
- [Navigation](#navigation)
- [Daily Workflow — Kanban Board](#daily-workflow--kanban-board)
- [Backlog](#backlog)
- [Card Indicators](#card-indicators)
- [Table View](#table-view)
- [Filters and Search](#filters-and-search)
- [Lead Detail](#lead-detail)
- [Deals](#deals)
- [Checklist](#checklist)
- [Follow-ups](#follow-ups)
- [Qualification](#qualification)
- [Ticket Size](#ticket-size)
- [Sales Settings (Company Setup)](#sales-settings-company-setup)
- [Outreach](#outreach)
- [Forecast](#forecast)
- [Metrics Dashboard](#metrics-dashboard)
- [Search Learning](#search-learning)
- [Admin Tools (Super Admin Only)](#admin-tools-super-admin-only)
- [Mobile / PWA](#mobile--pwa)
- [API Integration](#api-integration)
- [Admin Endpoints](#admin-endpoints)
- [Known Issues and Limitations](#known-issues-and-limitations)
- [Escalation](#escalation)

---

## Audience

Pipeline operators and sales researchers who manage leads in the kanban board, review pipeline health in Forecast/Metrics, configure a brand's sales context in Sales Settings, or integrate via the API. A separate "Admin Tools" section below is for the designated super admin only.

---

## Signing In and Access

The app uses DoneIsBetter SSO — there is no local username/password login. Tap **Sign in** in the hamburger menu to start the SSO flow.

After signing in, one of three things happens:
- **No organization access yet** — you're signed in, but nobody has assigned you to a brand (CogMap or Seyu). You'll see "We'll be in touch soon once you have access to your organization." Contact your admin.
- **Access to exactly one brand** — the hamburger menu shows that brand's Pipeline/Sales Settings/Reporting links directly.
- **Access to more than one brand** — the hamburger menu shows an **Organization** switcher (a dropdown) above the same links, so you can browse either brand's Reporting section without navigating away first. Actually opening a page for a brand still requires clicking its link.

Access is granted per-brand by a super admin in **Users & Access** (see [Admin Tools](#admin-tools-super-admin-only)) — there's no self-service way to request or grant it. If your access is revoked or the SSO app itself denies you, you'll land on an "Access Denied" page with a reason.

---

## Navigation

Everything in the app is reachable from one place: the hamburger icon (☰), always visible top-left. It opens a slide-out menu with, depending on your access:

- **Organization** switcher (only shown if you have access to 2+ brands)
- **\<Brand\>** section: **Backlog** (leads parked for later, see [Backlog](#backlog)), **Pipeline** (the kanban/table board), **Sales Settings** (Company Setup)
- **View** (only shown while already on the Pipeline page for a brand): Kanban, Table, Metrics, Search Learning — these four views live at the same URL with a `?view=` parameter, not separate pages
- **Reporting**: Forecast, Battlecards, Outreach Templates
- **Admin** (super admins only): Prompt Editor, Users & Access, Duplicate Review
- **Sign out**

There is no on-page dropdown or brand switcher anywhere else in the app (an earlier version had one on the Forecast/Battlecards/Outreach Templates pages; it was removed as a duplicate of this menu). Everything is one brand at a time, chosen either by the URL or by this menu — never guessed or silently defaulted.

---

## Daily Workflow — Kanban Board

DISCOVERED and QUALIFIED are auto-managed columns: a lead is placed and sorted purely by its ICE score (QUALIFIED at 500+, otherwise DISCOVERED; always high to low). Dragging a card out to ENGAGED/PROPOSAL/WON/LOST (or an Accept/Decline/Pin action) hands that lead to manual, user-controlled placement and ordering permanently — it's never auto-moved again even if its score later changes.

1. Open `/sales/<brand>` on mobile or desktop.
2. Review new cards in DISCOVERED.
3. Tap a card to view details, contacts, and value proposition.
4. Use actions:
   - **Accept** → marks the lead `status: 'qualified'` and increments its feedback/acceptance counters; it does **not** move the card — placement is still driven purely by ICE score for DISCOVERED/QUALIFIED leads (see above)
   - **Decline** → move to LOST with a reason (required)
   - **Pin** → force ENGAGED
   - **Refresh** → request updated research
   - **Modify / Edit Lead Details** → edit lead fields directly (see [Lead Detail](#lead-detail))
   - **Delete** → remove lead
5. Drag cards between columns when the pipeline changes, or use the per-card "⋮" menu to move a card without dragging (this also works on mobile/keyboard, where drag doesn't).

### Add Lead

Tap the **+** button in the Pipeline toolbar to manually add a lead the research agent hasn't found yet (a referral, a lead you sourced yourself, etc.). The form captures the same fields the research agent would (entity, URL, country/region, size, industry, contacts, value proposition, tags) up front, rather than creating a bare stub you fill in later. You don't set ICE scores directly — a manually-added lead always starts in DISCOVERED with a neutral default score, exactly like a fresh research-agent lead below the QUALIFIED threshold. Duplicate detection (same URL + entity + region) applies the same as any other lead creation path.

### Required fields to move into ENGAGED or PROPOSAL

A lead needs **at least one contact** (any contact — it no longer has to be flagged as the decision maker) and a **value proposition** filled in before it can be dragged, pinned, or bulk-actioned into ENGAGED or PROPOSAL. If either is missing, the move is blocked with a message like "Missing required fields for ENGAGED: a contact, a value proposition" — fill in the missing field(s) (in Edit Lead Details) and try again. DISCOVERED/QUALIFIED (auto-managed) and WON/LOST (terminal) are never gated this way.

### Collapsing columns

Tap a column's own header to collapse it down to just its title and count — useful on mobile to get a quick overview of every stage without scrolling through cards in stages you're not focused on right now. Tap again to expand.

### Bulk actions (Select mode)

Tap the **Select** icon in the toolbar above the board to enter select mode — a checkbox appears on every card. Selection is limited to one column at a time (picking a card in a different column is rejected with a notification). Once you've checked at least one card, a bulk action bar appears with **Decline selected** / **Pin selected**. Each lead is actioned individually server-side, so a partial failure (e.g. one lead blocked by the required-fields gate above) doesn't fail the whole batch — you'll see a summary like "8 of 10 pinned — 2 blocked: Missing required fields for ENGAGED: ..." (the required-fields gate above only blocks a move into ENGAGED/PROPOSAL, so this message can only appear for **Pin selected**, which always targets ENGAGED — not Decline, which targets LOST and is never gated). Tap the Select icon again (now an ✕) to leave select mode.

---

## Backlog

Backlog is a holding area for leads you don't want to work right now, but don't want cluttering the Pipeline board either — a competitor you're deliberately deprioritizing, a lead that's a poor fit today but worth revisiting later, etc.

- Reach it via the **Backlog** link in the hamburger menu, right before **Pipeline**.
- It's the same board component as Pipeline — same card layout, Select mode, bulk actions, filters — but with a single **Backlog** column instead of the six pipeline stages.
- From any pipeline column's card menu, choose **Move to Backlog** to park a lead. From a Backlog card, choose **Move to Pipeline** and pick which column it should land in (Discovered, Qualified, Engaged, Proposal, Won, or Lost) — this is a dedicated action, not the drag/drop or per-card "⋮" move menu used elsewhere, since a 1-column board and a 6-column board can't offer each other's columns as generic drag targets.
- **Backlog leads are excluded from Forecast and the Metrics dashboard** — a deliberately-parked lead shouldn't inflate or distort revenue projections or pipeline health numbers. They're also exempt from staleness/"rotten" indicators, since being untouched in Backlog is the intended state, not neglect.
- **Backlog leads are included in Table view** alongside every other column, so you can still search/filter/export them; they're only hidden from the Pipeline kanban board itself.

---

## Card Indicators

Each kanban card shows several small signals, each answering a different question:

- **Quality badge** (DRAFT / CHECKED / VERIFIED): DRAFT only shows in DISCOVERED/QUALIFIED — once a lead is manually worked into ENGAGED and beyond, an unreviewed DRAFT badge would just be noise. CHECKED/VERIFIED always show, everywhere.
- **DEAL badge**: appears next to the quality badge (not instead of it) whenever the lead has at least one manually-entered deal — see [Deals](#deals).
- **Rotten dot**: a small colored dot + day count showing how long since the lead was last touched (any edit or move) — green for the first 3 days, yellow through day 7, red from day 8 onward. This is deliberately a *different* signal from the yellow/red "Stale"/"Critical" badge described in the workflow section above: the stale badge only appears once a column-specific threshold (10–21 days) is crossed and is a harder alert; the rotten dot is always visible from day 0 as a gentler, at-a-glance freshness cue. Both can show on the same card at once — that's expected, not a bug.
- **Tags**: up to 3 tag chips, with a "+N more" chip if there are more — see [Filters and Search](#filters-and-search) for filtering by tag.
- **Checklist progress**: "N/M" once a lead has checklist items — see [Checklist](#checklist).
- **Follow-up**: "Follow-up due today" / "Follow-up Nd overdue" / "Follow-up in Nd" once a reminder is set — see [Follow-ups](#follow-ups).
- **Win probability**: a "Win probability" row showing that column's close-rate percentage (the same figure the Forecast page uses to weight revenue), shown for every column except WON/LOST.
- **Created / Updated**: a compact "Created 3d ago · Updated today" line — hover for the exact date and time.

---

## Table View

Switch to Table via the hamburger menu's View section (or `?view=table`). Shows every lead as sortable rows: Name, Score (ICE), Region, Quality, Status, Tags — tap a row's name to open the same detail modal the kanban card opens. On a narrow phone screen, rows collapse into a compact card (name, region, quality) instead of a wide table. There's no separate filtering here — the Filters panel (see below) applies identically to both Kanban and Table view, and switching between them keeps the same active filter.

---

## Filters and Search

- **Region, industry, and tag filtering**: tap the Filters icon above the board or table (a small funnel — collapsed by default, nothing shows until you open it) to open the filter panel. Set a region (US/CEE/MENA), an industry (free text, matches case-insensitively — e.g. `academy` matches `Academy`), and/or one or more tags, and the board/table narrows to match immediately. A lead matches the tag filter if it has *any* of the selected tags (not all of them). Applies to both kanban and table view — switching views keeps the same active filter.
- **Saved filters**: with a region, industry, and/or tags set, tap **Save filter** and give it a name — it appears as a removable pill you can tap to re-apply later. Saved per-browser (not synced across devices), scoped per brand.
- No status filter — the kanban board's own columns already group by status; adding a redundant status filter was deliberately left out.
- Search matches entity name, sector, and contact name (predictive dropdown under the header) — independent of the region/industry filter, not affected by it.
- No manual sort control exists. DISCOVERED and QUALIFIED always sort by ICE score, high to low; ENGAGED/PROPOSAL/WON/LOST sort by the order you've arranged them in.
- Tenant filter (`?tenantId=`) exists in the API only; there is no tenant filter control in the UI.

---

## Lead Detail

Tapping a card (or a table row) opens the full detail view:

- **ICE Score** and **Ticket Size** (see the dedicated [Ticket Size](#ticket-size) section below) sit near the top, both answering "how are we scoring this deal."
- **Source / Created / Last Updated**: a small metadata row shows the lead's acquisition channel (`manual`, `research_agent`, or whatever a caller sets — `—` if never recorded) and the full date+time it was created and last touched.
- **Contacts**: each contact shows a "Decision Maker" flag (informational — no longer required to move a lead forward, see the workflow section above), an email-verification badge (Checking… / Verified domain / Undeliverable domain / Check failed — retry pending — this only confirms the *domain* can receive mail, never that the specific mailbox exists), and rule-based seniority/department badges derived from the contact's title (e.g. "VP" + "Sales" for "VP of Sales"). A contact not re-confirmed in 180 days shows a "Needs re-verification" badge. Tap **Edit** on the Contacts section to add a new contact, edit an existing one's fields, toggle its decision-maker flag, or remove it — each contact is its own row with its own remove button; **Save** replaces the whole contact list, **Cancel** discards changes.
- **Tech Signals**: badges for anything detected on the lead's own website homepage (WordPress, Google Analytics, HubSpot, etc.), a "No tech signals detected" note, or nothing at all if never scanned. Use **Refresh**'s tech-rescan or the RESCAN_TECH action to re-check.
- **Edit Lead Details**: an Edit/Save/Cancel form for `entity_name`, `url`, `address`, `general_contact`, `size`, `industry`, `sport_or_sector`, `level_league`, `value_proposition`, `notes`, `tags`. This form does **not** yet include the newer controlled-taxonomy fields (`sportCode`, `orgTypeCode`, `businessUnitCode`, etc., added 2.4.109) — those are API-only for now; see [Lead Taxonomy](#lead-taxonomy) and [Known Issues and Limitations](#known-issues-and-limitations).
- **Actual deal value** (only shown once a lead is WON): capture the real, closed contract value — this feeds Ticket-Size Calibration on the Forecast page.
- **Manual ticket-size override**: from the same edit form, override the computed Ticket Size with your own number and a required reason (a rep's direct knowledge of a specific deal). "Clear override" reverts to the modelled estimate immediately.

---

## Deals

Deals are separate from the automatic **Ticket Size** estimate below — Ticket Size is always a modelled guess; a Deal is something a rep has typed in themselves and is always managed manually (nothing here is ever auto-created, auto-edited, or auto-removed by the system). A lead can carry multiple deals at once (e.g. a base contract plus a later add-on).

- **Add a deal**: tap **Edit** under Deals, then **Add deal**, enter a value (and an optional label like "Renewal"), and **Save**.
- **Convert ticket estimate to a Deal**: a one-tap shortcut that pre-fills a new deal's value from the current Ticket Size estimate — the value is fully editable before you save, it never saves automatically.
- **Deal currency** always matches the brand's own forecast currency (USD for CogMap, EUR for Seyu) — there's no per-deal currency picker.
- **Once a lead has any deal**, the Forecast page uses the sum of its deals instead of the Ticket Size estimate for that lead's revenue contribution — the Ticket Size estimate keeps recalculating in the background as a reference figure, it just stops being the number that counts toward Forecast.
- Every lead with at least one deal shows a **DEAL** badge on its kanban card, in every column, alongside (not replacing) the quality-status badge.

---

## Checklist

A per-lead to-do list, separate from the free-text Notes field — useful for a repeatable sequence of steps (e.g. "Send proposal," "Confirm budget," "Schedule demo"). Tap **Edit** under Checklist to add an item, check/uncheck items, edit their text, or remove them, then **Save**. The kanban card shows a compact "N/M" progress count once a checklist exists.

---

## Follow-ups

A scheduled reminder for a lead — set a due date and an optional note, then **Save follow-up**. This is a deliberate commitment you set yourself, different from the automatic "next step" suggestion the app computes on its own (missing contact, stale, needs verification) which still appears separately below it. **Clear** removes an existing reminder. The kanban card shows "Follow-up due today," "Follow-up Nd overdue" (in red), or "Follow-up in Nd" once a due date is set.

---

## Qualification

A lightweight (BANT-style) qualification checklist: Budget confirmed, Budget notes, Buying authority confirmed, Need/pain point, and a Timeline estimate. This is purely informational — filling it in (or leaving it blank) has no effect on whether a lead can move to ENGAGED or PROPOSAL; the [required fields](#required-fields-to-move-into-engaged-or-proposal) for that are still just a contact and a value proposition.

---

## Ticket Size

Every lead shows an automatic, estimated deal value — never a bare number typed in by an agent, always a calculated, capped figure with a stated method and confidence.

**How it's calculated**, in priority order:
1. **Per-participant pricing** — if the brand has a product priced per participant/seat for that lead's size tier, and the lead has an estimated participant count, the estimate is `rate × participants × 12 months`, discounted more heavily for bigger organizations (an Enterprise-tier org pays less per seat than a Small one, mirroring real per-seat pricing).
2. **Deal-size band** — otherwise, the brand's own configured typical deal value for that size tier (Small/Medium/Large/Enterprise), set in [Sales Settings](#sales-settings-company-setup).
3. **Smallest tier, assumed** — if the lead's size isn't set, or isn't one of the four valid values, the estimate uses whichever deal-size band the brand has configured that's numerically smallest — never the middle or largest guess, always the most conservative number available. This is clearly labeled "Smallest configured deal size — this lead's size isn't set" rather than shown as if the model actually knew the lead's real size.
4. **Not yet configured** — only if the brand hasn't set up any deal-size bands or per-participant pricing at all. Fix this in Sales Settings.

Every real estimate shows a range (low–high), never just one number, plus a confidence level (low/medium/high) and the method used. A rep can always override it manually with a reason (see [Lead Detail](#lead-detail) above) — a manual override is shown distinctly ("Manually overridden") and is never touched by any automatic recalculation afterward.

**Where the number comes from is always visible**, and one of four captions appears:
- *Modelled estimate from company-size tier/per-participant pricing · confidence* — the normal case
- *Smallest configured deal size — this lead's size isn't set...* — the fallback case above
- *Manually overridden by \<name\> — \<reason\>* — a rep's override
- *Unverified estimate — predates the firmographic estimation engine* — an old lead not yet recalculated

**Ticket-Size Calibration** (on the [Forecast](#forecast) page) shows how accurate these estimates have historically been, once enough deals have closed WON with a real deal value captured — use it to spot a tier that's consistently under- or over-estimated and adjust that tier's deal-size band in Sales Settings accordingly.

Once a lead has at least one entry under [Deals](#deals), the Forecast page uses the sum of its deals instead of this estimate — see that section for details. The Ticket Size figure keeps computing regardless, as a reference.

---

## Sales Settings (Company Setup)

A one-time (then occasionally revisited) questionnaire per brand, reached via the hamburger menu. This is what teaches the system how the brand actually sells — it directly drives Ticket Size estimates and the Forecast page, so it's worth filling in completely, not just enough to make the form disappear.

- **Basic Information**: company name, contact person, website, main industry, checkboxes for the main customer types you sell to (with a free-text "other").
- **What do you sell?**: a repeatable list of products/services. For each: name, description, "why they buy it," typical buyer roles, typical customer size, pricing model(s) (one-time / monthly / annual subscription / framework agreement / per-campaign / per-user / per-product / per-event / custom quote) with the matching price field(s), and a revenue-predictability rating.
- **Typical Deal Size**: expected contract value for Small/Medium/Large/Enterprise customers, plus the largest deal ever won. **This is the single biggest lever for Ticket Size accuracy** — see the [Ticket Size](#ticket-size) section above. Keep the "largest deal ever won" figure current: every estimate for every lead is capped at 2× this number, so a stale, too-low figure here silently suppresses every larger, legitimate estimate.
- **Region Multipliers**: optional per-region adjustment (e.g. `CEE` → `0.7`) applied to the Ticket Size estimate before the cap above. A region with no entry here is simply unadjusted (×1), never an error.
- **How often does a customer buy?**: purchase-frequency checkboxes plus a comments box.
- **Upsell**: what customers commonly buy afterward, and its typical added value.
- **Sales Process**: expected sales-cycle length and who typically approves the purchase.
- **Typical Customer Example**: a real reference customer — name, products purchased, contract length, total contract value.
- **Seasonality**: busiest quarters, plus optional specific months.
- **Revenue Target**: target amount, currency, and period. Drives the Pipeline Coverage indicator on Forecast — leave the amount blank to hide that indicator rather than show a misleading number.
- **Notes**: free text for pricing exceptions, discounts, renewal terms, or anything else worth recording.

Click **Save** at the bottom. Saving also triggers a recalculation of Ticket Size across every existing lead for that brand in the background — if you don't see updated numbers within a minute or two, they'll catch up on the next scheduled recalculation regardless.

---

## Outreach

Open a lead's detail view and use **Outreach** to compose a message.

1. Optionally narrow the template list by tag (pre-filled from the lead's own tags).
2. A **Battlecards** panel shows competitor positioning, proof points, and objection responses relevant to the lead — read-only reference material, never auto-inserted into your message; copy what's useful by hand.
3. Pick a template — its subject (email) or channel indicator (LinkedIn) and body fill in automatically, with placeholders like the contact's name and the organization's name already substituted using the lead's real data.
4. Edit the message as needed, then click **Log outreach**.

**Important**: clicking Log outreach does **not** send an email or LinkedIn message for you — it records what you're about to send (for tracking, win/loss attribution, and template performance reporting). You still have to actually send it yourself, e.g. by copying the text into your own email client or LinkedIn. Before you can log it, the app checks a few eligibility rules per channel (email needs a decision-maker contact with a valid email address; LinkedIn needs a decision-maker name; both have a maximum length) and explains clearly if something's missing.

### Managing outreach templates

Go to **Reporting → Outreach Templates** for a brand. Create a template with a name, channel (Email/LinkedIn), industry (matches similar leads automatically), tags (for filtering), a subject (email only), and the body — use placeholders like `{contact_name}`/`{entity_name}` directly in the text, they're substituted automatically when a rep uses the template. Below the form, a **Template Performance** table shows each template's send volume, WON/LOST counts, conversion rate, and last-used date (a 90-day attribution window). Deleting a template isn't implemented yet — only creating and editing.

### Managing battlecards

Battlecards are competitor positioning summaries and objection responses — reference material, never auto-inserted into a message.

1. Go to **Reporting → Battlecards** for a brand.
2. Click **New Battlecard**, fill in a competitor name and positioning summary (both required), and optionally add proof points, objection/response pairs, and tags.
3. Click **Create Battlecard**. Edit an existing one via its row's Edit button; remove one via the trash icon (a confirmation prompt appears first).
4. Tags reuse the same mechanism as outreach templates — a battlecard tagged `enterprise` shows up alongside a template tagged `enterprise`, and both surface together in the Outreach panel above.

Content can't mention the other brand's product terms — the same forbidden-terms check applied to a lead's own value proposition.

---

## Forecast

Reached via **Reporting → Forecast** for a brand. Shows, top to bottom:

- **Concentration risk warning** (only if triggered) — e.g. "42% of weighted pipeline value is in the top 1 deal — 'Acme Corp' alone is $120,000," flagging that the forecast is overly dependent on one client.
- **Pipeline Coverage** — weighted pipeline value ÷ your Sales Settings revenue target, labeled "Healthy coverage" / "Below healthy range" / "Above healthy range." If no revenue target is set, this shows a prompt to go set one in Sales Settings instead of a number.
- **Forecast Calibration** — compares the hand-picked close-probability per stage against what real WON/LOST history actually shows, with a toggle to switch the whole forecast between **Static** (hand-set) and **Calibrated** (real-history-driven) mode. A stage needs at least 20 closed deals before its calibrated rate is trusted; until then, the static rate keeps being used for that stage even in Calibrated mode.
- **Ticket-Size Calibration** — see the [Ticket Size](#ticket-size) section above.
- **Pricing by Company** (Seyu only) — per-client pricing terms and estimated annual value, plus a grand total.
- **Pipeline / By Tier / By Model** (CogMap only) — dollar value per pipeline stage, per company-size tier, and per revenue model.
- **Pipeline Weights** — editable close-probability percentages per stage, with Save — this is what feeds every "static" probability used above.
- **Export CSV** button (top of page) — downloads the current brand's pipeline per-column revenue/probability/weighted-revenue breakdown as a spreadsheet, matching the numbers shown on the page (fixed 2.4.92 — it previously always exported CogMap's data regardless of which brand's page you clicked it from).

---

## Metrics Dashboard

Switch to Metrics via the hamburger menu's View section (or `?view=metrics`), for a brand. Shows:

- **Total Leads / Avg ICE Score / Success Rate** summary tiles
- **ICE Score Distribution** — a bar chart of how many leads fall into each score bucket
- **Pipeline Distribution** — counts and percentages per kanban stage
- **Quality Status** — Verified / Checked / Draft breakdown
- **Decline Reasons** — filterable by industry/sport-sector/region and by time period (all-time/30d/90d/this quarter), showing which decline reasons dominate in a given slice
- **Regional Breakdown** — US/CEE/MENA counts
- **Pipeline Velocity** — average and median days a lead spends moving from one stage to the next, over a rolling 30-day window, with a trend arrow versus the prior 30 days. A stage-to-stage pair with too few samples shows as low-confidence rather than a misleadingly precise number.
- **"What Worked" — Outcome Correlation** — two read-only tables: which industries convert best (WON vs. LOST, all-time), and which of your saved search queries produce leads worth keeping (accept rate). Both suppress a rate as "Insufficient data" below 10 samples. The search-query table is global across all brands, not brand-specific.
- **Lead Source** — leads and win rate grouped by the `source` field (see [Lead Detail](#lead-detail)); leads with no recorded source are grouped under "unknown" rather than dropped.

---

## Search Learning

Switch to Search Learning via the hamburger menu's View section (or `?view=search`), for a brand. A read-only report — nothing to click or filter — answering "which search terms, domains, and saved queries are actually finding leads I keep, versus wasting my time?" Shows Total Search Runs, Average Success Rate, Last Updated, a **Top Queries** list (with accepted/declined counts and success %), **Top Terms** and **Top Domains**, and **Recent Queries**. This data is fed automatically every time you accept or decline a lead, and — unlike everything else in this app — is not scoped per-brand; it's shared globally.

---

## Admin Tools (Super Admin Only)

These three pages only appear in the hamburger menu, under **Admin**, for the app's designated super admin(s) — configured outside this app entirely (an environment variable listing specific email addresses), not something any in-app control grants.

### Users & Access

Every person who has ever signed in via SSO appears here automatically (there's no way to pre-add someone — they must sign in at least once first) with a dropdown per brand: **No access / User / Admin**. Change a dropdown to instantly grant or revoke that person's access to that specific brand. A super admin's own row is shown for visibility only and can't be edited here — their access is controlled entirely by the environment configuration, not this table.

### Duplicate Review

Click **Scan for duplicates** for a brand to compare leads by name similarity — gated on matching activity (a lead's controlled `sportCode` when set, 2.4.109, otherwise its free-text `sport_or_sector`; two leads with different or unknown sports/sectors are never flagged, even with identical names) — and file new candidate pairs for review (capped at the 2000 most recent leads per scan — if the brand has more, a notification says the scan was truncated). Domain match is shown as extra context on a flagged pair, never a reason to flag one by itself. Use the **Status** switcher (Pending / Confirmed / Dismissed / Merged) to move between stages — a pair leaves the Pending list the moment you decide on it, so Confirmed is where you'll find pairs waiting to be merged.

On a **Pending** pair: **Not a duplicate** (dismiss, no further action) or **Confirm duplicate** (moves it to the Confirmed list).

On a **Confirmed** pair: **Merge**. This opens a screen that:
- Combines contacts, tags, deals, and checklist items from both leads automatically — nothing is dropped.
- Only asks you something when the two leads genuinely disagree on a field (e.g. different value propositions, or one says Won and the other says Lost) — pick which value to keep for each. If the two leads don't actually conflict on anything, there's nothing to pick — just confirm and it's done.
- Lets you pick which of the two leads survives (a suggestion is pre-selected, based on which is further along the pipeline) — this only controls bookkeeping like sort order, not which values end up in the final record.
- On mobile, walks through one disagreement at a time with a progress indicator; on desktop, shows them all in one list.

**Merging is permanent.** The losing lead is deleted, not archived — there's no undo. Its outreach and outcome history moves onto the surviving lead, so nothing is lost, but the merge decision itself can't be reversed. Only merge a pair you're genuinely confident is the same organization.

### Prompt Editor

Edit the text instructions that drive the autonomous research agent for a brand/tenant — separate tabs for **Discovery** (finding new leads) and **Enrichment** (adding detail to existing leads). Changing and saving the prompt text directly affects the agent's future runs, not just documentation. Each tab also has its own **Enabled** switch, turning that operation on/off for the tenant immediately (separate from saving the prompt text itself) — if the toggle fails to save, the switch reverts and shows an error rather than displaying a false "on" state.

---

## Mobile / PWA

The app can be installed as a Progressive Web App (add-to-home-screen from your browser's share/menu) — pinch-zoom is intentionally locked to prevent accidental zoom while dragging cards. A **back-to-top** button appears bottom-right once you've scrolled down any page, and returns you to the top with one tap.

---

## API Integration

Base URL: `https://salesleadgenerator.vercel.app`

**Auth:** every lead endpoint below (`GET`/`POST`/`PATCH /api/leads`, `GET /api/leads/columns`, `PATCH /api/leads/bulk`, `GET`/`DELETE /api/leads/[id]`) requires either an `x-api-key` header (shown below) or an authenticated browser session with access to the requested `brand`. There is no unauthenticated read path. `POST /api/leads` previously required `x-api-key` exclusively (only the research agent ever called it); as of 2.4.96 it accepts a browser session too, so the in-app **Add Lead** button (see [Add Lead](#add-lead)) can call it directly — the `x-api-key` path is unchanged for existing callers. **`PUT /api/leads/[id]` is the one exception**: it requires `x-api-key` only, never a session — it's the research agent's own enrichment path and has no in-app browser caller (corrected during the 2026-07-27 documentation audit; previously grouped in with the session-accepting endpoints above).

### Read Leads
```bash
curl "https://salesleadgenerator.vercel.app/api/leads?brand=cogmap&limit=100" \
  -H "x-api-key: YOUR_API_KEY"
```

### Create Lead
```bash
curl -X POST "https://salesleadgenerator.vercel.app/api/leads?brand=cogmap" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{
    "entity_name": "Example Club",
    "url": "https://example.com",
    "country": "US",
    "region": "US",
    "sport_or_sector": "Soccer",
    "size": "Medium",
    "contacts": [
      {"name": "Jordan Smith", "title": "Academy Director", "email": "jordan@example.com", "phone": "+1 555 0100", "isDecisionMaker": true}
    ],
    "address": "New York, NY",
    "value_proposition": "SLG can help...",
    "pro_for_organization": ["Benefit 1", "Benefit 2"],
    "con_for_organization": ["Objection 1"],
    "kanbanColumn": "DISCOVERED",
    "ice": {"impact": 5, "confidence": 5, "ease": 5}
  }'
```

### Action Lead
```bash
curl -X PATCH "https://salesleadgenerator.vercel.app/api/leads?brand=cogmap&id=<LEAD_ID>" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"action":"ACCEPT"}'
```
(The app's own browser UI calls this same route via its authenticated session instead of an API key — see the Auth note above.)

### Update Lead
```bash
curl -X PUT "https://salesleadgenerator.vercel.app/api/leads/<LEAD_ID>?brand=cogmap" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"contacts": [{"name": "New Name", "isDecisionMaker": true}]}'
```

As of 2.4.109 this same call also accepts the new controlled-taxonomy fields (`sportCode`, `orgTypeCode`, `businessUnitCode`, `genderCode`, `demographicCodes`, `competitionLevelCode`, `cityName`, `parentOrgId`, `parentOrgName`, `relationshipToParent`, `canonicalLeadName`) — see [Lead Taxonomy](#lead-taxonomy) below for where the valid values come from. **There is no UI for these fields yet** — see [Known Issues and Limitations](#known-issues-and-limitations).

### Lead Taxonomy
```bash
curl "https://salesleadgenerator.vercel.app/api/lead-taxonomy"
```
No auth required. Returns the current controlled vocabularies (`sportCodes`, `orgTypeCodes`, `businessUnitCodes`, `genderCodes`, `demographicCodes`, `competitionLevelCodes`, `relationshipCodes`, `sportAliases`) as JSON — the same values `PUT /api/leads/[id]` validates the fields above against. This is what the enrichment agent's prompt (see `docs/LEAD_ENRICHMENT_GUIDE.md`) fetches before classifying a lead, so the values it writes are always current.

### Health Check
```bash
curl "https://salesleadgenerator.vercel.app/api/health"
```

### Outreach Analytics
```bash
curl "https://salesleadgenerator.vercel.app/api/outreach-templates?mode=analytics" \
  -H "x-api-key: YOUR_API_KEY"
```

---

## Admin Endpoints

- `GET /api/admin/cron-status` — cron run health and counts
- `GET /api/admin/data-hygiene` — malformed lead counts by brand
- `GET /api/stats` — totals, column counts, and region breakdowns
- `GET /api/boards` — available brand boards and config
- `POST /api/admin/ticket-size-backfill` — recompute Ticket Size across a brand's leads (dry-run by default, `{apply: true}` to commit)
- `POST /api/win-rates/recalculate` — force a Forecast Calibration recompute

These require `x-api-key` auth. There is no browser button for any of them — the browser has no safe way to hold that secret, so these are for API/CLI/cron use only, consistent with the rest of this app's `x-api-key`-gated admin routes.

---

## Known Issues and Limitations

- Full `next build` may OOM in limited local/sandboxed environments; use `tsc --noEmit` for type verification there. Vercel's production build environment is unaffected.
- Some leads (a real, ongoing minority — confirmed in production: dozens per brand) have a `size` value that's missing, or free text instead of one of the four valid tiers (Small/Medium/Large/Enterprise) — usually from research-agent writes that predate the current enum enforcement, or a size description rather than a size tier. These leads still get a Ticket Size estimate (the smallest configured tier, clearly labeled — see [Ticket Size](#ticket-size)), but their Metrics/Forecast tier-breakdown numbers group under "Unknown" rather than a real tier. Editing the lead's `size` field to a real tier value corrects this.
- Table view mobile density/readability may still need additional tuning.
- The desktop trackpad "natural scroll" fix over the kanban board (2.4.95) was built and verified in a Linux/headless-Chromium sandbox that can't fully replicate real trackpad-driver behavior (macOS Safari/WebKit, Windows Precision Touchpad). If scrolling still misbehaves over a card on your real machine after this update, report it — it needs confirmation on real hardware, not just assumed fixed.
- There is no country filter in the UI (corrected during the 2026-07-27 documentation audit — this bullet previously described one that doesn't exist; `FilterBar.tsx` filters only on region and industry). The real, permanent limitation: `country` was validated on write but silently never persisted or editable anywhere in the app until 2.4.98 fixed it — every lead created before that fix has no recoverable `country` value (there was nothing to backfill it from; the field was simply never stored). 1,730 CSV-imported leads from the same date were backfilled as part of that fix, but any other pre-2.4.98 lead's `country` is permanently blank unless corrected manually.
- Outreach template deletion isn't implemented — only create and edit.
- Deals only affect the CogMap-style Forecast pipeline (`ticketSizeEstimate`-based revenue). Seyu's forecast is built entirely from its own `pricingByCompany` data and doesn't yet look at a lead's Deals — a Seyu deal is saved and shown on the card/detail, but won't change Seyu's Forecast numbers.
- Follow-up reminders and the Win probability figure are shared across the whole team, not per-rep — this app has no individual user/ownership model yet, so there's no personal "my follow-ups" queue.
- Qualification fields are informational only and can't yet be required before a lead moves to ENGAGED/PROPOSAL.
- Duplicate-lead merging (2.4.97) is permanent — the losing lead is deleted, not archived, with no undo. It was verified via a real database-backed test suite and a live dev-server smoke check, but the authenticated click-through (opening the merge screen and confirming a real merge as a signed-in super admin) hasn't been walked through in a browser yet — the first real merge should be watched closely.
- **The new controlled sports-industry taxonomy (2.4.109 — `sportCode`, `orgTypeCode`, `businessUnitCode`, `genderCode`, `demographicCodes`, `competitionLevelCode`, `cityName`, `parentOrgId`/`parentOrgName`, `relationshipToParent`, `canonicalLeadName`) has no UI yet.** You can't see, filter, or edit these fields anywhere in the app today — they're API-only (`PUT /api/leads/[id]`, see [Update Lead](#update-lead)), written by the enrichment agent. No existing lead has any of them set until it's individually classified — see `docs/LEAD_TAXONOMY_MIGRATION_PLAN.md` for the plan to backfill the ~2,725 existing leads. A UI to view/edit/filter on these fields is a real, disclosed gap, not yet scheduled.

---

## Escalation

If the board is empty or health checks fail:
1. Check `/api/health` for database and latency status.
2. Check `/api/admin/cron-status` for agent run health.
3. Review MongoDB Atlas connectivity and network access.
4. Inspect Vercel deployment logs for build or runtime errors.
