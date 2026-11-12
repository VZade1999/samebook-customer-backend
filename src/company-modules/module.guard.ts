import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CompanyModulesService } from './company-modules.service';
import { getModuleDefinition } from './module-catalog';
import { REQUIRE_MODULE_KEY } from './require-module.decorator';

export const MODULE_NOT_ENABLED = 'MODULE_NOT_ENABLED';

/**
 * Hard enforcement for add-ons: checks the company's module state on every
 * request (cached briefly), so disconnecting takes effect immediately even for
 * users whose JWT still lists the module's permissions. Must run after AuthGuard.
 */
@Injectable()
export class ModuleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly modules: CompanyModulesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(REQUIRE_MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!key) return true;

    const req = context.switchToHttp().getRequest();
    const companyId = req.user?.company_id;
    if (companyId && (await this.modules.isEnabled(companyId, key))) return true;

    const name = getModuleDefinition(key)?.name ?? key;
    throw new ForbiddenException({
      success: false,
      message: `${name} is not enabled for your company`,
      code: MODULE_NOT_ENABLED,
      module: key,
    });
  }
}
