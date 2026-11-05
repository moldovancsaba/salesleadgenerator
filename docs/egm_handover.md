# Elephant Goldfish Model (EGM) — Operational Handover Specification

**Target Audience:** OpenClaw Engineering Team & Autonomous Agent Maintainers  
**Authoring System:** Sales Lead Generator (SLG) Core Architecture  
**Document Class:** System Handover & Interface Contract  
**Associated Issues:** #310, #311  

---

## 1. Executive Summary & Purpose

The **Elephant Goldfish Model (EGM)** defines a two-level operating model:
1. **Level 1 — Development EGM**: The architectural, quality-governed development workflow in the SLG repository (Antigravity). It owns schema contracts, database collections, GDS styling, and zero-tolerance quality gates.
2. **Level 2 — Operational EGM**: The autonomous execution runtime operated by **OpenClaw** and its background agents (`enrich.py`, `slg_maintain.py`, `slg_polish.py`). It owns lead discovery, contact enrichment, synthesis of grounded **value propositions**, extraction of objective **pros and cons**, and deal closing acceleration.

This document serves as the formal boundary specification and technical handover contract for the OpenClaw team to implement and run Level 2 Operational EGM tasks against SLG without manual developer intervention.

---

## 2. System Separation of Concerns

```
+-------------------------------------------------------------------------------+
|                       LEVEL 1: DEVELOPMENT EGM (SLG)                          |
|  - System of Record & Multi-Tenant Pipeline UI                                |
|  - REST APIs: /api/leads/[id], /api/sales-settings/[brand]                    |
|  - Schema Validation (lib/validate-lead.ts)                                   |
|  - Quality Gates & GDS UX Design                                              |
+-------------------------------------------------------------------------------+
                                      ▲
                                      │ HTTP PUT /api/leads/[id]?brand=[tenant]
                                      │ Header: x-api-key: [SLG_API_KEY]
                                      ▼
+-------------------------------------------------------------------------------+
|                       LEVEL 2: OPERATIONAL EGM (OPENCLAW)                     |
|  - Elephant (Context): Company settings, ICP definitions, Deal Size bands     |
|  - Goldfish (Execution): Atomic web fetch, fact extraction, pro/con scoring   |
|  - Grounding & Provenance: provledger.py, contentcheck.py, zero hallucination |
+-------------------------------------------------------------------------------+
```

### Boundary Rules
- **SLG Developers do NOT perform manual research**: Per `AGENTS.md` Rule 10, coding assistants in SLG never search for club data or issue manual enrichment updates during coding sessions.
- **OpenClaw is the automated engine**: Lead discovery, contact verification, value propositions, and pro/con extraction belong exclusively to OpenClaw.
- **Deterministic API Contracts**: SLG enforces strict validation on incoming writes. Payloads that do not conform will receive `400 Bad Request` or `422 Unprocessable Entity`.

---

## 3. Operational EGM Tasks & Payload Specifications

Operational EGM agents execute 4 core deal-acceleration tasks:

### Task 1: Grounded Value Proposition (`value_proposition`)
- **Field Name**: `value_proposition` (string)
- **Role in SLG**: Displayed prominently in the Lead Card and Lead Drawer Overview tab. Used by sales reps to immediately grasp the pitch angle.
- **Agent Rules**:
  1. Must be grounded in the verified organization's official website content (`fetched_page`).
  2. Must meet a minimum length of 12 characters.
  3. Must NOT contain HTML entities (`&amp;`, `&gt;`, `&lt;` — use plain `&`, `>`, `<`).
  4. Must pass brand forbidden-vocabulary filters (e.g. Seyu cannot use CogMap terms, EGM cannot claim sports sensor hardware).
  5. Written for a B2B sales rep deciding whether to pursue an account.

### Task 2: Structured Pros (`pro_for_organization`)
- **Field Name**: `pro_for_organization` (array of strings, e.g. `string[]`)
- **Role in SLG**: Rendered in the Discovery & Value Proposition section. Highlights clear indicators of deal viability (e.g. established budget, prominent creative leadership, active digital campaigns).
- **Validation Constraint**: **MUST be an array of strings.** Providing a single string or an array with null/numbers is rejected by `lib/validate-lead.ts`.

### Task 3: Structured Cons / Deal Risks (`con_for_organization`)
- **Field Name**: `con_for_organization` (array of strings, e.g. `string[]`)
- **Role in SLG**: Flags red flags, deal hurdles, and competitors (e.g. long procurement cycles, entrenched incumbent vendors, lack of public executive contacts).
- **Validation Constraint**: **MUST be an array of strings.**

### Task 4: Deal Closing Acceleration Signals
- **Field Names**: `tags` (`string[]`), `contacts` (`Contact[]`), `notes` (`string`).
- **Role in SLG**: Enables 1-click WhatsApp/iMessage openers, pre-call meeting briefs, and cadence acceleration.

---

## 4. API Integration Protocol

### Endpoint
```http
PUT /api/leads/{id}?brand={tenant}
Host: sales.haho.ai (or https://salesleadgenerator.vercel.app)
Content-Type: application/json
x-api-key: {SLG_API_KEY}
```

### Valid Partial Update Payload Example
```json
{
  "value_proposition": "Global creative agency partnering with luxury lifestyle brands for immersive digital installations and real-time interactive activations.",
  "pro_for_organization": [
    "Dedicated VP of Creative Technology in place",
    "Active multi-city brand activation budgets announced for Q3"
  ],
  "con_for_organization": [
    "Strict 60-day procurement onboarding process",
    "Prior agency retainer with competing studio in London"
  ],
  "tags": ["luxury-retail", "spatial-media", "q3-priority"]
}
```

### Response Codes
- `200 OK`: Lead updated successfully. Returns `{ "lead": { ... } }`.
- `400 Bad Request`: Payload validation failure (e.g. `pro_for_organization` not an array, or forbidden brand vocabulary detected).
- `401 Unauthorized / 403 Forbidden`: Invalid or missing `x-api-key`.
- `404 Not Found`: Lead ID does not exist in the tenant collection.
- `422 Unprocessable Entity`: Evidence provenance refused by exchange gate.

---

## 5. OpenClaw Agent Implementation Guide

In the OpenClaw workspace (`.openclaw/workspace/`):

1. **`enrich.py` (slg_enrich)**:
   - When calling `api("PUT", f"{SLG}/api/leads/{rid}?brand={tenant}", ...)`:
   - Extract `pro_for_organization` and `con_for_organization` as distinct bullet arrays from the local model extraction prompt.
   - Run `clean_faults()` and `contentcheck.validate()` before adding to `patch`.
   - Never write plain strings to `pro_for_organization`.

2. **`slg_polish.py`**:
   - The on-device model polish pipeline currently handles `value_proposition`.
   - If extending to `pro_for_organization`/`con_for_organization`, ensure it iterates over the array items individually or returns a parsed JSON array of strings.

3. **`provledger.py`**:
   - Record the exact source URL and timestamp for any fact extracted into the lead fields.

---

## 6. Handover Checklist & Verification

Before enabling the OpenClaw operational loop:
- [x] SLG partial PUT handler tested and verified for `value_proposition`, `pro_for_organization`, and `con_for_organization`.
- [x] Automated unit test suite passing in SLG (`tests/lib/egm-lead-contract.test.ts`).
- [x] HTML-entity sanitizer active on all SLG write endpoints.
- [ ] OpenClaw `enrich.py` prompt updated to populate `pro_for_organization` and `con_for_organization` arrays.
- [ ] OpenClaw `slg_maintain.py` verified against tenant credentials (`.env.cogmap`, `.env.seyu`, `.env.dvsc`, `.env.egm`).
