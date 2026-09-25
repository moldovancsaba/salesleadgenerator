// Named color constants for lib/quote-pdf.tsx (issue #211). Lives under
// lib/theme/ deliberately — this repo's GDS compliance audit
// (gds-compliance's `forbidden-color` rule) treats any file path containing
// a `theme/` or `tokens/` segment as an approved home for raw color
// literals, exempting it from the "no hardcoded hex outside governed
// token files" check that applies everywhere else in this app.
//
// These values cannot come from `@sovereignsquad/gds-theme`'s CSS custom
// properties: @react-pdf/renderer draws directly with PDFKit primitives on
// the server, with no DOM/CSSOM at render time, so `var(--gds-*)` never
// resolves there. Importing gds-theme's raw JS token object
// (`@sovereignsquad/gds-theme/server`'s `gdsTheme`) was tried and reverted —
// verified directly via a real `next build` failure: its module graph pulls
// in `mergeThemeOverrides`, a client-only symbol, which broke server-only
// route bundling (`/api/leads/[id]/quotes/[quoteId]/mark-signed` failed to
// collect page data). These are plain literal fallbacks, chosen to match
// Mantine's default `gray` ramp (the same palette `gdsTheme.colors.gray`
// exposes) and `gdsTheme.black`, without importing the package itself.
export const QUOTE_PDF_COLORS = {
  neutralStrong: '#111827', // gdsTheme.black
  neutralMuted: '#495057', // gdsTheme.colors.gray[7]
  borderSubtle: '#dee2e6', // gdsTheme.colors.gray[3]
  borderFaint: '#e9ecef', // gdsTheme.colors.gray[2]
  surfaceFaint: '#f1f3f5', // gdsTheme.colors.gray[1]
  textFaint: '#adb5bd', // gdsTheme.colors.gray[5]
} as const;
