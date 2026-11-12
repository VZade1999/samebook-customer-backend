import {
  capabilities,
  hasFullAccess,
  isIsoDate,
  isOverdue,
  parentError,
  progressOf,
  taskKey,
} from './tasks.rules';

describe('tasks rules', () => {
  describe('hierarchy', () => {
    it('allows the Epic > Goal > Task > Subtask chain', () => {
      expect(parentError('EPIC', null)).toBeNull();
      expect(parentError('GOAL', 'EPIC')).toBeNull();
      expect(parentError('TASK', 'GOAL')).toBeNull();
      expect(parentError('TASK', 'EPIC')).toBeNull();
      expect(parentError('SUBTASK', 'TASK')).toBeNull();
    });

    it('allows standalone goals and tasks', () => {
      expect(parentError('GOAL', null)).toBeNull();
      expect(parentError('TASK', null)).toBeNull();
    });

    it('requires a parent task for subtasks', () => {
      expect(parentError('SUBTASK', null)).toMatch(/must belong to a task/);
      expect(parentError('SUBTASK', 'GOAL')).toMatch(/only be placed under a task/);
    });

    it('rejects upside-down nesting', () => {
      expect(parentError('EPIC', 'GOAL')).toMatch(/cannot be placed/);
      expect(parentError('GOAL', 'TASK')).toMatch(/only be placed under an? epic/);
      expect(parentError('TASK', 'SUBTASK')).toMatch(/epic or a goal/);
      expect(parentError('TASK', 'TASK')).not.toBeNull();
    });
  });

  it('builds keys with a type prefix', () => {
    expect(taskKey('EPIC', 3)).toBe('EP-3');
    expect(taskKey('GOAL', 12)).toBe('GL-12');
    expect(taskKey('TASK', 45)).toBe('TK-45');
    expect(taskKey('SUBTASK', 60)).toBe('SB-60');
  });

  describe('access', () => {
    const t = { created_by: 1, assignee_id: 2, type: 'TASK' };
    it('gives full access to manager, creator and assignee only', () => {
      expect(hasFullAccess(t, { userId: 9, isManager: true })).toBe(true);
      expect(hasFullAccess(t, { userId: 1, isManager: false })).toBe(true);
      expect(hasFullAccess(t, { userId: 2, isManager: false })).toBe(true);
      expect(hasFullAccess(t, { userId: 3, isManager: false })).toBe(false);
    });

    it('lets the assignee edit and change status but not reassign or delete', () => {
      const c = capabilities(t, { userId: 2, isManager: false }, true, true);
      expect(c).toMatchObject({ edit: true, status: true, assign: false, delete: false, move: false });
    });

    it('lets the creator reassign, move and delete', () => {
      const c = capabilities(t, { userId: 1, isManager: false }, true, true);
      expect(c).toMatchObject({ assign: true, delete: true, move: true });
    });

    it('read-only viewers can only comment', () => {
      const c = capabilities(t, { userId: 3, isManager: false }, false, true);
      expect(c).toEqual({
        edit: false, status: false, assign: false, move: false, delete: false, add_child: false, comment: true,
      });
    });

    it('offers add_child only where the type has children and the user can create', () => {
      expect(capabilities({ ...t, type: 'SUBTASK' }, { userId: 1, isManager: false }, true, true).add_child).toBe(false);
      expect(capabilities(t, { userId: 1, isManager: false }, true, false).add_child).toBe(false);
      expect(capabilities(t, { userId: 1, isManager: false }, true, true).add_child).toBe(true);
    });
  });

  it('computes overdue against "today", ignoring done items', () => {
    expect(isOverdue({ due_date: '2026-11-10', status: 'TODO' }, '2026-11-12')).toBe(true);
    expect(isOverdue({ due_date: '2026-11-12', status: 'TODO' }, '2026-11-12')).toBe(false);
    expect(isOverdue({ due_date: '2026-11-10', status: 'DONE' }, '2026-11-12')).toBe(false);
    expect(isOverdue({ due_date: null, status: 'TODO' }, '2026-11-12')).toBe(false);
  });

  it('computes progress from child statuses', () => {
    expect(progressOf([])).toBeNull();
    expect(progressOf(['DONE', 'TODO', 'DONE', 'IN_PROGRESS'])).toEqual({ done: 2, total: 4, percent: 50 });
  });

  it('validates ISO dates', () => {
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('12-11-2026')).toBe(false);
    expect(isIsoDate(undefined)).toBe(false);
  });
});
