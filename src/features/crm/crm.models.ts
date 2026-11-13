import * as Sequelize from 'sequelize';
import { DataTypes, Model } from 'sequelize';

const now = () => ({
  type: DataTypes.DATE,
  allowNull: true,
  defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
});
const updatedAt = () => ({
  type: DataTypes.DATE,
  allowNull: false,
  defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
});

export class crm_leads extends Model<any, any> {}
export class crm_enquiries extends Model<any, any> {}
export class crm_activities extends Model<any, any> {}
export class crm_lead_sources extends Model<any, any> {}

/**
 * Registers the CRM models + associations on the shared `db` object, owned by
 * the feature (the core init-models knows nothing about the CRM). Idempotent.
 */
export function registerCrmModels(sequelize: Sequelize.Sequelize, db: Record<string, any>) {
  if (db.crm_leads) return;
  const { users, customers } = db;
  const opts = (tableName: string) => ({ sequelize, tableName, underscored: true, timestamps: false });

  crm_lead_sources.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      type: { type: DataTypes.STRING(20), allowNull: false },
      name: { type: DataTypes.STRING(100), allowNull: false },
      is_active: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 1 },
      token_hash: { type: DataTypes.CHAR(64), allowNull: true },
      secret_enc: { type: DataTypes.TEXT, allowNull: true },
      settings: { type: DataTypes.TEXT, allowNull: true },
      rr_cursor: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      sync_cursor: { type: DataTypes.DATE, allowNull: true },
      last_sync_at: { type: DataTypes.DATE, allowNull: true },
      last_sync_status: { type: DataTypes.STRING(20), allowNull: true },
      last_sync_message: { type: DataTypes.STRING(300), allowNull: true },
      sync_lock_until: { type: DataTypes.DATE, allowNull: true },
      last_lead_at: { type: DataTypes.DATE, allowNull: true },
      leads_total: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      created_by: { type: DataTypes.BIGINT, allowNull: false },
      updated_by: { type: DataTypes.BIGINT, allowNull: true },
      created_at: now(),
      updated_at: updatedAt(),
    },
    opts('crm_lead_sources'),
  );

  crm_leads.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      lead_number: { type: DataTypes.INTEGER, allowNull: false },
      name: { type: DataTypes.STRING(150), allowNull: false },
      company_name: { type: DataTypes.STRING(200), allowNull: true },
      phone: { type: DataTypes.STRING(20), allowNull: true },
      alt_phone: { type: DataTypes.STRING(20), allowNull: true },
      email: { type: DataTypes.STRING(200), allowNull: true },
      gst_number: { type: DataTypes.STRING(20), allowNull: true },
      address: { type: DataTypes.STRING(500), allowNull: true },
      city: { type: DataTypes.STRING(100), allowNull: true },
      state: { type: DataTypes.STRING(100), allowNull: true },
      pincode: { type: DataTypes.STRING(10), allowNull: true },
      country: { type: DataTypes.STRING(60), allowNull: true },
      requirement: { type: DataTypes.STRING(300), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: true },
      estimated_value: { type: DataTypes.DECIMAL(14, 2), allowNull: true },
      source: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'OTHER' },
      source_id: { type: DataTypes.BIGINT, allowNull: true },
      source_detail: { type: DataTypes.STRING(100), allowNull: true },
      stage: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'NEW' },
      rating: { type: DataTypes.STRING(10), allowNull: true },
      owner_id: { type: DataTypes.BIGINT, allowNull: true },
      next_follow_up_at: { type: DataTypes.DATE, allowNull: true },
      follow_up_note: { type: DataTypes.STRING(300), allowNull: true },
      last_activity_at: { type: DataTypes.DATE, allowNull: true },
      first_response_at: { type: DataTypes.DATE, allowNull: true },
      lost_reason: { type: DataTypes.STRING(300), allowNull: true },
      won_at: { type: DataTypes.DATE, allowNull: true },
      lost_at: { type: DataTypes.DATE, allowNull: true },
      customer_id: { type: DataTypes.BIGINT, allowNull: true },
      converted_at: { type: DataTypes.DATE, allowNull: true },
      converted_by: { type: DataTypes.BIGINT, allowNull: true },
      quote_sync_id: { type: DataTypes.BIGINT, allowNull: true },
      enquiry_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
      received_at: { type: DataTypes.DATE, allowNull: true },
      created_by: { type: DataTypes.BIGINT, allowNull: true },
      is_deleted: { type: DataTypes.TINYINT, allowNull: false, defaultValue: 0 },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      created_at: now(),
      updated_at: updatedAt(),
    },
    opts('crm_leads'),
  );

  crm_enquiries.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      lead_id: { type: DataTypes.BIGINT, allowNull: false },
      source: { type: DataTypes.STRING(20), allowNull: false },
      source_id: { type: DataTypes.BIGINT, allowNull: true },
      source_ref: { type: DataTypes.STRING(100), allowNull: true },
      source_detail: { type: DataTypes.STRING(100), allowNull: true },
      subject: { type: DataTypes.STRING(300), allowNull: true },
      message: { type: DataTypes.TEXT, allowNull: true },
      received_at: { type: DataTypes.DATE, allowNull: true },
      raw: { type: DataTypes.TEXT('medium'), allowNull: true },
      created_at: now(),
    },
    opts('crm_enquiries'),
  );

  crm_activities.init(
    {
      id: { autoIncrement: true, type: DataTypes.BIGINT, allowNull: false, primaryKey: true },
      company_id: { type: DataTypes.BIGINT, allowNull: false },
      lead_id: { type: DataTypes.BIGINT, allowNull: false },
      user_id: { type: DataTypes.BIGINT, allowNull: true },
      type: { type: DataTypes.STRING(20), allowNull: false },
      outcome: { type: DataTypes.STRING(30), allowNull: true },
      body: { type: DataTypes.TEXT, allowNull: true },
      meta: { type: DataTypes.STRING(1000), allowNull: true },
      created_at: now(),
    },
    opts('crm_activities'),
  );

  crm_leads.belongsTo(users, { as: 'owner', foreignKey: 'owner_id' });
  crm_leads.belongsTo(users, { as: 'creator', foreignKey: 'created_by' });
  crm_leads.belongsTo(customers, { as: 'customer', foreignKey: 'customer_id' });
  crm_leads.belongsTo(crm_lead_sources, { as: 'integration', foreignKey: 'source_id' });
  crm_activities.belongsTo(users, { as: 'user', foreignKey: 'user_id' });
  crm_enquiries.belongsTo(crm_lead_sources, { as: 'integration', foreignKey: 'source_id' });
  crm_lead_sources.belongsTo(users, { as: 'creator', foreignKey: 'created_by' });

  Object.assign(db, { crm_leads, crm_enquiries, crm_activities, crm_lead_sources });
}
