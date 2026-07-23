# Operator Guide — Sales Lead Generator

**Version:** 2.2.0  
**App:** https://salesleadgenerator.vercel.app

---

## Audience

Pipeline operators and sales researchers who manage leads in the kanban board or integrate via the API.

---

## Daily Workflow

1. Open `/sales/<brand>` on mobile or desktop.
2. Review new cards in DISCOVERED.
3. Tap a card to view details, contacts, and value proposition.
4. Use actions:
   - Accept → promote toward QUALIFIED
   - Decline → move to LOST with reason
   - Pin → force ENGAGED
   - Refresh → request updated research
   - Modify → edit lead fields
   - Delete → remove lead
5. Drag cards between columns when the pipeline changes.

---

## Filters and Search

- Country filters are available in the pipeline UI and are visible by default.
- Search matches entity name, sector, and contact name.
- Sort by ICE score or name, with asc/desc order.
- Tenant filter exists in the API; current UI focus is on brand and country.

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
    "pro_for_cogmap": ["Benefit 1", "Benefit 2"],
    "con_for_cogmap": ["Objection 1"],
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
- PWA pinch-zoom behavior is tightened but may still need further refinement.
- Table view mobile density/readability may still need additional tuning.
- Country filter population depends on lead `country` data; some datasets may need backfill from `region`.
- Test coverage has grown (33 unit tests + a 4-check smoke suite as of 2.2.0) but is still concentrated on shared validation/scoring/dedup logic; full API route integration tests remain TODO.
- The dedicated `/api/outcome-logs` endpoint currently reads/writes a different MongoDB collection than the rest of the outcome-logging system due to a case-sensitivity mismatch (`outcomeLogs` vs `outcomelogs`) — its GET response may not reflect the real outcome history until this is resolved (requires a database check before fixing; do not assume it's safe to just rename).
- Three lead-listing endpoints (`/api/leads`, `/api/search`, `/api/leads/columns`) use three different pagination shapes; `/api/leads`'s `total` field means "count on this page," not the real total across all pages.

---

## Escalation

If the board is empty or health checks fail:
1. Check `/api/health` for database and latency status.
2. Check `/api/admin/cron-status` for agent run health.
3. Review MongoDB Atlas connectivity and network access.
4. Inspect Vercel deployment logs for build or runtime errors.
