import { Injectable } from '@nestjs/common';
import { RolesService } from './roles.service';

/** A role's permissions (its own routes, kept for older screens). */
@Injectable()
export class RolePermissionsService {
  constructor(private readonly roles: RolesService) {}

  async getRolePermissions(companyId: number, roleId: number, callerId?: number) {
    return this.roles.getRolePermissions(companyId, roleId, callerId);
  }

  async assignPermissions(companyId: number, roleId: number, permissionIds: unknown, callerId?: number) {
    return this.roles.setPermissions(companyId, roleId, permissionIds, callerId);
  }
}
