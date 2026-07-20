'use client';

import {
  GdsProvider,
  GdsToastProvider,
  GdsNotificationProvider,
  GdsConfirmProvider,
  CommandRegistryProvider,
  resolveGdsThemePreset,
} from '@doneisbetter/gds/client';
import { ReactNode } from 'react';

const theme = resolveGdsThemePreset('oceanic');

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
