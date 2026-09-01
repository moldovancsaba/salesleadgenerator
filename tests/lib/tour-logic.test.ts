import { describe, it, expect } from 'vitest';
import { shouldAutoStartOnPath, shouldMarkSeen, TOUR_REQUEST_STORAGE_KEY } from '../../app/lib/tour/tour-logic';

describe('shouldAutoStartOnPath (issue #185)', () => {
  it('matches the real sales board path for any brand slug', () => {
    expect(shouldAutoStartOnPath('/sales/cogmap')).toBe(true);
    expect(shouldAutoStartOnPath('/sales/seyu')).toBe(true);
    expect(shouldAutoStartOnPath('/sales/dvsc')).toBe(true);
    expect(shouldAutoStartOnPath('/sales/a-brand-new-client')).toBe(true);
  });

  it('tolerates a trailing slash', () => {
    expect(shouldAutoStartOnPath('/sales/cogmap/')).toBe(true);
  });

  // The tour's first 3 steps only exist on the kanban board — a fresh
  // login actually lands on /forecast/[brand] (lib/sso-access.ts's
  // resolveLoginDestination), not /sales/[brand], so this must be false
  // there or the auto-trigger would self-destroy with nothing shown.
  it('does not match the post-login Forecast landing page', () => {
    expect(shouldAutoStartOnPath('/forecast/cogmap')).toBe(false);
  });

  it('does not match a deeper path under /sales/[brand] or an unrelated route', () => {
    expect(shouldAutoStartOnPath('/sales/cogmap/extra')).toBe(false);
    expect(shouldAutoStartOnPath('/salessettings/cogmap')).toBe(false);
    expect(shouldAutoStartOnPath('/')).toBe(false);
    expect(shouldAutoStartOnPath('/admin/clients')).toBe(false);
  });
});

describe('shouldMarkSeen (issue #185)', () => {
  it('is true once at least one real step was highlighted', () => {
    expect(shouldMarkSeen({}, {})).toBe(true);
  });

  // driver.js passes both element and step as undefined when it
  // self-destroys without ever highlighting anything (e.g. every step's
  // target was missing on the current page) — that must never mark the
  // tour seen, or a user who saw nothing would never get a real chance to
  // see it.
  it('is false when nothing was ever actually shown', () => {
    expect(shouldMarkSeen(undefined, undefined)).toBe(false);
    expect(shouldMarkSeen(null, null)).toBe(false);
  });

  it('is false if only one of the two is present (defensive — driver.js always pairs them)', () => {
    expect(shouldMarkSeen({}, undefined)).toBe(false);
    expect(shouldMarkSeen(undefined, {})).toBe(false);
  });
});

describe('TOUR_REQUEST_STORAGE_KEY', () => {
  it('is a real, non-empty, namespaced key', () => {
    expect(TOUR_REQUEST_STORAGE_KEY).toBe('slg-tour-requested');
  });
});
