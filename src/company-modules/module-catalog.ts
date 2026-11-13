// Single source of truth for which features are CORE (always on) and which are
// ADD-ONS a company must connect. Adding a new add-on = one entry here plus
// @RequireModule('<key>') on its controllers.

export interface ModuleDefinition {
  key: string;
  name: string;
  description: string;
  /** Core modules are always enabled and cannot be connected/disconnected. */
  core: boolean;
  /** Commercial plan when connected. Everything is FREE for now. */
  plan: 'INCLUDED' | 'FREE';
  /**
   * Permission names starting with any of these prefixes are only effective
   * while the module is enabled for the user's company.
   */
  permissionPrefixes: string[];
  /** Permissions given to the roles the owner picks while connecting. */
  grantPermissions?: string[];
}

export const MODULE_CATALOG: readonly ModuleDefinition[] = [
  {
    key: 'billing',
    name: 'Billing',
    description:
      'Quotations, invoices, delivery challans, payments, products, customers and warehouses.',
    core: true,
    plan: 'INCLUDED',
    permissionPrefixes: [],
  },
  {
    key: 'attendance',
    name: 'Attendance & Leave',
    description:
      'Punch in/out, shift rules, holidays, monthly calendar, team attendance and leave requests.',
    core: false,
    plan: 'FREE',
    permissionPrefixes: ['attendance.', 'leave.'],
    grantPermissions: ['attendance.view'],
  },
  {
    key: 'tasks',
    name: 'Tasks',
    description:
      'Epics, goals, tasks and subtasks: assign work to colleagues, track progress and follow up so nothing is forgotten.',
    core: false,
    plan: 'FREE',
    permissionPrefixes: ['tasks.'],
    grantPermissions: ['tasks.view', 'tasks.create'],
  },
  {
    key: 'drive',
    name: 'Drive',
    description:
      'A shared company drive: nested folders, files with tags and descriptions, and full version history of every change.',
    core: false,
    plan: 'FREE',
    permissionPrefixes: ['drive.'],
    grantPermissions: ['drive.view', 'drive.create', 'drive.update'],
  },
  {
    key: 'crm',
    name: 'CRM',
    description:
      'Leads and a sales pipeline with follow-ups: enquiries from IndiaMART and your website arrive automatically, and a lead becomes a customer and a quotation in one click.',
    core: false,
    plan: 'FREE',
    permissionPrefixes: ['crm.'],
    grantPermissions: ['crm.view', 'crm.create'],
  },
];

export const CORE_MODULE_KEYS: readonly string[] = MODULE_CATALOG.filter((m) => m.core).map(
  (m) => m.key,
);

export const getModuleDefinition = (key: string): ModuleDefinition | undefined =>
  MODULE_CATALOG.find((m) => m.key === key);

/** Enabled add-on keys + every core key. */
export const withCoreModules = (enabledAddOns: string[]): string[] => [
  ...new Set([...CORE_MODULE_KEYS, ...enabledAddOns]),
];

/**
 * Drops permissions that belong to an add-on the company has not enabled, so a
 * role that holds e.g. attendance.view grants nothing until Attendance is
 * connected. Permissions of core modules and unknown prefixes pass through.
 */
export const filterPermissionsByModules = (
  permissionNames: string[],
  enabledModuleKeys: string[],
): string[] => {
  const enabled = new Set(enabledModuleKeys);
  const blockedPrefixes = MODULE_CATALOG.filter((m) => !m.core && !enabled.has(m.key)).flatMap(
    (m) => m.permissionPrefixes,
  );
  if (!blockedPrefixes.length) return [...permissionNames];
  return permissionNames.filter((p) => !blockedPrefixes.some((prefix) => p.startsWith(prefix)));
};
