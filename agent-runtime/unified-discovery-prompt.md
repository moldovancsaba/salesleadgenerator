# ContentCreator — Discovery Canonical Prompt

This file is the canonical discovery prompt template for ContentCreator. Each fixed-tenant cron job embeds a tenant-specific version of this prompt directly.

## Fixed-Tenant Contract

- One tenant per run.
- No round-robin state updates from inside the run.
- API routing uses `brand=<tenantId>`, not `board=<board>`.
- Use list-based verification only.
- On API rate-limit or failover error: stop immediately and report. Do NOT spam retries.

## Required Prompt Sections

1. Tenant block
2. Tenant description / positioning
3. Lead or program fit rules
4. Brand-field guidance
5. Critical rules block
6. Instructions block
7. Verification block
8. Report format block

## Tenant Block Template

```text
- Tenant ID: <tenantId>
- API base: <apiBase>
- Board: <board>
- Scope: <scope>
- Brand fields: <proField>, <conField>
- Forbidden fields: <forbiddenFields>
- Min contacts: <minContacts>
```

## CogMap Forecast Template

```text
## COGMAP FORECAST RESEARCH (required)
1. recommended_tier — essential | performance | elite | multiple
2. estimated_participants — number of players/members eligible
3. revenue_model — per_participant | revenue_share | hybrid
4. estimated_annual_revenue_usd — estimated_participants × recommended_tier partner price
5. product_fit_notes — why this tier/model fits this org
```

## CogMap ICP Guidance

```text
## COGMAP DISCOVERY FOCUS
Target large youth soccer clubs and professional club academies in US large cities and neighborhoods.

Priority segments:
1. Large youth soccer clubs — 500+ players, multiple teams, academy programs, directors of coaching.
2. Professional club academies — MLS, USL, NWSL, CPL, and European pro club academies.
3. US large cities and neighborhoods — concentrated youth soccer markets with localized delivery opportunity.

Fit signals:
- team-wide testing
- coach insights
- parent-facing reports
- talent ID
- player development
- cognitive profiling
- academy differentiation

Skip small recreational-only programs unless one of these signals is clearly present.
```

## Seyu Positioning Template

```text
## WHAT SEYU ACTUALLY IS
Seyu is a fan engagement and marketing agency. Seyu helps brands activate at sports and entertainment properties. Seyu designs and executes fan-facing campaigns. Core value is agency/strategy/creative/sponsorship packaging/brand integration/fan data capture.
```

## Seyu Company-Specific Pricing Template

```text
## SEYU FORECAST RESEARCH (optional, company-specific pricing)
Optional generic field: `pricingByCompany` object keyed by company name.
Each pricing block may include: upfront_eur, monthly_eur, annual_fee_eur, currency, pricing_model, discount_percent, revenue_share_percent, notes.
Rules: evidence-only, no invented numbers. Agency/sponsor searching can add revenue_share_percent 15.
```

## Verification Contract

```text
Use list-based verification ONLY:
- cogmap/seyu: GET /api/leads?brand=<tenantId>&limit=1000
- classscout-api: GET /api/programs?limit=1000
DO NOT use GET /api/leads/<id> or GET /api/programs/<id> for verification.
```

## Report Format

```text
- Mode: DISCOVERY
- Tenant processed: {{TENANT_ID}}
- Entities found / posted / skipped
- Write verifications
- Verification method used: list-based
- API errors / rate-limit occurrences
- Current DB stats
```

## State Policy

Do NOT update `Agents/contentcreator/state/discovery-state.json` from inside fixed-tenant cron jobs.
