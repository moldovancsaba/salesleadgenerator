import { describe, it, expect } from 'vitest';
import { canAssign, resolveAssignedToFilter, combineFilterWithAssignedTo, type AssignedToFilterClause } from '../../lib/lead-assignment';

describe('canAssign', () => {
  it('allows self-assign for any brand role', () => {
    expect(canAssign('user-1', 'user', 'user-1')).toBe(true);
    expect(canAssign('user-1', null, 'user-1')).toBe(true);
    expect(canAssign('user-1', 'admin', 'user-1')).toBe(true);
  });

  it('allows an admin to assign to another user', () => {
    expect(canAssign('admin-1', 'admin', 'user-2')).toBe(true);
  });

  it('blocks a non-admin from assigning to another user', () => {
    expect(canAssign('user-1', 'user', 'user-2')).toBe(false);
    expect(canAssign('user-1', null, 'user-2')).toBe(false);
  });

  it('blocks a non-admin from clearing someone else\'s assignment', () => {
    expect(canAssign('user-1', 'user', null, 'user-2')).toBe(false);
  });

  it('allows a non-admin to clear (release) their own assignment', () => {
    expect(canAssign('user-1', 'user', null, 'user-1')).toBe(true);
  });

  it('allows an admin to clear anyone\'s assignment', () => {
    expect(canAssign('admin-1', 'admin', null, 'user-2')).toBe(true);
  });

  it('blocks clearing an unassigned lead by a non-admin (no self-release to allow)', () => {
    expect(canAssign('user-1', 'user', null, null)).toBe(false);
  });
});

describe('resolveAssignedToFilter', () => {
  it('returns undefined when no param is given', () => {
    expect(resolveAssignedToFilter(undefined, 'user-1')).toBeUndefined();
  });

  it("resolves 'me' to the actor's own ssoUserId, never the literal string", () => {
    expect(resolveAssignedToFilter('me', 'user-1')).toEqual({ assignedTo: 'user-1' });
  });

  it("resolves 'me' with no session to a safe no-match filter", () => {
    expect(resolveAssignedToFilter('me', '')).toEqual({ assignedTo: '' });
  });

  it("resolves 'unassigned' to a clause matching both missing and explicit null", () => {
    expect(resolveAssignedToFilter('unassigned', 'user-1')).toEqual({
      $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }],
    });
  });

  it('treats any other value as an explicit ssoUserId', () => {
    expect(resolveAssignedToFilter('user-42', 'user-1')).toEqual({ assignedTo: 'user-42' });
  });
});

describe('combineFilterWithAssignedTo', () => {
  it('returns the base filter unchanged when there is no clause', () => {
    const base = { tenantId: 'default' };
    expect(combineFilterWithAssignedTo(base, undefined)).toBe(base);
  });

  it('combines via $and rather than spreading, so a pre-existing $or is never dropped', () => {
    // Regression guard for docs/LESSONS_LEARNED.md §1's exact bug class:
    // tenantFilter()'s own $or for the default tenant must survive
    // alongside the 'unassigned' clause's own $or.
    const base = { $or: [{ tenantId: 'default' }, { tenantId: { $exists: false } }] };
    const clause: AssignedToFilterClause = { $or: [{ assignedTo: { $exists: false } }, { assignedTo: null }] };
    expect(combineFilterWithAssignedTo(base, clause)).toEqual({ $and: [base, clause] });
  });
});
