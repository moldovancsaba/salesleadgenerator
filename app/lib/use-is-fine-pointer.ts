'use client';

import { useEffect, useState } from 'react';

// Cmd/Ctrl+K command palette gate (issue #213) — desktop-keyboard pattern
// only; a touch/coarse-pointer device (no fine pointer, and typically no
// physical keyboard reliably present) must simply not mount the palette at
// all. Mirrors app/lib/use-is-compact-viewport.ts's exact structure —
// defaults to false (matching that hook's own "no history, don't assume
// mobile" default) until the effect resolves the real match client-side
// (SSR has no `window`/pointer to query at all).
export function useIsFinePointer(): boolean {
  const [isFine, setIsFine] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(pointer: fine)');
    setIsFine(mql.matches);
    const handler = (event: MediaQueryListEvent) => setIsFine(event.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return isFine;
}
