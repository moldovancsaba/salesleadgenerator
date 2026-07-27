'use client';

import { useEffect, useState } from 'react';
import { TABLET_LANDSCAPE_MAX } from '../constants';

// Extracted from app/detail.tsx's own inline matchMedia effect (issue #130)
// — the shared basis for both LeadDetailModal's full-screen-vs-drawer switch
// and MergeConflictModal's list-vs-wizard layout switch, so the two don't
// silently drift on what "compact" means. Defaults to the same
// TABLET_LANDSCAPE_MAX breakpoint every other responsive check in this app
// uses (below it: full-screen/wizard; at or above: drawer/list).
// `initialValue` is what's rendered before the effect resolves the real
// match client-side (SSR has no viewport at all) — callers with an existing
// "assume compact until proven otherwise" default (LeadDetailModal) can
// preserve that exact prior behavior; a brand-new caller with no such
// history should default to `false` rather than silently assuming mobile.
export function useIsCompactViewport(maxWidth: number = TABLET_LANDSCAPE_MAX, initialValue: boolean = false): boolean {
  const [compact, setCompact] = useState(initialValue);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia(`(max-width: ${maxWidth}px)`);
    setCompact(mql.matches);
    const handler = (event: MediaQueryListEvent) => setCompact(event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [maxWidth]);

  return compact;
}
