import {
  NO_ROLE_RANK,
  PLATFORM_PERMISSIONS,
  canGiveRoles,
  canGrantPermissions,
  canManage,
  canSetManager,
  canWorkOnRoleLevel,
  effectivePermissions,
  isReservedRoleName,
  keepsAnAdmin,
  moveTeamUp,
  rankOf,
  reportsBelow,
  wouldLoop,
  type ParentMap,
} from './access.rules';

const CATALOGUE = ['quotations.view', 'quotations.create', 'users.view', 'users.edit', 'tenants.view', 'tenants.manage', 'permissions.create'];
const role = (name: string, level: number, permissions: string[] = [], scope = 'COMPANY') => ({ name, level, scope, permissions });

//            1 (Admin)
//           /        \
//      2 (Manager)    5 (Manager)
//       /     \           \
//   3 (Sales) 4 (Employee) 6 (Employee)
//      |
//   7 (Viewer)
const tree: ParentMap = new Map<number, number | null>([
  [1, null],
  [2, 1],
  [5, 1],
  [3, 2],
  [4, 2],
  [6, 5],
  [7, 3],
]);
const admin = { id: 1, rank: 1, admin: true };
const manager = { id: 2, rank: 2, admin: false };

describe('effective permissions', () => {
  it('gives a company Admin every company permission, never a platform one', () => {
    const e = effectivePermissions([role('ADMIN', 1)], CATALOGUE);
    expect(e.permissions).toEqual(['quotations.create', 'quotations.view', 'users.edit', 'users.view']);
    expect(e).toMatchObject({ admin: true, platform: false, rank: 1 });
  });

  it('gives other roles what they hold, minus platform permissions', () => {
    const e = effectivePermissions([role('SALES', 3, ['quotations.view', 'permissions.create'])], CATALOGUE);
    expect(e.permissions).toEqual(['quotations.view']);
    expect(e).toMatchObject({ admin: false, platform: false, rank: 3 });
  });

  it('adds every platform permission for Super Admin (and the company ones come from the company role)', () => {
    const e = effectivePermissions([role('SUPER_ADMIN', 0, ['quotations.view'], 'PLATFORM'), role('ADMIN', 1)], CATALOGUE);
    expect(e.permissions).toEqual(['permissions.create', 'quotations.create', 'quotations.view', 'tenants.manage', 'tenants.view', 'users.edit', 'users.view']);
    expect(e).toMatchObject({ admin: true, platform: true, rank: 1 });
  });

  it('a Super Admin with no company role gets only the platform permissions', () => {
    const e = effectivePermissions([role('SUPER_ADMIN', 0, ['quotations.view'], 'PLATFORM')], CATALOGUE);
    expect(e.permissions).toEqual(['permissions.create', 'tenants.manage', 'tenants.view']);
    expect(e.rank).toBe(NO_ROLE_RANK);
  });

  it('knows the platform permissions', () => {
    expect(PLATFORM_PERMISSIONS).toEqual(expect.arrayContaining(['tenants.view', 'tenants.manage', 'permissions.edit']));
  });
});

describe('rank', () => {
  it('is the highest company role; platform roles and no roles', () => {
    expect(rankOf([role('SALES', 3), role('MANAGER', 2)])).toBe(2);
    expect(rankOf([role('SUPER_ADMIN', 0, [], 'PLATFORM')])).toBe(NO_ROLE_RANK);
    expect(rankOf([])).toBe(NO_ROLE_RANK);
  });
});

describe('reporting tree', () => {
  it('finds everyone below a person', () => {
    expect([...reportsBelow(2, tree)].sort()).toEqual([3, 4, 7]);
    expect([...reportsBelow(1, tree)].sort()).toEqual([2, 3, 4, 5, 6, 7]);
    expect(reportsBelow(7, tree).size).toBe(0);
  });

  it('survives bad data with a loop', () => {
    const bad: ParentMap = new Map([
      [1, 2],
      [2, 1],
    ]);
    expect([...reportsBelow(1, bad)]).toEqual([2]);
  });

  it('spots loops', () => {
    expect(wouldLoop(2, 7, tree)).toBe(true); // 7 is under 2
    expect(wouldLoop(2, 2, tree)).toBe(true);
    expect(wouldLoop(7, 5, tree)).toBe(false);
    expect(wouldLoop(7, null, tree)).toBe(false);
  });
});

describe('who may manage whom', () => {
  it('Admins manage anyone but themselves', () => {
    expect(canManage(admin, { id: 6, rank: 4 }, tree).ok).toBe(true);
    expect(canManage(admin, { id: 1, rank: 1 }, tree)).toEqual({ ok: false, reason: expect.stringMatching(/your own access/) });
  });

  it('only SameBook changes a Super Admin, even inside their own company', () => {
    expect(canManage(admin, { id: 6, rank: 1, name: 'Vaibhav', platform: true }, tree)).toEqual({
      ok: false,
      reason: expect.stringMatching(/Vaibhav is a SameBook Super Admin/),
    });
    expect(canManage({ ...admin, platform: true }, { id: 6, rank: 1, platform: true }, tree).ok).toBe(true);
  });

  it('a manager manages only their own team, and only lower ranks', () => {
    expect(canManage(manager, { id: 3, rank: 3 }, tree).ok).toBe(true);
    expect(canManage(manager, { id: 7, rank: 5 }, tree).ok).toBe(true); // indirect report
    expect(canManage(manager, { id: 6, rank: 4, name: 'Ravi' }, tree)).toEqual({ ok: false, reason: expect.stringMatching(/Ravi isn't in your team/) });
    expect(canManage(manager, { id: 4, rank: 2, name: 'Asha' }, tree)).toEqual({ ok: false, reason: expect.stringMatching(/Asha has the same or a higher role/) });
  });

  it('gives roles: Admin any company role; others only lower ones; never Super Admin', () => {
    expect(canGiveRoles(admin, [{ name: 'ADMIN', level: 1 }]).ok).toBe(true);
    expect(canGiveRoles(manager, [{ name: 'SALES', level: 3 }]).ok).toBe(true);
    expect(canGiveRoles(manager, [{ name: 'MANAGER', level: 2 }])).toEqual({ ok: false, reason: expect.stringMatching(/"MANAGER" is not/) });
    expect(canGiveRoles(admin, [{ name: 'SUPER_ADMIN', level: 0, scope: 'PLATFORM' }]).ok).toBe(false);
  });

  it('sets managers within the team, never in a loop; only Admins put someone at the top', () => {
    expect(canSetManager(manager, null, 3, tree).ok).toBe(true); // a new person under Sales 3
    expect(canSetManager(manager, 4, 2, tree).ok).toBe(true);
    expect(canSetManager(manager, 4, 5, tree)).toEqual({ ok: false, reason: expect.stringMatching(/yourself or someone in your team/) });
    expect(canSetManager(manager, 4, null, tree)).toEqual({ ok: false, reason: expect.stringMatching(/Only an Admin/) });
    expect(canSetManager(admin, 4, null, tree).ok).toBe(true);
    expect(canSetManager(admin, 2, 7, tree)).toEqual({ ok: false, reason: expect.stringMatching(/loop/) });
  });

  it('works on roles only below your level (Admin: 2 to 5)', () => {
    expect(canWorkOnRoleLevel(admin, 2).ok).toBe(true);
    expect(canWorkOnRoleLevel(admin, 1).ok).toBe(false);
    expect(canWorkOnRoleLevel(manager, 3).ok).toBe(true);
    expect(canWorkOnRoleLevel(manager, 2).ok).toBe(false);
    expect(canWorkOnRoleLevel(admin, 9).ok).toBe(false);
  });

  it('grants only company permissions you hold yourself', () => {
    const m = { ...manager, permissions: ['quotations.view', 'quotations.create'] };
    expect(canGrantPermissions(m, ['quotations.view']).ok).toBe(true);
    expect(canGrantPermissions(m, ['users.edit'])).toEqual({ ok: false, reason: expect.stringMatching(/don't have it yourself/) });
    expect(canGrantPermissions({ ...admin, permissions: [] }, ['users.edit']).ok).toBe(true);
    expect(canGrantPermissions({ ...admin, permissions: [] }, ['tenants.view']).ok).toBe(false);
  });

  it('keeps an Admin, and moves a leaving manager’s team up one level', () => {
    expect(keepsAnAdmin(0)).toBe(false);
    expect(keepsAnAdmin(1)).toBe(true);
    expect([...moveTeamUp(2, tree)].sort()).toEqual([
      [3, 1],
      [4, 1],
    ]);
    expect([...moveTeamUp(1, tree)].sort()).toEqual([
      [2, null],
      [5, null],
    ]);
  });

  it('reserves platform role names', () => {
    expect(isReservedRoleName('Super Admin')).toBe(true);
    expect(isReservedRoleName('super-admin')).toBe(true);
    expect(isReservedRoleName('Store Manager')).toBe(false);
  });
});
