'use client';

import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { driver, type Driver } from 'driver.js';
import { useAuth } from './AuthProvider';
import { buildTourSteps, closeAnyTourOpenedOverlay } from '../lib/tour/steps';
import { shouldAutoStartOnPath, shouldMarkSeen, TOUR_REQUEST_STORAGE_KEY } from '../lib/tour/tour-logic';

// Issue #185 — mounted inside AuthProvider (app/components/Providers.tsx),
// needs its session state (user/loading/hasSeenTour) and its refresh()
// function to re-fetch /api/auth/session after marking the tour seen.
type TourContextValue = {
  // Starts the tour. If not currently on /sales/[brand] and `brand` is
  // given, navigates there first (see TOUR_REQUEST_STORAGE_KEY's own
  // comment for why) rather than silently finding nothing to spotlight.
  startTour: (options?: { brand?: string }) => void;
};

const TourContext = createContext<TourContextValue | null>(null);

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { user, loading, hasSeenTour, refresh } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const driverRef = useRef<Driver | null>(null);
  const autoStartedRef = useRef(false);

  const markSeen = useCallback(() => {
    fetch('/api/auth/tour', { method: 'POST', credentials: 'include' })
      .catch((err) => console.error('[TourProvider] failed to mark tour seen:', err))
      .finally(() => { refresh(); });
  }, [refresh]);

  const driveNow = useCallback(() => {
    if (driverRef.current?.isActive()) return;
    const driverObj = driver({
      showProgress: true,
      allowKeyboardControl: true,
      overlayOpacity: 0.65,
      steps: buildTourSteps(),
      // The one place Done/Skip/the popover's own close (x)/Escape/overlay-
      // click all funnel through — see docs/ARCHITECTURE.md's onboarding-
      // tour section for why this must call opts.driver.destroy() itself
      // (setting onDestroyStarted suppresses driver.js's own real teardown
      // otherwise, per its actual source, not just its .d.ts).
      onDestroyStarted: (element, step, opts) => {
        if (shouldMarkSeen(element, step)) markSeen();
        closeAnyTourOpenedOverlay();
        opts.driver.destroy();
      },
    });
    driverRef.current = driverObj;
    driverObj.drive();
  }, [markSeen]);

  const startTour = useCallback((options?: { brand?: string }) => {
    if (pathname && shouldAutoStartOnPath(pathname)) {
      driveNow();
      return;
    }
    if (options?.brand) {
      try {
        sessionStorage.setItem(TOUR_REQUEST_STORAGE_KEY, '1');
      } catch {
        // Private-browsing/storage-disabled — the tour just won't fire
        // after navigation; not worth failing the navigation itself over.
      }
      router.push(`/sales/${options.brand}`);
    }
  }, [pathname, router, driveNow]);

  // Two distinct triggers, same underlying start: (1) a genuine first-time
  // user landing on the sales board with no tour seen yet, and (2) an
  // explicit "Take the tour" replay that had to navigate here first (see
  // startTour above) — consumed via the sessionStorage flag it set,
  // bypassing the hasSeenTour gate since this is an explicit request, not
  // an automatic one.
  useEffect(() => {
    if (loading || !user) return;
    if (!pathname || !shouldAutoStartOnPath(pathname)) return;

    let requested = false;
    try {
      requested = sessionStorage.getItem(TOUR_REQUEST_STORAGE_KEY) === '1';
      if (requested) sessionStorage.removeItem(TOUR_REQUEST_STORAGE_KEY);
    } catch {
      // Storage unavailable — falls through to the normal auto-start gate.
    }

    if (!requested) {
      if (autoStartedRef.current || hasSeenTour) return;
      autoStartedRef.current = true;
    }

    // Let the kanban board's own leads finish rendering before spotlighting it.
    const id = requestAnimationFrame(() => driveNow());
    return () => cancelAnimationFrame(id);
  }, [loading, user, hasSeenTour, pathname, driveNow]);

  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
    };
  }, []);

  return (
    <TourContext.Provider value={{ startTour }}>
      {children}
    </TourContext.Provider>
  );
}

export function useTour(): TourContextValue {
  const context = useContext(TourContext);
  if (!context) {
    throw new Error('useTour must be used within TourProvider');
  }
  return context;
}
