// Who may do what, as pure rules (no database), shared by sign-in, the team /
// roles screens and the platform console.
//
//   Platform:  Super Admin (scope PLATFORM, level 0) — SameBook staff, every company.
//   Company:   Admin (level 1, locked, every permission of the company's apps)
//              → Manager (2) → Accountant / Sales (3) → Employee (4) → Viewer (5).
//
// A person's RANK is their highest company role (lowest level number). You can
// only manage people below you — in your reporting line and with a lower rank —
// and only give roles below your own level. Admins manage everyone in their
// company. Nobody changes their own access.

export const PLATFORM_LEVEL = 0;
export const ADMIN_LEVEL = 1;
export const MIN_ROLE_LEVEL = 2;
export const MAX_ROLE_LEVEL = 5;
/** Rank of someone with no company role (below everyone). */
export const NO_ROLE_RANK = 99;

export type RoleScope = 'PLATFORM' | 'COMPANY';

/**
 * Permissions that only the platform (Super Admin) can hold: managing every
 * company and the master list of permissions. A company role never grants them.
 */
export const PLATFORM_PERMISSIONS: readonly string[] = [
  'tenants.view',
  'tenants.manage',
  'companies.create',
  'companies.delete',
  'permissions.create',
  'permissions.edit',
  'permissions.delete',
];
export const isPlatformPermission = (name: string) => PLATFORM_PERMISSIONS.includes(name);

/** "Super admin", "super-admin" … → "SUPER_ADMIN". */
export const roleKey = (name: string) => String(name || '').trim().toUpperCase().replace(/[\s_-]+/g, '_');

/** Names a company may not give its own roles (they mean something platform-wide). */
export const RESERVED_ROLE_NAMES: readonly string[] = ['SUPER_ADMIN', 'SUPERADMIN', 'PLATFORM_ADMIN'];
export const isReservedRoleName = (name: string) => RESERVED_ROLE_NAMES.includes(roleKey(name));

export interface RoleFacts {
  name: string;
  scope: RoleScope | string;
  level: number;
  /** Permission names held through role_permissions. */
  permissions: string[];
}

export const isPlatformRole = (r: Pick<RoleFacts, 'scope'>) => String(r.scope).toUpperCase() === 'PLATFORM';
export const isAdminRole = (r: Pick<RoleFacts, 'scope' | 'level'>) => !isPlatformRole(r) && Number(r.level) === ADMIN_LEVEL;

/** Highest company role (lowest level); NO_ROLE_RANK without one. Platform roles don't count. */
export const rankOf = (roles: Pick<RoleFacts, 'scope' | 'level'>[]) => {
  const levels = roles.filter((r) => !isPlatformRole(r)).map((r) => Number(r.level));
  return levels.length ? Math.min(...levels) : NO_ROLE_RANK;
};

/**
 * What a person can actually do:
 *  - a company Admin gets every company permission in the catalogue;
 *  - other company roles give what they hold, never a platform permission;
 *  - a platform role (Super Admin) adds every platform permission.
 * (The caller still drops add-on permissions the company hasn't connected.)
 */
export function effectivePermissions(roles: RoleFacts[], catalogue: string[]) {
  const platform = roles.some(isPlatformRole);
  const admin = roles.some(isAdminRole);
  const company = admin
    ? catalogue.filter((p) => !isPlatformPermission(p))
    : roles.filter((r) => !isPlatformRole(r)).flatMap((r) => r.permissions).filter((p) => !isPlatformPermission(p));
  const platformPerms = platform ? PLATFORM_PERMISSIONS.filter((p) => catalogue.includes(p)) : [];
  return {
    permissions: [...new Set([...company, ...platformPerms])].sort(),
    platform,
    admin,
    rank: rankOf(roles),
  };
}

// ── The reporting tree ──────────────────────────────────────────────────────

export type ParentMap = Map<number, number | null>;

/** Everyone below `rootId` (direct and indirect reports). Safe against bad data loops. */
export function reportsBelow(rootId: number, parentOf: ParentMap): Set<number> {
  const children = new Map<number, number[]>();
  parentOf.forEach((parent, id) => {
    if (parent === null || parent === undefined) return;
    const list = children.get(Number(parent)) || [];
    list.push(Number(id));
    children.set(Number(parent), list);
  });
  const out = new Set<number>();
  const stack = [...(children.get(rootId) || [])];
  while (stack.length) {
    const id = stack.pop() as number;
    if (id === rootId || out.has(id)) continue;
    out.add(id);
    stack.push(...(children.get(id) || []));
  }
  return out;
}

/** Would making `managerId` the manager of `personId` create a loop? */
export function wouldLoop(personId: number, managerId: number | null, parentOf: ParentMap): boolean {
  if (managerId === null || managerId === undefined) return false;
  if (Number(managerId) === Number(personId)) return true;
  return reportsBelow(Number(personId), parentOf).has(Number(managerId));
}

// ── Who may manage whom ─────────────────────────────────────────────────────

export interface Actor {
  id: number;
  rank: number;
  admin: boolean;
  /** SameBook Super Admin. */
  platform?: boolean;
}
export interface Person {
  id: number;
  rank: number;
  name?: string;
  /** SameBook Super Admin — only another Super Admin may change their access. */
  platform?: boolean;
}
export type Verdict = { ok: true } | { ok: false; reason: string };
const yes: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

/** May `actor` change `target` (details, roles, manager, active / deactivated)? */
export function canManage(actor: Actor, target: Person, parentOf: ParentMap): Verdict {
  if (actor.id === target.id) return no("You can't change your own access — ask someone above you");
  if (target.platform && !actor.platform) {
    return no(`${target.name || 'This person'} is a SameBook Super Admin — only SameBook can change their access`);
  }
  if (actor.admin) return yes;
  if (!reportsBelow(actor.id, parentOf).has(target.id)) {
    return no(`${target.name || 'This person'} isn't in your team — only people who report to you can be managed by you`);
  }
  if (target.rank <= actor.rank) return no(`${target.name || 'This person'} has the same or a higher role than you`);
  return yes;
}

/** May `actor` give these roles? Admins: any company role. Others: only roles below their own level. */
export function canGiveRoles(actor: Actor, roles: { name: string; level: number; scope?: string }[]): Verdict {
  const platform = roles.find((r) => isPlatformRole({ scope: r.scope || 'COMPANY' }));
  if (platform) return no('Super Admin is a platform role and can only be given from the platform console');
  if (actor.admin) return yes;
  const above = roles.find((r) => Number(r.level) <= actor.rank);
  return above ? no(`You can only give roles below your own level — "${above.name}" is not`) : yes;
}

/**
 * May `actor` put `personId` under `managerId`? Admins: anyone in the company
 * (or nobody, i.e. the top). Others: themselves or someone in their team, so
 * the person stays in their team. Never a loop.
 */
export function canSetManager(actor: Actor, personId: number | null, managerId: number | null, parentOf: ParentMap): Verdict {
  if (personId !== null && wouldLoop(personId, managerId, parentOf)) {
    return no("That would make a loop — someone can't report to a person in their own team");
  }
  if (actor.admin) return yes;
  if (managerId === null || managerId === undefined) return no('Only an Admin can put someone at the top of the company');
  if (Number(managerId) === actor.id || reportsBelow(actor.id, parentOf).has(Number(managerId))) return yes;
  return no('Pick yourself or someone in your team as the manager');
}

/** May a role be created / edited at this level by `actor`? */
export function canWorkOnRoleLevel(actor: Actor, level: number): Verdict {
  if (!Number.isInteger(level) || level < MIN_ROLE_LEVEL || level > MAX_ROLE_LEVEL) {
    return no(`Pick a level from ${MIN_ROLE_LEVEL} to ${MAX_ROLE_LEVEL} (1 is the Admin's)`);
  }
  if (actor.admin) return yes;
  return level > actor.rank ? yes : no('You can only work on roles below your own level');
}

/** A role's permissions: only company permissions, and only ones the actor holds (unless Admin). */
export function canGrantPermissions(actor: Actor & { permissions: string[] }, names: string[]): Verdict {
  const platform = names.find(isPlatformPermission);
  if (platform) return no(`"${platform}" is a platform permission — companies can't give it`);
  if (actor.admin) return yes;
  const missing = names.find((n) => !actor.permissions.includes(n));
  return missing ? no(`You can't give "${missing}" — you don't have it yourself`) : yes;
}

/**
 * Keeps at least one active Admin: false when the change would leave the
 * company with none (`adminsAfter` = active people holding the Admin role after it).
 */
export const keepsAnAdmin = (adminsAfter: number) => adminsAfter > 0;

/**
 * When a manager leaves (is deactivated), their direct reports move up to the
 * manager's own manager (or the top). Returns personId → new managerId.
 */
export function moveTeamUp(leavingId: number, parentOf: ParentMap): Map<number, number | null> {
  const up = parentOf.get(leavingId) ?? null;
  const moves = new Map<number, number | null>();
  parentOf.forEach((parent, id) => {
    if (Number(parent) === leavingId && id !== leavingId) moves.set(Number(id), up === null ? null : Number(up));
  });
  return moves;
}
