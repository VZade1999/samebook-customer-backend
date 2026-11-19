import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AccessService } from './access.service';
import { isPlatformRole } from './access.rules';

/**
 * Platform console routes: only SameBook Super Admins. Checked against the
 * database on every call (not the token), so taking the role away is immediate.
 * Use after AuthGuard.
 */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(private readonly access: AccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const user = req.user;
    if (!user?.user_id) throw new ForbiddenException('Only SameBook Super Admins can do this');
    const roles = await this.access.rolesOf(Number(user.user_id), Number(user.company_id));
    if (!roles.some((r) => isPlatformRole(r))) throw new ForbiddenException('Only SameBook Super Admins can do this');
    req.user.platform = true;
    return true;
  }
}
