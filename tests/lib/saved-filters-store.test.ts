import { describe, it, expect } from 'vitest';
import { validateSavedFilterUpsert, pickOldestForEviction } from '../../lib/saved-filters-store';

describe('validateSavedFilterUpsert (issue 214)', () => {
  it('rejects an empty filter', () => {
    const result = validateSavedFilterUpsert('My View', {}, undefined, false);
    expect(result).toEqual({ ok: false, status: 400, error: 'Set a region, industry, or tag before saving a filter.' });
  });

  it('rejects a blank/whitespace-only name', () => {
    const result = validateSavedFilterUpsert('   ', { region: 'US' }, undefined, false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it('accepts a valid name and non-empty filter, trimming the name', () => {
    const result = validateSavedFilterUpsert('  Stale EMEA deals  ', { region: 'EMEA' }, undefined, false);
    expect(result).toEqual({ ok: true, trimmedName: 'Stale EMEA deals' });
  });

  it('rejects sharedWithBrand: true from a non-admin (403), even with a valid name/filter', () => {
    const result = validateSavedFilterUpsert('Team View', { region: 'US' }, true, false);
    expect(result).toEqual({ ok: false, status: 403, error: 'Only brand admins can share a saved filter with the team.' });
  });

  it('allows sharedWithBrand: true from an admin', () => {
    const result = validateSavedFilterUpsert('Team View', { region: 'US' }, true, true);
    expect(result).toEqual({ ok: true, trimmedName: 'Team View' });
  });

  it('allows sharedWithBrand: false or omitted from a non-admin (unrestricted personal save)', () => {
    expect(validateSavedFilterUpsert('Personal', { region: 'US' }, false, false)).toEqual({ ok: true, trimmedName: 'Personal' });
    expect(validateSavedFilterUpsert('Personal', { region: 'US' }, undefined, false)).toEqual({ ok: true, trimmedName: 'Personal' });
  });

  it('empty-filter rejection takes priority over the sharing-permission check', () => {
    const result = validateSavedFilterUpsert('Empty', {}, true, false);
    expect(result).toEqual({ ok: false, status: 400, error: 'Set a region, industry, or tag before saving a filter.' });
  });

  it('accepts a filter that is non-empty only via assignedTo', () => {
    const result = validateSavedFilterUpsert('My Leads View', { assignedTo: 'me' }, undefined, false);
    expect(result).toEqual({ ok: true, trimmedName: 'My Leads View' });
  });
});

describe('pickOldestForEviction (issue 214)', () => {
  it('returns null for an empty list', () => {
    expect(pickOldestForEviction([])).toBeNull();
  });

  it('returns the sole record for a single-item list', () => {
    const only = { id: 'a', createdAt: '2026-01-01T00:00:00.000Z' };
    expect(pickOldestForEviction([only])).toBe(only);
  });

  it('picks the record with the earliest createdAt regardless of array order', () => {
    const middle = { id: 'mid', createdAt: '2026-01-15T00:00:00.000Z' };
    const oldest = { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' };
    const newest = { id: 'new', createdAt: '2026-01-31T00:00:00.000Z' };
    expect(pickOldestForEviction([middle, newest, oldest])).toBe(oldest);
  });

  it('picks the first record when multiple share the exact same createdAt', () => {
    const first = { id: 'first', createdAt: '2026-01-01T00:00:00.000Z' };
    const second = { id: 'second', createdAt: '2026-01-01T00:00:00.000Z' };
    expect(pickOldestForEviction([first, second])).toBe(first);
  });
});
