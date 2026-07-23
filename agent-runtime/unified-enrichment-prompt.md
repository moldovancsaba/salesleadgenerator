# ContentCreator — Enrichment Canonical Prompt

This file is the canonical enrichment prompt template for ContentCreator. Each fixed-tenant cron job embeds a tenant-specific version of this prompt directly.

## Fixed-Tenant Contract

- One tenant per run.
- No round-robin state updates from inside the run.
- API routing uses `brand=<tenantId>`, not `board=<board>`.
- Use list-based verification only.
- On API rate-limit or failover error: stop immediately and report. Do NOT spam retries.
- PUT ONLY changed fields.

## Required Prompt Sections

1. Tenant block
2. Tenant description / positioning
3. Field priority list
4. Critical rules block
5. Instructions block
6. Verification block
7. Report format block

## Tenant Block Template

```text
- Tenant ID: <tenantId>
- API base: <apiBase>
- Board: <board>
- Scope: <scope>
- Brand fields: <proField>, <conField>
- Forbidden fields: <forbiddenFields>
```

## CogMap Enrichment Template

```text
1. recommended_tier
2. estimated_participants
3. revenue_model
4. estimated_annual_revenue_usd
5. product_fit_notes
```

## Seyu Enrichment Template

```text
## SEYU ENRICHMENT PRIORITY
1. Optional `pricingByCompany` blocks by company name, using keys: upfront_eur, monthly_eur, annual_fee_eur, currency, pricing_model, discount_percent, revenue_share_percent, notes. Keep them evidence-based and optional.
2. Contacts / decision-maker fields / address / phone
3. pro_for_seyu / con_for_seyu
4. value_proposition
5. ICE score / notes
```

## Enrichment Contact Priority

- Prefer marketing, partnerships, sponsorship, brand, commercial, media, or communications contacts
- Federation leads: look for commercial/marketing/brand partnership contacts rather than administrative presidents
- Broadcaster/entertainment leads: look for ad sales, partnerships, or brand-licensing contacts

## Seyu Pricing Usage

- Optional generic field is `pricingByCompany`.
- Do not invent numbers without quote or market evidence.
- Agency/sponsor searching: `revenue_share_percent: 15` when applicable.

## Verification Contract

```text
Use list-based verification ONLY:
- cogmap/seyu: GET /api/leads?brand=<tenantId>&limit=1000
- classscout-api: GET /api/programs?limit=1000
DO NOT use GET /api/leads/<id> or GET /api/programs/<id> for verification.
```

## Report Format

```text
- Mode: ENRICHMENT
- Tenant processed: {{TENANT_ID}}
- Records evaluated and enrichment score breakdown
- Records selected for enrichment
- Enrichments applied per record
- Write verifications success/failure
- Verification method used: list-based
- Records skipped and why
- API errors / rate-limit occurrences
- API health status
```

## State Policy

Do NOT update `Agents/contentcreator/state/enrichment-state.json` from inside fixed-tenant cron jobs.
