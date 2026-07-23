'use client';

import { useEffect } from 'react';

/**
 * Belt-and-suspenders zoom lock and service-worker registration.
 *
 * The viewport meta tag (maximum-scale/user-scalable) and the
 * touch-action CSS rule in globals.css handle zoom prevention in the
 * vast majority of cases, but iOS Safari has historically had edge
 * cases (older versions, certain scroll containers) where a pinch
 * gesture still gets through either layer. This adds a final JS-level
 * guard: WebKit's legacy gesture events are cancelled outright, and any
 * touchmove with more than one active touch point is prevented.
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

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('Service worker registration failed:', error);
      });
    }

    return () => {
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('touchmove', preventMultiTouchMove);
    };
  }, []);

  return null;
}
