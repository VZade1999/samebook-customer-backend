import { Inject, Injectable } from '@nestjs/common';
import { Op } from 'sequelize';
import { AppLogger } from '../common/logger/logger.service';
import { CompanyModulesService } from '../company-modules/company-modules.service';
import { CORE_MODULE_KEYS } from '../company-modules/module-catalog';

export interface NotifyInput {
  companyId: number;
  userIds: number[];
  module?: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  actorId?: number | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject('DATABASE_CONNECTION') private readonly dbProvider: any,
    private readonly appLogger: AppLogger,
    private readonly modules: CompanyModulesService,
  ) {}

  private get Notifications() {
    return this.dbProvider.db.notifications;
  }

  /**
   * Fire-and-forget: a notification failure must never break the action that
   * triggered it (e.g. assigning a task). The actor never notifies themself.
   */
  async notify(input: NotifyInput): Promise<void> {
    const recipients = [...new Set(input.userIds.map(Number))].filter(
      (id) => id && id !== Number(input.actorId),
    );
    if (!recipients.length) return;
    try {
      await this.Notifications.bulkCreate(
        recipients.map((user_id) => ({
          company_id: input.companyId,
          user_id,
          module: input.module ?? null,
          type: input.type,
          title: input.title.slice(0, 200),
          body: input.body ? String(input.body).slice(0, 500) : null,
          link: input.link ?? null,
          entity_type: input.entityType ?? null,
          entity_id: input.entityId ?? null,
          actor_id: input.actorId ?? null,
        })),
      );
    } catch (err) {
      this.appLogger
        .forContext('NotificationsService', 'notify', { companyId: input.companyId, type: input.type })
        .error('Could not create notification', err);
    }
  }

  // Notifications of add-ons the company has switched off are hidden.
  private async moduleFilter(companyId: number) {
    const enabled = [...CORE_MODULE_KEYS, ...(await this.modules.getEnabledModuleKeys(companyId))];
    return { [Op.or]: [{ module: null }, { module: { [Op.in]: enabled } }] };
  }

  async list(userId: number, companyId: number, opts: { unreadOnly?: boolean; limit?: number }) {
    const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50);
    const where: any = {
      user_id: userId,
      company_id: companyId,
      ...(opts.unreadOnly ? { is_read: 0 } : {}),
      [Op.and]: [await this.moduleFilter(companyId)],
    };
    const rows: any[] = await this.Notifications.findAll({
      where,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit,
      include: [
        {
          model: this.dbProvider.db.users,
          as: 'actor',
          attributes: ['id', 'first_name', 'last_name', 'email'],
          required: false,
        },
      ],
    });
    const unread = await this.unreadCount(userId, companyId);
    return {
      unread,
      rows: rows.map((n) => {
        const a = n.actor;
        return {
          id: n.id,
          module: n.module,
          type: n.type,
          title: n.title,
          body: n.body,
          link: n.link,
          entity_type: n.entity_type,
          entity_id: n.entity_id,
          is_read: !!Number(n.is_read),
          created_at: n.created_at,
          actor: a
            ? { id: a.id, name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email }
            : null,
        };
      }),
    };
  }

  async unreadCount(userId: number, companyId: number): Promise<number> {
    return this.Notifications.count({
      where: {
        user_id: userId,
        company_id: companyId,
        is_read: 0,
        [Op.and]: [await this.moduleFilter(companyId)],
      },
    });
  }

  async markRead(userId: number, companyId: number, id: number) {
    const [n] = await this.Notifications.update(
      { is_read: 1, read_at: new Date() },
      { where: { id, user_id: userId, company_id: companyId, is_read: 0 } },
    );
    return n;
  }

  async markAllRead(userId: number, companyId: number) {
    const [n] = await this.Notifications.update(
      { is_read: 1, read_at: new Date() },
      { where: { user_id: userId, company_id: companyId, is_read: 0 } },
    );
    return n;
  }
}
