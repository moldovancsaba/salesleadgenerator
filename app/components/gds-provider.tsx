'use client';

import {
  GdsProvider,
  GdsToastProvider,
  GdsNotificationProvider,
  GdsConfirmProvider,
  CommandRegistryProvider,
  createPublicBrandTheme,
} from '@doneisbetter/gds/client';
import { ReactNode } from 'react';
import { getModuleTheme, resolveModuleTone } from './theme-helpers';

/**
 * GDS Theme Configuration for CogMap
 * Based on sovereign squad GDS with semantic tones
 */
const theme = createPublicBrandTheme({
  flatSurfaces: true,
  overrides: {
    primaryColor: 'ingress',
    primaryShade: { light: 6, dark: 4 },
    fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
    fontFamilyMonospace: 'Monaco, Courier, monospace',
    defaultRadius: 'md',
    colors: {
      dark: ['#C9D1D9', '#B0BAC5', '#8B949E', '#6E7681', '#484F58', '#30363D', '#21262D', '#161C24', '#0F141B', '#0B0F14'],
      ingress: ['#DBEAFE', '#BFDBFE', '#93C5FD', '#60A5FA', '#3B82F6', '#2563EB', '#1D4ED8', '#1E40AF', '#10243F', '#0B1727'],
      synthesis: ['#E0E7FF', '#C7D2FE', '#A5B4FC', '#818CF8', '#6366F1', '#4F46E5', '#4338CA', '#3730A3', '#1A1D4A', '#11142F'],
      knowmore: ['#D1FAE5', '#A7F3D0', '#6EE7B7', '#34D399', '#10B981', '#059669', '#047857', '#065F46', '#0F2D27', '#081C18'],
      strategy: ['#EDE9FE', '#DDD6FE', '#C4B5FD', '#A78BFA', '#8B5CF6', '#7C3AED', '#6D28D9', '#5B21B6', '#24163F', '#140D24'],
      checklist: ['#E0F2FE', '#BAE6FD', '#7DD3FC', '#38BDF8', '#0EA5E9', '#0284C7', '#0369A1', '#075985', '#102838', '#091822'],
      tactical: ['#CCFBF1', '#99F6E4', '#5EEAD4', '#2DD4BF', '#14B8A6', '#0D9488', '#0F766E', '#115E59', '#102D2A', '#091A18'],
      review: ['#FEF3C7', '#FDE68A', '#FCD34D', '#FBBF24', '#F59E0B', '#D97706', '#B45309', '#92400E', '#3B2A12', '#24190B'],
      neutral: ['#F5F5F5', '#E5E5E5', '#D4D4D4', '#A3A3A3', '#737373', '#525252', '#404040', '#262626', '#171717', '#0A0A0A'],
    },
    fontSizes: {
      xs: '0.75rem',
      sm: '0.875rem',
      md: '1rem',
      lg: '1.125rem',
      xl: '1.25rem',
    },
    headings: {
      fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif',
      fontWeight: '700',
      sizes: {
        h1: { fontSize: '2rem', lineHeight: '1.1' },
        h2: { fontSize: '1.5rem', lineHeight: '1.2' },
        h3: { fontSize: '1.25rem', lineHeight: '1.25' },
        h4: { fontSize: '1.125rem', lineHeight: '1.4' },
      },
    },
    components: {
      Button: {
        defaultProps: {
          radius: 'md',
          fw: 600,
        },
        styles: (_theme: any, props: Record<string, any>) => {
          const tone = resolveModuleTone(props.color);
          const toneTheme = getModuleTheme(tone);
          return {
            root: {
              ...(props.variant === 'filled' && { background: toneTheme.color }),
              ...(props.variant === 'light' && {
                background: toneTheme.background,
                border: `1px solid ${toneTheme.border}`,
              }),
              color: 'var(--text-primary)',
            },
          };
        },
      },
      Card: {
        defaultProps: {
          radius: 'md',
          withBorder: true,
          padding: 'md',
        },
        styles: {
          root: {
            backgroundColor: 'var(--surface-base)',
            borderColor: 'var(--border-primary)',
            color: 'var(--text-primary)',
          },
        },
      },
      Badge: {
        defaultProps: {
          radius: 'sm',
          variant: 'light',
          fw: 600,
        },
      },
      Text: {
        defaultProps: {
          size: 'sm',
        },
        styles: {
          root: {
            color: 'var(--text-primary)',
          },
        },
      },
      Title: {
        defaultProps: {
          fw: 700,
        },
        styles: {
          root: {
            color: 'var(--text-primary)',
            letterSpacing: 0,
          },
        },
      },
      Input: {
        styles: {
          input: {
            backgroundColor: 'var(--surface-elevated)',
            border: '1px solid var(--border-primary)',
            color: 'var(--text-primary)',
          },
        },
      },
    },
  },
});

export function GDSProvider({ children }: { children: ReactNode }) {
  return (
    <GdsProvider theme={theme} defaultColorScheme="auto">
      <GdsConfirmProvider>
        <GdsToastProvider>
          <GdsNotificationProvider>
            <CommandRegistryProvider>
              {children}
            </CommandRegistryProvider>
          </GdsNotificationProvider>
        </GdsToastProvider>
      </GdsConfirmProvider>
    </GdsProvider>
  );
}
