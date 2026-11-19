// The roles every new company starts with. The Admin role is the company's
// locked top role: it always has every permission of the company's apps (so it
// needs no permission rows). The others are ordinary roles the Admin can edit,
// rename or delete. Permissions missing from the catalogue are skipped.

import { ADMIN_LEVEL } from './access.rules';

export interface RoleTemplate {
  name: string;
  description: string;
  level: number;
  /** Locked (only the Admin role). */
  system?: boolean;
  permissions: string[];
}

const crud = (area: string, actions = ['view', 'create', 'edit', 'delete']) => actions.map((a) => `${area}.${a}`);

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    name: 'ADMIN',
    description: 'Runs the company: every app, every setting, every person',
    level: ADMIN_LEVEL,
    system: true,
    permissions: [],
  },
  {
    name: 'MANAGER',
    description: 'Runs a team: sales, delivery and billing, and the people who report to them',
    level: 2,
    permissions: [
      'dashboard.view',
      ...crud('customers', ['view', 'create', 'edit']),
      ...crud('products', ['view', 'create', 'edit']),
      'categories.view',
      'warehouses.view',
      ...crud('quotations', ['view', 'create', 'edit', 'approve', 'send', 'export']),
      ...crud('challans', ['view', 'create', 'edit', 'dispatch', 'convert']),
      ...crud('invoices', ['view', 'create', 'edit', 'insides']),
      'reports.view',
      'reports.export',
      'companies.view',
      ...crud('users', ['view', 'create', 'edit']),
      'roles.view',
      'ai_agent.view',
      'ai_agent.use',
      'attendance.view',
      'attendance.manage',
      ...crud('tasks', ['view', 'create', 'manage']),
      ...crud('crm', ['view', 'create', 'manage']),
      ...crud('drive', ['view', 'create', 'update']),
    ],
  },
  {
    name: 'ACCOUNTANT',
    description: 'Invoices, payments and reports',
    level: 3,
    permissions: [
      'dashboard.view',
      ...crud('customers', ['view', 'create', 'edit']),
      'products.view',
      'quotations.view',
      'challans.view',
      ...crud('invoices', ['view', 'create', 'edit', 'insides']),
      'reports.view',
      'reports.export',
      'companies.view',
      'attendance.view',
      ...crud('tasks', ['view', 'create']),
      ...crud('drive', ['view', 'create']),
    ],
  },
  {
    name: 'SALES',
    description: 'Customers, quotations and leads',
    level: 3,
    permissions: [
      'dashboard.view',
      ...crud('customers', ['view', 'create', 'edit']),
      'products.view',
      ...crud('quotations', ['view', 'create', 'edit', 'send', 'export']),
      ...crud('challans', ['view', 'create']),
      'invoices.view',
      ...crud('crm', ['view', 'create']),
      'attendance.view',
      ...crud('tasks', ['view', 'create']),
      'drive.view',
      'ai_agent.view',
      'ai_agent.use',
    ],
  },
  {
    name: 'EMPLOYEE',
    description: 'Day-to-day work: attendance, tasks and looking up records',
    level: 4,
    permissions: [
      'dashboard.view',
      'customers.view',
      'products.view',
      'quotations.view',
      'challans.view',
      'attendance.view',
      ...crud('tasks', ['view', 'create']),
      'drive.view',
      'crm.view',
    ],
  },
  {
    name: 'VIEWER',
    description: 'Can look at records, but not change anything',
    level: 5,
    permissions: [
      'dashboard.view',
      'customers.view',
      'products.view',
      'categories.view',
      'warehouses.view',
      'quotations.view',
      'challans.view',
      'invoices.view',
      'reports.view',
    ],
  },
];
