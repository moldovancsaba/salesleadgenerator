# Operator Guide — Sales Lead Generator

**Version:** 2.4.9  
**App:** https://salesleadgenerator.vercel.app

---

## Audience

Pipeline operators and sales researchers who manage leads in the kanban board or integrate via the API.

---

## Daily Workflow

DISCOVERED and QUALIFIED are auto-managed columns: a lead is placed and sorted purely by its ICE score (QUALIFIED at 500+, otherwise DISCOVERED; always high to low). Dragging a card out to ENGAGED/PROPOSAL/WON/LOST (or an Accept/Decline/Pin action) hands that lead to manual, user-controlled placement and ordering permanently — it's never auto-moved again even if its score later changes.

1. Open `/sales/<brand>` on mobile or desktop.
2. Review new cards in DISCOVERED.
3. Tap a card to view details, contacts, and value proposition.
4. Use actions:
   - Accept → marks the lead `status: 'qualified'` and increments its feedback/acceptance counters; it does **not** move the card — placement is still driven purely by ICE score for DISCOVERED/QUALIFIED leads (see above)
   - Decline → move to LOST with reason
   - Pin → force ENGAGED
   - Refresh → request updated research
   - Modify → edit lead fields
   - Delete → remove lead
5. Drag cards between columns when the pipeline changes.

---

## Filters and Search

- No filter UI exists in the current frontend — the Region/Status dropdowns were removed entirely in 2.4.0. The header has only the view-mode selector and a predictive search bar.
- Search matches entity name, sector, and contact name (predictive dropdown under the header).
- No manual sort control exists (the 2.4.3 header's Asc/Desc button was removed — it never actually sorted anything). DISCOVERED and QUALIFIED always sort by ICE score, high to low; ENGAGED/PROPOSAL/WON/LOST sort by the order the user has arranged them in.
- Tenant filter (`?tenantId=`) exists in the API only; there is no tenant, region, or country filter control anywhere in the UI.

---

## Outreach

- Open a lead detail modal and use Outreach to compose a message.
- Supported channels: email and LinkedIn.
- Templates are organization-agnostic and scoped by brand.
- Analytics are available via `/api/outreach-templates?mode=analytics`.

---

## API Integration

Base URL: `https://salesleadgenerator.vercel.app`

### Read Leads
```bash
curl "https://salesleadgenerator.vercel.app/api/leads?brand=cogmap&limit=100"
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
    "decision_maker_name": "Jordan Smith",
    "decision_maker_title": "Academy Director",
    "decision_maker_contact": "jordan@example.com",
    "contact_phone": "+1 555 0100",
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

### Update Lead
```bash
curl -X PUT "https://salesleadgenerator.vercel.app/api/leads/<LEAD_ID>?brand=cogmap" \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_API_KEY" \
  -d '{"decision_maker_name": "New Name"}'
```

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

These require API key auth.

---

## Known Issues and Limitations

- Full `next build` may OOM in limited local/sandboxed environments; use `tsc --noEmit` for type verification there. Vercel's production build environment is unaffected.
- As of 2.2.1, pinch-zoom prevention and PWA installability were fixed at the root cause (missing icon files, viewport-meta-only zoom lock, no service worker — see `CHANGELOG.md`). Pinch-zoom lock was confirmed working on a real device on 2026-07-23; PWA installability and the separate iOS focus-zoom mechanism (GDS's theme-level `Input.vars` fix, 2.4.10) were both confirmed working on a real device as of 2.4.18.
- Table view mobile density/readability may still need additional tuning.
- Country filter population depends on lead `country` data; some datasets may need backfill from `region`.
- Test coverage has grown (35 unit tests + a 5-check smoke suite as of 2.4.8, up from 33/4 at 2.2.0) but is still concentrated on shared validation/scoring/dedup logic; full API route integration tests remain TODO.
- ~~The dedicated `/api/outcome-logs` endpoint currently reads/writes a different MongoDB collection than the rest of the outcome-logging system~~ **Fixed in 2.2.3**: a production database check (`outcomeLogs`: 0 docs vs `outcomelogs`: 2,276 docs, latest activity same day) confirmed `outcomelogs` is the real collection; `/api/outcome-logs` now reads/writes it.
- ~~Three lead-listing endpoints (`/api/leads`, `/api/search`, `/api/leads/columns`) use three different pagination shapes~~ **Unified in 2.4.7**: all three now return `hasMore`/`nextCursor` and support cursor pagination. `/api/leads` keeps its legacy `page`/`limit`/`totalPages` fields alongside the new ones — `cursor` is opt-in, so the research agent's existing one-shot `?limit=1000` listing call is unaffected. `/api/search` renamed `results` to `leads` and added a real `count`; cursor pagination works when a specific `brand` is given, and stays a flat capped list when searching all brands at once (no single resumable cursor across independently-sorted collections). As of 2.2.2, `/api/leads`'s `total` field means the real total across all pages (matching `totalPages`); the per-page count is `returned`.
- ~~The pro/con value-proposition fields were named per-brand (`pro_for_cogmap`/`pro_for_seyu`)~~ **Fixed in 2.3.0**: both brands now share one organization-agnostic field, `pro_for_organization`/`con_for_organization`. This is a breaking API contract change — old field names are no longer read or written anywhere, by design (no fallback). All 900 existing production documents were migrated in place before the code shipped.

---

## Escalation

If the board is empty or health checks fail:
1. Check `/api/health` for database and latency status.
2. Check `/api/admin/cron-status` for agent run health.
3. Review MongoDB Atlas connectivity and network access.
4. Inspect Vercel deployment logs for build or runtime errors.
