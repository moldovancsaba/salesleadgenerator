# Agent Runtime Artifacts

These files define the ContentCreator research and enrichment behavior used by the OpenClaw agent runtime that feeds this SalesLeadGenerator app. They live under `agent-runtime/` for operator/debug access, but canonical maintenance remains in the runtime source tree.

- `tenants.json` — tenant contracts, brand fields, enrichment criteria, contact enrichment policy
- `unified-discovery-prompt.md` — canonical prompt template for discovery runs
- `unified-enrichment-prompt.md` — canonical prompt template for enrichment runs
- `schema-mapper.js` — tenant-aware payload mapper and anti-contamination gate for writes

Main runtime repo location:
`Agents/contentcreator/`
