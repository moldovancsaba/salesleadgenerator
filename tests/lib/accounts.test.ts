import { describe, it, expect } from 'vitest';
import {
  groupLeadsByParentOrg,
  buildAccountRollup,
  computeAccountRollups,
  computeAccountDetail,
  type AccountSourceLead,
} from '../../lib/accounts';

function lead(overrides: Partial<AccountSourceLead> = {}): AccountSourceLead {
  return {
    _id: 'lead-1',
    entity_name: 'Acme FC',
    parentOrgId: 'acme',
    parentOrgName: 'Acme Holdings',
    kanbanColumn: 'QUALIFIED',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('groupLeadsByParentOrg', () => {
  it('groups leads by their exact parentOrgId string', () => {
    const groups = groupLeadsByParentOrg([
      lead({ _id: 'a', parentOrgId: 'acme' }),
      lead({ _id: 'b', parentOrgId: 'acme' }),
      lead({ _id: 'c', parentOrgId: 'other' }),
    ]);
    expect(groups.get('acme')?.length).toBe(2);
    expect(groups.get('other')?.length).toBe(1);
  });

  it('excludes leads with no parentOrgId — never a synthetic unknown bucket', () => {
    const groups = groupLeadsByParentOrg([
      lead({ _id: 'a', parentOrgId: undefined }),
      lead({ _id: 'b', parentOrgId: '' }),
      lead({ _id: 'c', parentOrgId: '   ' }),
    ]);
    expect(groups.size).toBe(0);
  });

  it('treats differently-spelled parent names as distinct groups (issue 209 §15 — disclosed Phase 1 limitation)', () => {
    const groups = groupLeadsByParentOrg([
      lead({ _id: 'a', parentOrgId: 'real-madrid', parentOrgName: 'Real Madrid CF' }),
      lead({ _id: 'b', parentOrgId: 'realmadrid', parentOrgName: 'Real Madrid' }),
    ]);
    expect(groups.size).toBe(2);
  });
});

describe('buildAccountRollup', () => {
  it('sums leadsByColumn, contact counts, and pipeline value across a group', () => {
    const rollup = buildAccountRollup('acme', [
      lead({ _id: 'a', kanbanColumn: 'QUALIFIED', contacts: [{}, {}], ticketSizeEstimate: { method: 'tier_band', expected: 5000, currency: 'USD' } }),
      lead({ _id: 'b', kanbanColumn: 'ENGAGED', contacts: [{}], ticketSizeEstimate: { method: 'tier_band', expected: 3000, currency: 'USD' } }),
    ], 'USD');

    expect(rollup.leadCount).toBe(2);
    expect(rollup.leadsByColumn).toEqual({ QUALIFIED: 1, ENGAGED: 1 });
    expect(rollup.contactCount).toBe(3);
    expect(rollup.pipelineValueUsd).toBe(8000);
    expect(rollup.wonValueUsd).toBe(0);
  });

  it('routes WON leads to wonValueUsd via actualDealValueUsd, not ticketSizeEstimate', () => {
    const rollup = buildAccountRollup('acme', [
      lead({ _id: 'a', kanbanColumn: 'WON', actualDealValueUsd: 12000, ticketSizeEstimate: { method: 'tier_band', expected: 9000, currency: 'USD' } }),
    ], 'USD');
    expect(rollup.wonValueUsd).toBe(12000);
    expect(rollup.pipelineValueUsd).toBe(0);
  });

  it('excludes an unconfigured ticketSizeEstimate as an honest omission, never $0', () => {
    const rollup = buildAccountRollup('acme', [
      lead({ _id: 'a', kanbanColumn: 'QUALIFIED', ticketSizeEstimate: { method: 'unconfigured' } }),
      lead({ _id: 'b', kanbanColumn: 'QUALIFIED', ticketSizeEstimate: { method: 'tier_band', expected: 1000, currency: 'USD' } }),
    ], 'USD');
    expect(rollup.pipelineValueUsd).toBe(1000);
  });

  it('excludes a ticketSizeEstimate whose currency does not match the brand currency, never converts it (issue 209 §15)', () => {
    const rollup = buildAccountRollup('acme', [
      lead({ _id: 'a', kanbanColumn: 'QUALIFIED', ticketSizeEstimate: { method: 'tier_band', expected: 5000, currency: 'EUR' } }),
      lead({ _id: 'b', kanbanColumn: 'QUALIFIED', ticketSizeEstimate: { method: 'tier_band', expected: 2000, currency: 'USD' } }),
    ], 'USD');
    // Only the USD-matching lead's estimate is summed; the EUR one is
    // dropped from the sum entirely (the lead itself is never excluded from
    // the group — only its amount is excluded from this sum).
    expect(rollup.pipelineValueUsd).toBe(2000);
  });

  it('falls back to the raw parentOrgId when no lead in the group ever set a parentOrgName', () => {
    const rollup = buildAccountRollup('acme-99', [
      lead({ _id: 'a', parentOrgId: 'acme-99', parentOrgName: undefined }),
    ], 'USD');
    expect(rollup.parentOrgName).toBeNull();
  });

  it('uses the most-recently-updated non-empty parentOrgName across the group', () => {
    const rollup = buildAccountRollup('acme', [
      lead({ _id: 'a', parentOrgName: 'Old Name', updatedAt: '2026-01-01T00:00:00.000Z' }),
      lead({ _id: 'b', parentOrgName: 'New Name', updatedAt: '2026-09-01T00:00:00.000Z' }),
    ], 'USD');
    expect(rollup.parentOrgName).toBe('New Name');
  });

  it('collects only non-empty relationshipToParent values into relationshipCodes, no default fallback', () => {
    const rollup = buildAccountRollup('acme', [
      lead({ _id: 'a', relationshipToParent: 'owned' }),
      lead({ _id: 'b', relationshipToParent: undefined }),
      lead({ _id: 'c', relationshipToParent: 'owned' }),
    ], 'USD');
    expect(rollup.relationshipCodes).toEqual(['owned']);
  });

  it('tracks mostRecentUpdatedAt across the group', () => {
    const rollup = buildAccountRollup('acme', [
      lead({ _id: 'a', updatedAt: '2026-01-01T00:00:00.000Z' }),
      lead({ _id: 'b', updatedAt: '2026-09-01T00:00:00.000Z' }),
      lead({ _id: 'c', updatedAt: '2026-05-01T00:00:00.000Z' }),
    ], 'USD');
    expect(rollup.mostRecentUpdatedAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('is a valid single-lead Account — not required to have 2+ children', () => {
    const rollup = buildAccountRollup('solo', [lead({ _id: 'a', parentOrgId: 'solo' })], 'USD');
    expect(rollup.leadCount).toBe(1);
  });
});

describe('computeAccountRollups', () => {
  it('returns one rollup per distinct parentOrgId, sorted by pipeline+won value descending', () => {
    const rollups = computeAccountRollups([
      lead({ _id: 'a', parentOrgId: 'small', ticketSizeEstimate: { method: 'tier_band', expected: 1000, currency: 'USD' } }),
      lead({ _id: 'b', parentOrgId: 'big', ticketSizeEstimate: { method: 'tier_band', expected: 9000, currency: 'USD' } }),
    ], 'USD');
    expect(rollups.map((r) => r.parentOrgId)).toEqual(['big', 'small']);
  });

  it('excludes leads with no parentOrgId from every group', () => {
    const rollups = computeAccountRollups([
      lead({ _id: 'a', parentOrgId: undefined }),
    ], 'USD');
    expect(rollups).toEqual([]);
  });
});

describe('computeAccountDetail', () => {
  it('returns the full lead list for one parentOrgId, scoped correctly', () => {
    const detail = computeAccountDetail('acme', [
      lead({ _id: 'a', parentOrgId: 'acme' }),
      lead({ _id: 'b', parentOrgId: 'acme' }),
      lead({ _id: 'c', parentOrgId: 'other' }),
    ], 'USD');
    expect(detail?.leads.map((l) => l._id)).toEqual(['a', 'b']);
    expect(detail?.leadCount).toBe(2);
  });

  it('returns null for a parentOrgId matching zero leads — the caller maps this to a 404', () => {
    const detail = computeAccountDetail('nonexistent', [lead({ _id: 'a', parentOrgId: 'acme' })], 'USD');
    expect(detail).toBeNull();
  });
});
