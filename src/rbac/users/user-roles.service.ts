import { Injectable, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { AccessService } from '../access.service';

/** A person's roles (kept as its own route for older screens). */
@Injectable()
export class UserRolesService {
  constructor(
    private readonly users: UsersService,
    private readonly access: AccessService,
  ) {}

  async getUserRoles(companyId: number, userId: number) {
    const people = await this.access.companyPeople(companyId);
    const p = people.find((x) => x.id === Number(userId));
    if (!p) throw new NotFoundException('User not found');
    return {
      user_id: p.id,
      user_name: p.name,
      roles: p.roles.map((r) => ({ id: r.id, name: r.name, level: r.level, scope: r.scope, description: r.description ?? null })),
    };
  }

  /** Same rules as editing the person: only roles below your level, only people below you. */
  async assignRoles(companyId: number, userId: number, roleIds: unknown, callerId?: number) {
    await this.users.setRoles(companyId, userId, roleIds, callerId);
    return { message: 'Roles saved' };
  }
}
