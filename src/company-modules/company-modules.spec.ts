import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  filterPermissionsByModules,
  getModuleDefinition,
  withCoreModules,
} from './module-catalog';
import { ModuleGuard, MODULE_NOT_ENABLED } from './module.guard';
import { REQUIRE_MODULE_KEY } from './require-module.decorator';

describe('module catalog', () => {
  const perms = ['quotations.view', 'challans.create', 'attendance.view', 'attendance.manage', 'leave.view'];

  it('drops add-on permissions when the add-on is not enabled', () => {
    expect(filterPermissionsByModules(perms, [])).toEqual(['quotations.view', 'challans.create']);
  });

  it('keeps add-on permissions when the add-on is enabled', () => {
    expect(filterPermissionsByModules(perms, ['attendance'])).toEqual(perms);
  });

  it('does not treat lookalike prefixes as add-on permissions', () => {
    expect(filterPermissionsByModules(['attendances_report.view', 'leaves.view'], [])).toEqual([
      'attendances_report.view',
      'leaves.view',
    ]);
  });

  it('always reports core modules as enabled', () => {
    expect(withCoreModules([])).toEqual(['billing']);
    expect(withCoreModules(['attendance', 'attendance'])).toEqual(['billing', 'attendance']);
  });

  it('marks billing core and attendance as a free add-on', () => {
    expect(getModuleDefinition('billing')?.core).toBe(true);
    expect(getModuleDefinition('attendance')).toMatchObject({ core: false, plan: 'FREE' });
    expect(getModuleDefinition('nope')).toBeUndefined();
  });
});

describe('ModuleGuard', () => {
  const ctx = (user: any, key?: string) => {
    const handler = () => undefined;
    class Ctl {}
    if (key) Reflect.defineMetadata(REQUIRE_MODULE_KEY, key, Ctl);
    return {
      getHandler: () => handler,
      getClass: () => Ctl,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    } as any;
  };

  it('allows routes that do not require a module', async () => {
    const guard = new ModuleGuard(new Reflector(), { isEnabled: jest.fn() } as any);
    await expect(guard.canActivate(ctx({ company_id: 1 }))).resolves.toBe(true);
  });

  it('allows when the company has the module', async () => {
    const svc = { isEnabled: jest.fn().mockResolvedValue(true) };
    const guard = new ModuleGuard(new Reflector(), svc as any);
    await expect(guard.canActivate(ctx({ company_id: 7 }, 'attendance'))).resolves.toBe(true);
    expect(svc.isEnabled).toHaveBeenCalledWith(7, 'attendance');
  });

  it('rejects with MODULE_NOT_ENABLED when the module is off', async () => {
    const guard = new ModuleGuard(new Reflector(), {
      isEnabled: jest.fn().mockResolvedValue(false),
    } as any);
    const p = guard.canActivate(ctx({ company_id: 7 }, 'attendance'));
    await expect(p).rejects.toBeInstanceOf(ForbiddenException);
    await p.catch((e: ForbiddenException) => {
      expect(e.getResponse()).toMatchObject({ code: MODULE_NOT_ENABLED, module: 'attendance' });
    });
  });

  it('rejects when there is no company on the request', async () => {
    const guard = new ModuleGuard(new Reflector(), { isEnabled: jest.fn() } as any);
    await expect(guard.canActivate(ctx({}, 'attendance'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
