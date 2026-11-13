// Campaign palette ownership. Shared by the editor, public page and stored defaults.
// This module contains only data and a type-only import, so server and client consumers
// share the same preset values without importing a client theme runtime.
import type { LandingPageDesignConfig } from '../landing-page-schema';

export const LANDING_THEME_PRESETS: Record<LandingPageDesignConfig['themePreset'], LandingPageDesignConfig> = {
  dark_emerald: {
    themePreset: 'dark_emerald',
    primaryColor: '#00a862',
    accentColor: '#fbbf24',
    backgroundColor: '#07080a',
    cardBackgroundColor: '#0f1117',
    textColor: '#f3f4f6',
  },
  gold_luxury: {
    themePreset: 'gold_luxury',
    primaryColor: '#f59e0b',
    accentColor: '#10b981',
    backgroundColor: '#0c0a09',
    cardBackgroundColor: '#1c1917',
    textColor: '#fafaf9',
  },
  indigo_tech: {
    themePreset: 'indigo_tech',
    primaryColor: '#6366f1',
    accentColor: '#38bdf8',
    backgroundColor: '#0b0f19',
    cardBackgroundColor: '#111827',
    textColor: '#f9fafb',
  },
  slate_minimal: {
    themePreset: 'slate_minimal',
    primaryColor: '#3b82f6',
    accentColor: '#60a5fa',
    backgroundColor: '#090d16',
    cardBackgroundColor: '#151c2c',
    textColor: '#f1f5f9',
  },
  crimson_sport: {
    themePreset: 'crimson_sport',
    primaryColor: '#dc2626',
    accentColor: '#f59e0b',
    backgroundColor: '#0a0505',
    cardBackgroundColor: '#180c0c',
    textColor: '#fef2f2',
  },
};
