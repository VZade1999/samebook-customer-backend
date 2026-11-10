import { BadRequestException } from '@nestjs/common';
import { Op } from 'sequelize';

/**
 * Validates that every role id is a positive integer and refers to a role the
 * caller's company may assign: one owned by that company, or a shared system
 * role. Rejects the whole request (instead of silently dropping ids) when any
 * id is malformed, unknown, or belongs to another company.
 * Returns the de-duplicated list of numeric role ids.
 */
export async function assertAssignableRoleIds(
  db: any,
  companyId: number,
  roleIds: unknown,
): Promise<number[]> {
  if (!Array.isArray(roleIds)) {
    throw new BadRequestException('role_ids must be an array');
  }

  const ids = roleIds.map((id) => Number(id));

  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new BadRequestException('role_ids must contain positive integers');
  }

  const uniqueIds = [...new Set(ids)];

  if (!uniqueIds.length) {
    return uniqueIds;
  }

  const count = await db.db.roles.count({
    where: {
      id: { [Op.in]: uniqueIds },
      [Op.or]: [{ company_id: companyId }, { is_system: 1 }],
    },
  });

  if (count !== uniqueIds.length) {
    throw new BadRequestException('One or more roles are invalid');
  }

  return uniqueIds;
}
