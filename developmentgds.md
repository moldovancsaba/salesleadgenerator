# GDS Integration Audit — Sales Lead Generator

**Version:** 2.1.0

This file is based on direct file inspection, not guesswork. Evidence paths are included for every claim.

---

## Audit Scope

- `app/components/gds-provider.tsx`
- `app/card.tsx`
- `app/kanban.tsx`
- `app/sales/[brand]/page.tsx`
- `app/detail.tsx`
- `app/table.tsx`
- `app/search-learning.tsx`
- `app/page.tsx`
- `app/metrics.tsx`
- `app/globals.css`
- `app/components/unified-card.tsx`
- `app/components/ui/layout.tsx`
- `app/components/ui/index.tsx`
- `node_modules/@doneisbetter/gds/dist/index.d.ts`
- `node_modules/@doneisbetter/gds/dist/client.d.ts`

---

## GDS Usage Audit

### Confirmed GDS usage
- `app/components/gds-provider.tsx` imports:
  - `GdsProvider`
  - `GdsToastProvider`
  - `GdsNotificationProvider`
  - `GdsConfirmProvider`
  - `CommandRegistryProvider`
  - `resolveGdsThemePreset`
- Theme preset: `oceanic`
- Wired in `app/layout.tsx` via `<GDSProvider>`

### Confirmed GDS non-usage
- No GDS UI components are composed in any page or component file.
- No GDS tokens/theme values are read outside `gds-provider.tsx`.
- Available but unused GDS exports include:
  - Admin: `AdminAnalyticsTable`, `AdminDataTable`, `AdminResourceManager`, `AdminModal`
  - Layout/shell: `AppShell`, `WorkspaceHeader`, `PageHeader`, `EditorScaffold`
  - Data display: `DataTable`, `ResponsiveDataView`, `InfoCard`, `StatsStrip`
  - Forms: `AdminTextInput`, `AdminTextarea`, `AdminSelect`, `AdminCheckbox`, `AdminFormSection`, `AdminCrudForm`
  - Content ops: `ContentOpsActionBar`, `ContentOpsEditor`, `ContentOpsSection`

### GDS audit conclusion
- GDS is installed and provider-wired, but zero UI components use it.
- All UI is built with raw Mantine + inline styles + custom CSS.

---

## Hard-Coded CSS and Style Audit

### Inline styles

| File | Lines | Elements |
|------|-------|----------|
| `app/card.tsx` | 41, 59, 70, 81, 83, 95, 96, 106, 116, 130, 137 | Card container, drag handle, SVG, content wrapper, badges, DM text |
| `app/kanban.tsx` | 189, 229, 232, 260 | Board container, column container, header, column body |
| `app/sales/[brand]/page.tsx` | 247, 254, 268, 341 | Header section, filter chips, button container |
| `app/detail.tsx` | 175, 177, 179, 201, 362, 430 | Modal layout, header border, content scroll, footer border, button |
| `app/table.tsx` | CSS-in-JS block | Entire table layout, colors, spacing, media query |
| `app/search-learning.tsx` | 73, 103, 132, 146, 160, 190, 201, 217, 232, 309, 323, 333 | Paper backgrounds, card styles, hover shadow, list styles |
| `app/page.tsx` | 3, 11, 16, 24, 34 | Landing page container, inner card, headings, CTA button |
| `app/metrics.tsx` | 295 | Decline reason row border |
| `app/components/unified-card.tsx` | 66, 75 | Card hover transition, inner stack |
| `app/components/ui/layout.tsx` | 48, 75 | CardGrid gap, StatsCard background/border |

### Hard-coded colors

| File | Line | Value | Context |
|------|------|-------|---------|
| `app/kanban.tsx` | 237 | `#198754` | WON column header background |
| `app/kanban.tsx` | 237 | `#dc3545` | LOST column header background |
| `app/kanban.tsx` | 238 | `#fff` | WON/LOST header text color |
| `app/sales/[brand]/page.tsx` | 348 | `#fff` | Filter chip background |
| `app/sales/[brand]/page.tsx` | 349 | `#000` | Filter chip text color |
| `app/table.tsx` | 59 | `#f4f6f8` | Table view background |
| `app/table.tsx` | 76 | `#d7dce3` | Cell border |
| `app/table.tsx` | 78 | `#111827` | Cell text color |
| `app/table.tsx` | 83 | `#e5e7eb` | Header background |
| `app/table.tsx` | 86 | `#111827` | Header text color |
| `app/table.tsx` | 92 | `#eef2f7` | Row hover background |
| `app/search-learning.tsx` | 194 | `rgba(0,0,0,0.1)` | Card hover shadow |
| `app/layout.tsx` | 24 | `#1a1a2e` | Theme color meta |
| `app/globals.css` | 3-34 | Multiple hex values | CSS custom properties for light theme |
| `app/globals.css` | 39-55 | Multiple hex values | CSS custom properties for dark theme |

### Hard-coded spacing/typography/radii

| File | Line | Property | Value |
|------|------|----------|-------|
| `app/card.tsx` | 44-46 | gap/padding/radius | `0.5rem`, `0.7rem 0.75rem`, `0.5rem` |
| `app/card.tsx` | 62, 66 | padding/radius | `0.35rem`, `0.35rem` |
| `app/card.tsx` | 84, 88 | fontSize/lineHeight | `0.9rem`, `1.3` |
| `app/card.tsx` | 95, 97-98, 101 | gap/padding/radius/fontSize | `0.35rem`, `0.18rem 0.45rem`, `0.25rem`, `0.72rem` |
| `app/card.tsx` | 107-108, 111 | padding/radius/fontSize | repeated badge pattern |
| `app/card.tsx` | 117-118, 121 | padding/radius/fontSize | repeated badge pattern |
| `app/card.tsx` | 132, 134 | fontSize/lineHeight | `0.72rem`, `1.3` |
| `app/kanban.tsx` | 165-166, 170-171 | gap/padding/height/minHeight | `0.75rem`, `0.75rem`, `auto`, `0` |
| `app/kanban.tsx` | 176-177, 181-182 | gap/padding/height/minHeight | repeated board pattern |
| `app/kanban.tsx` | 201-203 | width/minWidth/maxWidth | `100%`, `unset`, `unset` |
| `app/kanban.tsx` | 208, 210-211 | borderRadius/height | `0.5rem`, `none`, `auto` |
| `app/kanban.tsx` | 214-215, 217 | minWidth/maxWidth/height | `300`, `340`, `100%` |
| `app/kanban.tsx` | 221 | borderRadius | `0.5rem` |
| `app/kanban.tsx` | 233 | padding | `0.5rem 0.75rem` |
| `app/kanban.tsx` | 263, 266-267 | padding/gap/minHeight | `0.5rem`, `0.5rem`, `0` |
| `app/sales/[brand]/page.tsx` | 248 | minHeight | `100dvh` |
| `app/sales/[brand]/page.tsx` | 258 | padding | `0.75rem` |
| `app/sales/[brand]/page.tsx` | 269 | borderRadius | `0.25rem` |
| `app/sales/[brand]/page.tsx` | 343-345 | minWidth/padding/radius | `110`, `0.3rem 0.5rem`, `0.25rem` |
| `app/sales/[brand]/page.tsx` | 347 | fontSize | `0.8rem` |
| `app/detail.tsx` | 175 | height/display/flexDirection | `100%`, `flex`, `column` |
| `app/table.tsx` | 55-67, 70, 75, 95, 98, 101, 103, 106, 111 | minHeight/padding/width/min-width/media | multiple values |
| `app/page.tsx` | 4, 9, 12, 14, 17, 25, 28, 36-37 | minHeight/padding/maxWidth/fontSize/lineHeight/radius | multiple values |
| `app/search-learning.tsx` | 201, 217, 232, 309, 323, 333 | flex/fontSize/border/padding/margin | multiple values |

### Hard-coded breakpoints

| File | Line | Value |
|------|------|-------|
| `app/kanban.tsx` | 36 | `(max-width: 767px)` |
| `app/detail.tsx` | 71 | `(max-width: 767px)` |
| `app/globals.css` | 183 | `@media (min-width: 768px)` |
| `app/table.tsx` | 101 | `@media (max-width: 767px)` |

### Custom CSS in `app/globals.css`

- CSS custom properties for light/dark themes
- Scrollbar styling
- Utility classes: `.text-balance`, `.line-clamp-2`, `.transition-colors`
- Animation: `@keyframes fadeIn`, `.card-enter`
- Kanban layout classes: `.kanban-board`, `.kanban-board--horizontal`, `.kanban-board--vertical`, `.kanban-column`, `.kanban-column--horizontal`, `.kanban-column--vertical`, `.kanban-column-body`

---

## Deliverable Tasks

### GDS Integration

- [x] G-1: Decide GDS adoption strategy: keep provider-wired, but do not rewrite UI into GDS components yet; continue Mantine-first token cleanup
- [x] G-2: Adopt GDS `DataTable` in `app/table.tsx` via `@doneisbetter/gds-admin/client`
- [ ] G-3..G-12: Migrate remaining UI surface to GDS components in place, starting with low-risk components
- [ ] G-13: If GDS is not adopted, remove `@doneisbetter/gds` dependency and provider wiring

### Design Token Unification

- [x] T-1: Create shared local design tokens for spacing, radii, typography sizes, and semantic colors
- [x] T-2: Replace all hard-coded spacing values with token references
- [x] T-3: Replace all hard-coded radii values with token references
- [x] T-4: Replace all hard-coded typography values with token references
- [x] T-5: Replace hard-coded status colors in `app/kanban.tsx` with semantic token colors
- [x] T-6: Replace hard-coded colors in `app/sales/[brand]/page.tsx` with semantic token colors
- [x] T-7: Replace hard-coded colors in `app/table.tsx` with semantic token colors
- [x] T-8: Replace hard-coded colors in `app/search-learning.tsx` with semantic token colors
- [x] T-9: Remaining `#1a1a2e` is browser `theme-color` metadata in `app/layout.tsx`, not a runtime UI style; leaving as semantic app chrome constant

### Breakpoint Centralization

- [x] B-1: Replace `(max-width: 767px)` checks in `app/kanban.tsx` and `app/detail.tsx` with shared breakpoint helper
- [x] B-2: Replace `@media (max-width: 767px)` in `app/table.tsx` with shared breakpoint helper
- [x] B-3: Replace `@media (min-width: 768px)` in `app/globals.css` with shared breakpoint helper
- [x] B-4: Remove duplicated kanban CSS classes from `app/globals.css` if inline styles or GDS replace them

### Component Extraction

- [x] C-0: Created `app/components/ui/semantic-badge.tsx` as reusable semantic badge
- [x] C-1: Created `app/components/ui/card-shell.tsx` for repeated card padding/radius/border patterns
- [x] C-2: Created `app/components/ui/column-header.tsx` for kanban column headers and wired into `app/kanban.tsx`
- [x] C-3: Created `app/components/ui/board-layout.tsx` for kanban board shell and wired into `app/kanban.tsx`
- [x] C-4: Created `app/components/ui/filter-bar.tsx` and wired into `app/sales/[brand]/page.tsx`
- [x] C-5: Created `app/components/ui/data-table.tsx` and replaced `app/table.tsx` CSS-in-JS with shared `DataTable`
- [x] C-6: Duplicated/legacy kanban CSS removed from `app/globals.css`

### Dead Style Removal

- [x] D-0: Removed duplicated kanban CSS block from `app/globals.css`
- [x] D-1: Cleaned `app/globals.css` to remove dead layout CSS while keeping still-used mobile nav, card-status, modal responsive, utility, and animation styles
- [x] D-2: Replaced remaining hard-coded colors in `app/table.tsx` and `app/sales/[brand]/page.tsx` with semantic/theme tokens
- [ ] D-3: Final cleanup of legacy inline style fallbacks after component extraction

---

## Priority Order

1. Decide GDS adoption vs removal
2. Extract shared design tokens
3. Replace highest-traffic inline styles: `app/card.tsx`, `app/kanban.tsx`, `app/table.tsx`
4. Centralize breakpoints
5. Extract reusable components
6. Remove dead styles and dependencies
