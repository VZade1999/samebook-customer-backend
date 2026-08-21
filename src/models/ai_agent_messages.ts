import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface ai_agent_messagesAttributes {
  id: number;
  user_id: number;
  company_id: number;
  role: string;
  content: string;
  created_at?: Date;
}

export type ai_agent_messagesPk = 'id';
export type ai_agent_messagesId = ai_agent_messages[ai_agent_messagesPk];
export type ai_agent_messagesOptionalAttributes = 'id' | 'created_at';
export type ai_agent_messagesCreationAttributes = Optional<
  ai_agent_messagesAttributes,
  ai_agent_messagesOptionalAttributes
>;

export class ai_agent_messages
  extends Model<ai_agent_messagesAttributes, ai_agent_messagesCreationAttributes>
  implements ai_agent_messagesAttributes
{
  id!: number;
  user_id!: number;
  company_id!: number;
  role!: string;
  content!: string;
  created_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof ai_agent_messages {
    return ai_agent_messages.init(
      {
        id: {
          autoIncrement: true,
          type: DataTypes.BIGINT,
          allowNull: false,
          primaryKey: true,
        },
        user_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        company_id: {
          type: DataTypes.BIGINT,
          allowNull: false,
        },
        role: {
          type: DataTypes.STRING(20),
          allowNull: false,
        },
        content: {
          type: DataTypes.TEXT,
          allowNull: false,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: true,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'ai_agent_messages',
        underscored: true,
        timestamps: false,
        indexes: [
          { name: 'PRIMARY', unique: true, using: 'BTREE', fields: [{ name: 'id' }] },
          {
            name: 'idx_ai_agent_messages_user_created',
            using: 'BTREE',
            fields: [{ name: 'user_id' }, { name: 'created_at' }],
          },
          {
            name: 'idx_ai_agent_messages_company_id',
            using: 'BTREE',
            fields: [{ name: 'company_id' }],
          },
        ],
      },
    );
  }
}
