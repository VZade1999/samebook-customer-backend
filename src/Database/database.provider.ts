import { ConfigService } from '@nestjs/config';
import { Sequelize } from 'sequelize';
import { initModels } from '../models/init-models';
// import { getParameters } from '../aws/ssm';


const NODE_ENV = process.env.NODE_ENV;

export const databaseProviders = [
  {
    inject: [ConfigService],
    provide: 'DATABASE_CONNECTION',
    useFactory: async (config: ConfigService): Promise<any> => {
      try {
        console.log('SSM Config FROM ECS', {
          name: config.get('DB_NAME'),
          user: config.get('DB_USER'),
          pass: config.get('DB_PASS'),
          host: config.get('DB_HOST'),
        });
        // if (!NODE_ENV || NODE_ENV === 'local') {
        const sequelize = new Sequelize(
          config.get('DB_NAME') || '',
          config.get('DB_USER') || '',
          config.get('DB_PASS') || '',
          {
            dialect: config.get('DB_DIALECT') || 'mysql',
            host: config.get('DB_HOST'),
            dialectModule: require('mysql2'),
            port: config.get('DB_PORT') || 3306,
            define: {
              timestamps: true,
            },
            pool: {
              max: 5,
              min: 0,
              idle: 20000,
            },
          },
        );
        const db = initModels(sequelize);

        return { db, sequelize };
      } catch (error) {
        throw error;
      }
    },
  },
];
