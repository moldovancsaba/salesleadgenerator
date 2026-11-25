# Apollo.io Lead & Contact Capture Integration

## Overview

Sales Haho integrates with **Apollo.io REST API v1** (`https://api.apollo.io/api/v1`) and **Apollo CSV Exports** so reps can capture contacts and organization firmographics into their workspace with deterministic deduplication and `source: "apollo"` provenance.

## Provider Prerequisites & Entitlement Matrix

1. **API Key Generation**:
   - In Apollo, navigate to **Settings → Integrations → API → API Keys** and create an API key.
   - Sales Haho passes the key exclusively in the `x-api-key` HTTP header (Apollo deprecated query/body `api_key` parameters) and stores it encrypted with AES-256-GCM in `integration_connections`.
2. **Account Health Verification (`GET /api/v1/auth/health`)**:
   - Executed before storing any key and during live connection tests. Consumes **zero Apollo credits**.
3. **Saved CRM Contacts Lookup (`POST /api/v1/contacts/search`)**:
   - Queries contacts already saved to your Apollo team workspace. Permitted on standard Apollo API keys with Contacts scope.
4. **Global Prospect Search (`POST /api/v1/mixed_people/search`)**:
   - Queries Apollo's broader B2B database. Requires an Apollo plan with API search entitlement and a **Master API Key**.
   - **Go / No-Go Gate (`GET /api/integrations/apollo/status?verify=1`)**: Sales Haho probes both endpoints automatically and displays an explicit entitlement status (`go_api`, `go_saved_contacts_only`, or `no_go_api_use_csv`). When a workspace plan restricts API search, reps can either search Saved Contacts or upload an Apollo CSV export (`preset: "apollo"`).

## Mapped Person & Organization Fields

| Outreach Attribute | Apollo API Path | Apollo CSV Header | Sales Haho Field |
| :--- | :--- | :--- | :--- |
| First Name | `first_name` | `First Name` | `contacts[].firstName` |
| Last Name | `last_name` | `Last Name` | `contacts[].lastName` |
| Country | `country` / `organization.country` | `Country` | `contacts[].country` & `lead.country` (ISO-2) |
| Company | `organization.name` / `organization_name` | `Company` | `lead.entity_name` |
| Job Title | `title` | `Title` | `contacts[].title` |
| Department | `departments[0]` | `Departments` | `contacts[].department` / `departmentOverride` |
| Industry | `organization.industry` | `Industry` | `lead.industry` & `lead.sport_or_sector` |
| Work Email | `email` (unlocked) | `Email` | `contacts[].email` |
| Personal LinkedIn | `linkedin_url` | `Person Linkedin Url` | `contacts[].linkedin` |
| Contact Phone | `phone_numbers[0].sanitized_number` | `Work Direct Phone` / `Mobile Phone` | `contacts[].phone` (E.164) |
| Company Website | `organization.website_url` | `Website` | `lead.url` |
| Company LinkedIn | `organization.linkedin_url` | `Company Linkedin Url` | `lead.companyLinkedin` |
| Company Phone | `organization.primary_phone.sanitized_number` | `Corporate Phone` | `lead.companyPhone` (E.164) |

Missing values on any candidate are surfaced prior to import and rendered as `—` in the directory rather than fabricated.

## Deduplication Behavior

Repeated imports of the same Apollo contact or organization match against existing workspace records by:
1. Organization fingerprint (`entity_name` + normalized website host + region),
2. Normalized website domain (`url`),
3. Company LinkedIn URL (`companyLinkedin`),
4. Contact primary/secondary email (`contactEmails`), or
5. Contact personal LinkedIn URL (`contacts[].linkedin`).

In **Enrich / Update** mode (`deduplicationPolicy: "update"`), new contact attributes merge into the matching contact via `mergeEnrichedContacts()` without duplicating either the organization lead or the person entry. In **Skip** mode (`deduplicationPolicy: "skip"`), repeat imports increment `skipped` with zero database writes.
