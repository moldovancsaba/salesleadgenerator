'use client';

import { useEffect } from 'react';
import { notifications } from '@mantine/notifications';

/**
 * PWA lifecycle controller:
 * 1. Belt-and-suspenders WebKit zoom gesture lock.
 * 2. Service worker registration & update notification.
 * 3. Online/offline connection state tracking with polite user notifications.
 */
export function PwaSetup() {
  useEffect(() => {
    const preventGesture = (event: Event) => {
      event.preventDefault();
    };

    const preventMultiTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    // gesturestart/gesturechange/gestureend are WebKit-only (Safari); harmless no-ops elsewhere.
    document.addEventListener('gesturestart', preventGesture);
    document.addEventListener('gesturechange', preventGesture);
    document.addEventListener('touchmove', preventMultiTouchMove, { passive: false });

    // Online/offline connection monitoring
    const handleOnline = () => {
      notifications.show({
        id: 'pwa-network-status',
        title: 'Online',
        message: 'Connection restored. CRM pipelines and cadence tasks are live.',
        color: 'teal',
        autoClose: 3000,
      });
    };

    const handleOffline = () => {
      notifications.show({
        id: 'pwa-network-status',
        title: 'Offline Mode',
        message: 'Connection lost. Operating in offline shell mode.',
        color: 'orange',
        autoClose: 5000,
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Service worker registration
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          registration.addEventListener('updatefound', () => {
            const installingWorker = registration.installing;
            if (!installingWorker) return;

            installingWorker.addEventListener('statechange', () => {
              if (
                installingWorker.state === 'installed' &&
                navigator.serviceWorker.controller
              ) {
                notifications.show({
                  id: 'pwa-update-ready',
                  title: 'Update Available',
                  message: 'A new version of Sales Lead Generator is installed. Reload to update.',
                  color: 'indigo',
                  autoClose: false,
                });
              }
            });
          });
        })
        .catch((error) => {
          console.error('Service worker registration failed:', error);
        });
    }

    return () => {
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('touchmove', preventMultiTouchMove);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return null;
}
