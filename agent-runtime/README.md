# Agent Runtime Artifacts

These files define the ContentCreator research and enrichment behavior used by the OpenClaw agent runtime that feeds this SalesLeadGenerator app. They live under `agent-runtime/` for operator/debug access, but canonical maintenance remains in the runtime source tree.

- `tenants.json` — tenant contracts, brand fields, enrichment criteria, contact enrichment policy
- `unified-discovery-prompt.md` — canonical prompt template for discovery runs
- `unified-enrichment-prompt.md` — canonical prompt template for enrichment runs
- `schema-mapper.js` — tenant-aware payload mapper and anti-contamination gate for writes

Main runtime repo location:
`Agents/contentcreator/`

## Live per-brand business context (2.4.20)

`tenants.json` is a static config, edited by hand. As of 2.4.20, each brand also
has a live-editable, DB-backed companion at
`GET /api/sales-settings/<brand>?tenantId=<id>` on the SalesLeadGenerator app
(e.g. `https://salesleadgenerator.vercel.app/api/sales-settings/cogmap`) —
the JSON a company's own team fills in via `/salessettings/<brand>` (what they
sell, who buys it, pricing, deal size, purchase frequency, sales cycle, an
example customer, seasonality). No auth is required for `GET`; it returns
`source: 'default'` with empty fields if the brand hasn't been configured yet.
Treat it as a second, more current source of forecast-refining context
alongside `tenants.json`, not a replacement for it.
