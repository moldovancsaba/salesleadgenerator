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

## CogMap Strategic Sales Research

```text
Your objective is to build a high-quality outbound sales database for CogMap, a cognitive performance platform for football (soccer) organizations.

Do not simply create a list of soccer clubs. Your goal is to identify organizations with the highest probability of purchasing a club-wide cognitive development platform.

Think like a senior B2B market researcher focused on finding the best commercial opportunities.

About CogMap

CogMap helps football organizations understand how players think, not only how they perform physically.

The platform supports:
- Cognitive assessment
- Player profiling
- Coach dashboards
- Club-wide benchmarking
- Player development
- Talent identification
- Recruitment support
- Parent-facing reports
- Cognitive tournaments (cogLeague)
- Longitudinal player tracking

CogMap is sold as an annual organization-wide solution, typically across multiple teams, age groups, or an entire academy.

Primary Target

Prioritize large grassroots football organizations, not famous professional clubs.

The best opportunities are usually:
- Independent youth soccer clubs
- Community football organizations
- Large nonprofit clubs
- Regional football associations
- Multi-campus academies
- High-performance youth development organizations

A community club with 2,000 youth players is generally a far better prospect than a professional academy with 250 academy players.

Professional academies may be included but should not dominate the results.

Geography

Focus on major metropolitan regions and especially their surrounding suburbs (within approximately 20 km / 15 miles).

Example:
Instead of only searching Toronto, also search:
Mississauga, Brampton, Vaughan, Markham, Richmond Hill, Oakville, Burlington, Ajax, Pickering, Whitby, Milton and other surrounding municipalities.

Apply the same logic globally.

Priority countries:
- USA
- Canada
- UK
- Ireland
- Australia
- New Zealand
- Germany
- Netherlands
- Belgium
- France
- Nordics

Ideal Customer Profile

Prioritize organizations showing evidence of:
- 500+ youth players (estimate if necessary)
- Multiple age groups
- Boys and girls programs
- Recreational and competitive pathways
- Academy structure
- Elite pathways (MLS NEXT, ECNL, Girls Academy, NPL, DPL, USYS, etc.)
- Multiple training locations
- Full-time coaching staff
- Technical department
- Coach education
- Structured player development
- Strong parent engagement
- Modern digital presence
- Long organizational history

Do not reject organizations simply because exact player numbers are unavailable. Estimate size using available evidence.

Exclude
- Adult-only clubs
- Individual trainers
- Small private academies
- Indoor soccer centers
- Organizations with little evidence of structured youth development
- Very small clubs (<500 players unless strategically valuable)

Research Sources

Use multiple public sources:
Official websites, league websites, state or national football associations, US Youth Soccer, US Club Soccer, MLS NEXT, ECNL, Girls Academy, NPL, DPL, LinkedIn, Facebook, Instagram, Wikipedia, club annual reports, tournament registrations, coach directories, registration systems, news articles, nonprofit filings, community partnership pages.

Always cross-reference information before estimating organization size.

Collect

For every organization identify:
- Organization name
- Website
- Country
- City
- Metro area
- Estimated youth players
- Evidence supporting estimate
- Number of teams
- Programs offered
- Academy structure
- League affiliations
- Training locations
- Club history

Decision Makers

Identify whenever available:
- CEO
- Executive Director
- General Manager
- Club President
- Technical Director
- Director of Coaching
- Academy Director
- Sporting Director
- Player Development Director
- High Performance Director

Collect:
- Full name
- Position
- LinkedIn
- Public email
- Public phone (if available)

Buying Signals

Look for evidence of:
- Player development
- Coach education
- Sports science
- Technology adoption
- Performance analytics
- Innovation
- Talent identification
- Parent communication
- Long-term athlete development
- Club growth
- Sponsorship activity
- Data-driven coaching

Score Every Lead

Score every organization from 1-100 using:
- 30% Organization size
- 25% Likelihood of purchasing CogMap
- 15% Accessibility of decision makers
- 15% Innovation and technology adoption
- 10% Competitive pathway
- 5% Parent engagement

Recommend

For each lead recommend the most suitable CogMap package:
- Essential
- Performance
- Elite

Estimate:
- Rollout size
- Annual revenue opportunity
- Best first sales angle

Output Columns
- Organization
- Website
- Country
- City
- Estimated Players
- Evidence
- Programs
- League Affiliations
- Decision Makers
- Emails
- LinkedIn
- Buying Signals
- Recommended Package
- Estimated Revenue Potential
- Partnership Score (1-100)
- Priority (High/Medium/Low)
- Best Sales Angle
- Why This Organization Is A Strong Prospect

Critical Instructions

Do not prioritize famous clubs or professional first teams.

The objective is to identify organizations that combine:
- large player populations
- structured player development
- accessible leadership
- evidence of innovation
- strong parent communities
- commercial readiness
- long-term partnership potential

Always explain why an organization is a strong prospect.

When exact numbers are unavailable, make evidence-based estimates.

The goal is not to build a football directory.

The goal is to produce the highest-quality sales pipeline possible for CogMap, identifying organizations most likely to adopt a club-wide cognitive performance platform.
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
