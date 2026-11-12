// Pure rules for the Tasks add-on (no DB access) — unit tested.

export const TASK_TYPES = ['EPIC', 'GOAL', 'TASK', 'SUBTASK'] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'ON_HOLD'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const LINK_TYPES = ['CUSTOMER', 'QUOTATION', 'INVOICE'] as const;
export type LinkType = (typeof LINK_TYPES)[number];

/** Permission a user needs to link (and see the label of) each record type. */
export const LINK_PERMISSION: Record<LinkType, string> = {
  CUSTOMER: 'customers.view',
  QUOTATION: 'quotations.view',
  INVOICE: 'invoices.view',
};

export const TYPE_LABEL: Record<TaskType, string> = {
  EPIC: 'Epic',
  GOAL: 'Goal',
  TASK: 'Task',
  SUBTASK: 'Subtask',
};

export const KEY_PREFIX: Record<TaskType, string> = {
  EPIC: 'EP',
  GOAL: 'GL',
  TASK: 'TK',
  SUBTASK: 'SB',
};

/** Which parent types each type may sit under. Empty = top level only. */
export const ALLOWED_PARENTS: Record<TaskType, TaskType[]> = {
  EPIC: [],
  GOAL: ['EPIC'],
  TASK: ['EPIC', 'GOAL'],
  SUBTASK: ['TASK'],
};

/** Child types offered under each type (inverse of ALLOWED_PARENTS). */
export const ALLOWED_CHILDREN: Record<TaskType, TaskType[]> = {
  EPIC: ['GOAL', 'TASK'],
  GOAL: ['TASK'],
  TASK: ['SUBTASK'],
  SUBTASK: [],
};

export const taskKey = (type: string, number: number) =>
  `${KEY_PREFIX[type as TaskType] ?? 'TK'}-${number}`;

/**
 * Validates a type/parent combination. Returns an error message or null.
 * Because each type may only sit under a strictly "bigger" type, cycles are
 * impossible by construction.
 */
export const parentError = (type: TaskType, parentType: TaskType | null): string | null => {
  const allowed = ALLOWED_PARENTS[type];
  if (!parentType) {
    return type === 'SUBTASK' ? 'A subtask must belong to a task' : null;
  }
  if (!allowed.includes(parentType)) {
    if (!allowed.length) return `${TYPE_LABEL[type]}s cannot be placed under another item`;
    return `A ${TYPE_LABEL[type].toLowerCase()} can only be placed under ${allowed
      .map((t) => `a ${TYPE_LABEL[t].toLowerCase()}`)
      .join(' or ')}`;
  }
  return null;
};

export interface TaskActor {
  userId: number;
  isManager: boolean;
}

export interface TaskOwnership {
  created_by: number;
  assignee_id?: number | null;
}

/** Full access: managers, the creator and the assignee. */
export const hasFullAccess = (t: TaskOwnership, a: TaskActor) =>
  a.isManager ||
  Number(t.created_by) === Number(a.userId) ||
  (t.assignee_id != null && Number(t.assignee_id) === Number(a.userId));

export interface TaskCapabilities {
  edit: boolean;
  status: boolean;
  assign: boolean;
  move: boolean;
  delete: boolean;
  add_child: boolean;
  comment: boolean;
}

/**
 * What a user may do on one item. `full` = manager/creator/assignee;
 * otherwise the user only reads it (ancestor or descendant of their work).
 */
export const capabilities = (
  t: TaskOwnership & { type: string },
  a: TaskActor,
  full: boolean,
  canCreate: boolean,
): TaskCapabilities => {
  const isCreator = Number(t.created_by) === Number(a.userId);
  const owner = a.isManager || isCreator;
  return {
    edit: full,
    status: full,
    assign: full && owner,
    move: full && owner,
    delete: full && owner,
    add_child: full && canCreate && ALLOWED_CHILDREN[t.type as TaskType]?.length > 0,
    comment: true,
  };
};

export const isOverdue = (
  t: { due_date?: string | null; status?: string },
  today: string,
): boolean => !!t.due_date && t.status !== 'DONE' && String(t.due_date) < today;

export const progressOf = (statuses: string[]) => {
  const total = statuses.length;
  const done = statuses.filter((s) => s === 'DONE').length;
  return total ? { done, total, percent: Math.round((done / total) * 100) } : null;
};

/** YYYY-MM-DD validation (and real calendar date). */
export const isIsoDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};
