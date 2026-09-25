import { describe, it, expect, afterEach } from 'vitest';
import { getManagedAssigneeIds, managesAnyTeam, getTeamVisibilityFilter, type Team } from '../../lib/teams';

// isSuperAdminEmail (read internally by getTeamVisibilityFilter) reads
// process.env.SSO_SUPER_ADMIN_EMAILS fresh on every call — same convention
// as tests/lib/sso-access.test.ts, no vi.resetModules() dance needed.
const ORIGINAL_SUPER_ADMINS = process.env.SSO_SUPER_ADMIN_EMAILS;

function team(overrides: Partial<Team>): Team {
  return {
    _id: 'team-1',
    brand: 'cogmap',
    name: 'Team',
    memberIds: [],
    managerIds: [],
    createdAt: '2026-09-25T00:00:00.000Z',
    updatedAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('lib/teams', () => {
  afterEach(() => {
    if (ORIGINAL_SUPER_ADMINS === undefined) delete process.env.SSO_SUPER_ADMIN_EMAILS;
    else process.env.SSO_SUPER_ADMIN_EMAILS = ORIGINAL_SUPER_ADMINS;
  });

  describe('getManagedAssigneeIds', () => {
    it('returns just the caller when they manage no teams', () => {
      const teams = [team({ _id: 't1', managerIds: ['someone-else'], memberIds: ['user-2'] })];
      expect(getManagedAssigneeIds(teams, 'manager-1')).toEqual(['manager-1']);
    });

    it('returns self + every member of a single managed team', () => {
      const teams = [team({ _id: 't1', managerIds: ['manager-1'], memberIds: ['user-2', 'user-3'] })];
      expect(getManagedAssigneeIds(teams, 'manager-1').sort()).toEqual(['manager-1', 'user-2', 'user-3']);
    });

    it('unions members across every team the caller manages', () => {
      const teams = [
        team({ _id: 't1', managerIds: ['manager-1'], memberIds: ['user-2'] }),
        team({ _id: 't2', managerIds: ['manager-1'], memberIds: ['user-3', 'user-4'] }),
      ];
      expect(getManagedAssigneeIds(teams, 'manager-1').sort()).toEqual(['manager-1', 'user-2', 'user-3', 'user-4']);
    });

    it('never double-counts a manager who is also listed as a member of their own managed team', () => {
      const teams = [team({ _id: 't1', managerIds: ['manager-1'], memberIds: ['manager-1', 'user-2'] })];
      expect(getManagedAssigneeIds(teams, 'manager-1').sort()).toEqual(['manager-1', 'user-2']);
    });

    it('ignores a team the caller merely belongs to (member, not manager) — no hierarchy inheritance', () => {
      const teams = [team({ _id: 't1', managerIds: ['someone-else'], memberIds: ['manager-1', 'user-2'] })];
      expect(getManagedAssigneeIds(teams, 'manager-1')).toEqual(['manager-1']);
    });

    it('handles a managed team with zero current members', () => {
      const teams = [team({ _id: 't1', managerIds: ['manager-1'], memberIds: [] })];
      expect(getManagedAssigneeIds(teams, 'manager-1')).toEqual(['manager-1']);
    });
  });

  describe('managesAnyTeam', () => {
    it('is true when the caller manages at least one team', () => {
      const teams = [team({ _id: 't1', managerIds: ['manager-1'] })];
      expect(managesAnyTeam(teams, 'manager-1')).toBe(true);
    });

    it('is false for a plain member with no managed team', () => {
      const teams = [team({ _id: 't1', managerIds: ['someone-else'], memberIds: ['user-2'] })];
      expect(managesAnyTeam(teams, 'user-2')).toBe(false);
    });

    it('is false with zero teams', () => {
      expect(managesAnyTeam([], 'manager-1')).toBe(false);
    });
  });

  describe('getTeamVisibilityFilter', () => {
    it('returns undefined (no narrowing) for a super admin, regardless of teams', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = 'admin@example.com';
      const teams = [team({ _id: 't1', managerIds: ['someone-else'], memberIds: ['user-2'] })];
      expect(getTeamVisibilityFilter(teams, 'admin-1', 'admin@example.com', {}, 'cogmap')).toBeUndefined();
    });

    it("returns undefined (no narrowing) for a brand admin's orgAccess role", () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      const teams = [team({ _id: 't1' })];
      expect(getTeamVisibilityFilter(teams, 'admin-1', 'admin@example.com', { cogmap: 'admin' }, 'cogmap')).toBeUndefined();
    });

    it('returns a correctly-shaped $in filter for a plain brand user', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      const teams = [team({ _id: 't1', managerIds: ['manager-1'], memberIds: ['user-2', 'user-3'] })];
      expect(getTeamVisibilityFilter(teams, 'manager-1', 'manager@example.com', { cogmap: 'user' }, 'cogmap'))
        .toEqual({ assignedTo: { $in: expect.arrayContaining(['manager-1', 'user-2', 'user-3']) } });
    });

    it('degrades to exactly "My Leads" (self-only $in) for a non-manager plain user, never an error', () => {
      process.env.SSO_SUPER_ADMIN_EMAILS = '';
      const teams = [team({ _id: 't1', managerIds: ['someone-else'], memberIds: ['user-2'] })];
      expect(getTeamVisibilityFilter(teams, 'user-2', 'user2@example.com', { cogmap: 'user' }, 'cogmap'))
        .toEqual({ assignedTo: { $in: ['user-2'] } });
    });
  });
});
