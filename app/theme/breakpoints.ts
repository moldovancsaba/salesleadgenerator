/**
 * Centralized breakpoints for Sales Lead Generator.
 *
 * Source of truth for responsive behavior.
 * Keep CSS media queries in sync with these values.
 */

export const breakpoints = {
  mobileMax: 639,
  mobileLandscapeMin: 640,
  mobileLandscapeMax: 767,
  tabletPortraitMin: 768,
  tabletPortraitMax: 1024,
  tabletLandscapeMin: 1025,
  tabletLandscapeMax: 1279,
  desktopMin: 1280,
  cardGridMinWidth: 300,
} as const;

export type BreakpointKey = keyof typeof breakpoints;
