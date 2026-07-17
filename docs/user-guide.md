# User Guide — Sales Lead Generator

## Audience

Sales operators and researchers who use the kanban board at `https://salesleadgenerator.vercel.app`.

## Core Concepts

- **Lead**: a sales target organization with contacts, ICE score, and pipeline stage.
- **Kanban columns**: DISCOVERED → QUALIFIED → ENGAGED → PROPOSAL → WON / LOST.
- **Brand**: each pipeline is scoped by brand. Use the brand switcher in the UI.
- **ICE score**: 1–1000 score based on Impact × Confidence × Ease.

## Daily Workflow

1. Open `/sales/<brand>` on mobile or desktop.
2. Review new cards in DISCOVERED.
3. Tap a card to view details, contacts, and value proposition.
4. Use actions:
   - **Accept** → move toward QUALIFIED
   - **Decline** → move to LOST with reason
   - **Pin** → force ENGAGED
   - **Refresh** → request updated research
   - **Modify** → edit lead fields
   - **Delete** → remove lead
5. Drag cards between columns when the pipeline changes.

## Filters

- Region filter: US, CEE, MENA, or ALL
- Search: entity name, contact name, or sector
- Outreach filters: template industry/channel + brand-specific defaults

## Outreach

- Use **Outreach** from a lead detail view to compose message quickly.
- The system supports both **email** and **LinkedIn** outreach templates.
- Templates can be organization-specific; use the brand switch to load the correct set.
- Analytics are available from the templates API for usage tracking.

## Multi-Brand / Multi-Organization Behavior

- The pipeline URL pattern is `/sales/[brand]`.
- Each brand gets its own lead namespace in the database.
- Existing leads without `tenantId` are still visible for the default tenant.

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

See README.md for example requests.
