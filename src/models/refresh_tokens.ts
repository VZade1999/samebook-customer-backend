import * as Sequelize from 'sequelize';
import { DataTypes, Model, Optional } from 'sequelize';

export interface refresh_tokensAttributes {
  id: number;
  user_id: number;
  token_hash: string;
  expires_at: Date;
  revoked_at?: Date | null;
  replaced_by_token_hash?: string | null;
  created_at?: Date;
}

export type refresh_tokensPk = 'id';
export type refresh_tokensId = refresh_tokens[refresh_tokensPk];

export type refresh_tokensOptionalAttributes =
  | 'id'
  | 'revoked_at'
  | 'replaced_by_token_hash'
  | 'created_at';

export type refresh_tokensCreationAttributes = Optional<
  refresh_tokensAttributes,
  refresh_tokensOptionalAttributes
>;

export class refresh_tokens
  extends Model<refresh_tokensAttributes, refresh_tokensCreationAttributes>
  implements refresh_tokensAttributes
{
  id!: number;
  user_id!: number;
  token_hash!: string;
  expires_at!: Date;
  revoked_at?: Date | null;
  replaced_by_token_hash?: string | null;
  created_at?: Date;

  static initModel(sequelize: Sequelize.Sequelize): typeof refresh_tokens {
    return refresh_tokens.init(
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
          references: {
            model: 'users',
            key: 'id',
          },
        },
        token_hash: {
          type: DataTypes.CHAR(64),
          allowNull: false,
          unique: true,
        },
        expires_at: {
          type: DataTypes.DATE,
          allowNull: false,
        },
        revoked_at: {
          type: DataTypes.DATE,
          allowNull: true,
        },
        replaced_by_token_hash: {
          type: DataTypes.CHAR(64),
          allowNull: true,
        },
        created_at: {
          type: DataTypes.DATE,
          allowNull: false,
          defaultValue: Sequelize.Sequelize.literal('CURRENT_TIMESTAMP'),
        },
      },
      {
        sequelize,
        tableName: 'refresh_tokens',
        timestamps: false,
        indexes: [
          {
            name: 'PRIMARY',
            unique: true,
            using: 'BTREE',
            fields: [{ name: 'id' }],
          },
          {
            name: 'token_hash',
            unique: true,
            fields: [{ name: 'token_hash' }],
          },
          {
            name: 'user_id',
            fields: [{ name: 'user_id' }],
          },
        ],
      },
    );
  }
}
