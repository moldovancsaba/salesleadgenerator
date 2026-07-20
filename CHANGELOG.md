# Changelog — Sales Lead Generator

## 2.1.0

Current production version. Baseline for this documentation set.

### Added
- Brand-parameterized API: `/api/leads?brand=cogmap|seyu`
- Single frontend pipeline page: `/sales/[brand]`
- Mobile-first kanban board with responsive vertical stack on narrow screens
- Pointer-based drag-and-drop with ghost preview, pointer-capture cleanup, and opacity cleanup
- Collapsible kanban columns with per-column expand/collapse controls
- Live kanban column lead counts in headers, e.g. `Discovered (258)`
- Country-based filter UI derived from lead data
- ICE/name sort controls with asc/desc for kanban and table view
- Table view simplified to Name, Score, Status for mobile readability
- Table view contrast fix: dark text on light background
- Detail modal full-screen behavior on mobile via `matchMedia`
- Header/filter wrapping for narrow viewports
- PWA manifest alignment with app start URL and scope
- Mobile/PWA layout fixes: `minHeight: 100dvh`, `overflow: auto`, wrapped controls
- Action feedback toasts for mutations in lead detail modal
- Shared retry utility for transient API failures
- Validation smoke tests via `npm run test:smoke`

### Changed
- Tenant filter defaults to `default` and includes legacy docs without `tenantId`
- Lead contacts are canonical; top-level contact fields are merged into `contacts[]` on write, then cleared from list/detail responses where possible
- Drag affordance enlarged; whole card participates in pointer drag flow
- Card selection state is cleaned up after drag end/cancel
- Won/Lost column headers use green/red header treatment

### Known Issues
- Full `next build` may OOM in limited local environments; use `tsc --noEmit` for type verification
- PWA pinch-zoom behavior is tightened but may still need further refinement
- Table view mobile density/readability may still need additional tuning
- Country filter population depends on lead `country` data; sample data may be missing populated values
- Test coverage is limited to validation smoke tests; API route tests remain TODO

---

## Unreleased

Future work is tracked in `roadmap.md` and `PROPOSAL.md`.
