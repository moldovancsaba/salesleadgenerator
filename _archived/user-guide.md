# User Guide — Sales Lead Generator (ARCHIVED)

> **⚠️ ARCHIVED — historical snapshot, not current.** This file is superseded by `docs/OPERATOR_GUIDE.md`. Do not use this for current workflow guidance; it is kept only for historical reference. See `README.md`'s "Archived Documentation" table.

## Audience

Sales operators and researchers who use the kanban board at `https://salesleadgenerator.vercel.app`.

## Core Concepts

- **Lead**: a sales target organization with contacts, ICE score, and pipeline stage.
- **Kanban columns**: DISCOVERED → QUALIFIED → ENGAGED → PROPOSAL → WON / LOST.
- **Brand**: each pipeline is scoped by brand. Use the brand switcher in the UI to switch between CogMap and Seyu, or any configured brand.
- **ICE score**: 1–1000 score based on Impact × Confidence × Ease.
- **Sort order**: cards within each column are sorted by `sortOrder`, not by ICE score. New cards are placed at the end of the column.

## Daily Workflow

1. Open `/sales/<brand>` on mobile or desktop.
2. Review new cards in DISCOVERED.
3. Tap a card to view details, contacts, and value proposition.
4. Use actions:
   - **Accept** → promote toward QUALIFIED
   - **Decline** → move to LOST with reason
   - **Pin** → force ENGAGED
   - **Refresh** → request updated research
   - **Modify** → edit lead fields
   - **Delete** → remove lead
5. Drag cards between columns when the pipeline changes.

## Filters

- Region filter: US, CEE, MENA, or ALL
- Search: entity name, contact name, or sector
- Tenant filter: default or a custom `tenantId`

## Outreach

- Use **Outreach** from a lead detail view to compose a message quickly.
- The system supports both **email** and **LinkedIn** outreach templates.
- Templates are organization-agnostic and scoped by the selected `brand`.
- Analytics are available from `/api/outreach-templates?mode=analytics`.

## Multi-Brand / Multi-Organization Behavior

- The pipeline URL pattern is `/sales/[brand]`.
- Each brand maps to its own collection via `BRAND_CONFIG`.
- Outreach templates are organization-agnostic and scoped at runtime by `brand`.
- Existing leads without `tenantId` are still visible for the default tenant path.

## Tips

- Keep value propositions specific to the organization.
- Use pros/cons to track objections and talking points.
- Decline reasons improve future lead selection.
- Use the brand switch when working across organizations so outreach templates load correctly.

## API Integration

If you integrate with the API:

- Use `GET /api/leads?brand=<brand>` for read access.
- Use `POST /api/leads?brand=<brand>` for creating leads.
- Use `PATCH /api/leads?brand=<brand>&id=<id>` for actions.
- Use `DELETE /api/leads/[id]?brand=<brand>` to delete.
- Write and admin endpoints require `x-api-key`.

See `README.md` for example requests.
