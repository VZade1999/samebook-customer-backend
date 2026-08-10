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
        console.log('DB connection config', {
          name: config.get('DB_NAME'),
          user: config.get('DB_USER'),
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
            dialectOptions: {
              connectTimeout: 20000,
              enableKeepAlive: true,
              keepAliveInitialDelay: 0,
            },
            pool: {
              // Each serverless invocation gets its own pool, so a large max
              // buys nothing and just multiplies total connections opened
              // against the DB under concurrent cold starts.
              max: 3,
              min: 0,
              // Shorter than most shared-hosting MySQL `wait_timeout` values —
              // recycle a pooled connection before the remote host silently
              // kills it server-side. A pool that thinks a dead connection is
              // still valid is what actually produces ETIMEDOUT/hangs on the
              // next query, not a fresh connect attempt.
              idle: 10000,
              evict: 15000,
              acquire: 20000,
            },
            retry: {
              max: 3,
              match: [
                /ETIMEDOUT/,
                /ECONNRESET/,
                /ECONNREFUSED/,
                /EHOSTUNREACH/,
                /ENOTFOUND/,
                /SequelizeConnectionError/,
                /SequelizeConnectionRefusedError/,
                /SequelizeHostNotFoundError/,
                /SequelizeHostNotReachableError/,
                /SequelizeInvalidConnectionError/,
                /SequelizeConnectionTimedOutError/,
              ],
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
