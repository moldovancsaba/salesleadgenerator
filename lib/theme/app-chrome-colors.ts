// Browser/OS chrome colors for app/layout.tsx (issue #221). Lives under
// lib/theme/ for the same reason as quote-pdf-colors.ts: gds-compliance's
// `forbidden-color` rule exempts any path with a `theme/` or `tokens/`
// segment, and this is the approved home for a raw color literal.
//
// Why a literal and not a GDS token: `<meta name="theme-color">` and the PWA
// manifest are read by the browser and the operating system (address bar,
// task switcher, installed-app splash), never by the page's CSS, so a
// `var(--gds-*)` custom property cannot resolve there.
//
// Keep themeColor identical to `theme_color` in public/manifest.json — JSON
// cannot import this module, so tests/lib/app-chrome-colors.test.ts asserts
// the two stay in sync.
export const APP_CHROME_COLORS = {
  themeColor: '#1a1a2e',
} as const;
