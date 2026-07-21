/**
 * Shared design tokens for Sales Lead Generator.
 *
 * These values are centralized so UI files can use tokens
 * instead of hard-coded spacing, typography, and radii.
 */

export const tokens = {
  spacing: {
    xs: '0.25rem',
    sm: '0.5rem',
    md: '0.75rem',
    lg: '1rem',
    xl: '1.5rem',
    '2xl': '2rem',
  } as const,
  radii: {
    sm: '0.25rem',
    md: '0.5rem',
    lg: '0.75rem',
    xl: '1rem',
  } as const,
  typography: {
    xs: '0.72rem',
    sm: '0.8rem',
    base: '0.9rem',
    lg: '1rem',
    xl: '1.5rem',
    '2xl': '2rem',
  } as const,
  lineHeights: {
    tight: 1.2,
    normal: 1.3,
    relaxed: 1.5,
  } as const,
} as const;

export type TokenSpacing = keyof typeof tokens.spacing;
export type TokenRadius = keyof typeof tokens.radii;
export type TokenTypography = keyof typeof tokens.typography;
export type TokenLineHeight = keyof typeof tokens.lineHeights;
