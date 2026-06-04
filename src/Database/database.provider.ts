import { ConfigService } from '@nestjs/config';
import { Sequelize } from 'sequelize';
import { initModels } from 'src/models/init-models';
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

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS companies (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            company_prefix VARCHAR(10) NOT NULL DEFAULT '',
            legal_name VARCHAR(255) NULL,
            registration_number VARCHAR(150) NULL,
            tax_id VARCHAR(150) NULL,
            website VARCHAR(255) NULL,
            industry VARCHAR(150) NULL,
            primary_email VARCHAR(255) NULL,
            primary_phone VARCHAR(50) NULL,
            status VARCHAR(50) NULL DEFAULT 'active',
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (name),
            UNIQUE INDEX idx_company_prefix (company_prefix)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS products (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            company_id BIGINT NOT NULL,
            product_code VARCHAR(100) NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT NULL,
            unit VARCHAR(50) NULL DEFAULT 'pcs',
            price DECIMAL(12,2) NOT NULL DEFAULT 0.0,
            cost_price DECIMAL(12,2) NULL DEFAULT 0.0,
            tax_percentage DECIMAL(5,2) NULL DEFAULT 0.0,
            sku VARCHAR(100) NULL,
            barcode VARCHAR(100) NULL,
            stock_quantity INT NULL DEFAULT 0,
            minimum_stock INT NULL DEFAULT 0,
            is_active TINYINT NULL DEFAULT 1,
            image_url VARCHAR(500) NULL,
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            category_id BIGINT NULL,
            INDEX (company_id),
            INDEX (name),
            INDEX (sku),
            INDEX (category_id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS product_categories (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            company_id BIGINT NOT NULL,
            name VARCHAR(255) NOT NULL,
            description TEXT NULL,
            parent_category_id BIGINT NULL,
            is_active TINYINT NULL DEFAULT 1,
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (company_id),
            INDEX (parent_category_id),
            CONSTRAINT fk_product_categories_parent_category_id FOREIGN KEY (parent_category_id) REFERENCES product_categories(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS product_variants (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            product_id BIGINT NOT NULL,
            sku VARCHAR(150) NULL,
            attributes JSON NULL,
            price DECIMAL(12,2) NULL DEFAULT 0.0,
            compare_at_price DECIMAL(12,2) NULL DEFAULT 0.0,
            cost_price DECIMAL(12,2) NULL DEFAULT 0.0,
            is_default TINYINT NULL DEFAULT 0,
            is_active TINYINT NULL DEFAULT 1,
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (product_id),
            INDEX (sku),
            CONSTRAINT fk_product_variants_product_id FOREIGN KEY (product_id) REFERENCES products(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS product_images (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            product_id BIGINT NOT NULL,
            variant_id BIGINT NULL,
            url VARCHAR(1000) NULL,
            sort_order INT NULL DEFAULT 0,
            metadata JSON NULL,
            is_active TINYINT NULL DEFAULT 1,
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (product_id),
            INDEX (variant_id),
            CONSTRAINT fk_product_images_product_id FOREIGN KEY (product_id) REFERENCES products(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS product_inventory (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            product_id BIGINT NOT NULL,
            variant_id BIGINT NULL,
            stock_level INT NULL DEFAULT 0,
            stock_policy VARCHAR(50) NULL,
            warehouse_id BIGINT NULL,
            is_active TINYINT NULL DEFAULT 1,
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (product_id),
            INDEX (variant_id),
            CONSTRAINT fk_product_inventory_product_id FOREIGN KEY (product_id) REFERENCES products(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS product_metadata (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            product_id BIGINT NOT NULL,
            ` + "`key`" + ` VARCHAR(150) NOT NULL,
            value TEXT NULL,
            data_type VARCHAR(50) NULL,
            is_sensitive TINYINT NULL DEFAULT 0,
            is_active TINYINT NULL DEFAULT 1,
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (product_id),
            INDEX (` + "`key`" + `),
            CONSTRAINT fk_product_metadata_product_id FOREIGN KEY (product_id) REFERENCES products(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await sequelize.query(`
          ALTER TABLE companies
            ADD COLUMN IF NOT EXISTS company_prefix VARCHAR(10) NOT NULL DEFAULT '',
            ADD COLUMN IF NOT EXISTS legal_name VARCHAR(255) NULL,
            ADD COLUMN IF NOT EXISTS registration_number VARCHAR(150) NULL,
            ADD COLUMN IF NOT EXISTS tax_id VARCHAR(150) NULL,
            ADD COLUMN IF NOT EXISTS website VARCHAR(255) NULL,
            ADD COLUMN IF NOT EXISTS industry VARCHAR(150) NULL,
            ADD COLUMN IF NOT EXISTS primary_email VARCHAR(255) NULL,
            ADD COLUMN IF NOT EXISTS primary_phone VARCHAR(50) NULL,
            ADD COLUMN IF NOT EXISTS status VARCHAR(50) NULL DEFAULT 'active',
            ADD COLUMN IF NOT EXISTS is_active TINYINT NULL DEFAULT 1;
        `);

        await sequelize.query(`
          ALTER TABLE companies
            MODIFY COLUMN company_prefix VARCHAR(10) NOT NULL DEFAULT '';
        `);

        // Generate a temporary uppercase prefix for existing companies that do not already have one.
        await sequelize.query(`
          UPDATE companies
          SET company_prefix = UPPER(REPLACE(name, ' ', ''))
          WHERE company_prefix = '' OR company_prefix IS NULL;
        `);

        await sequelize.query(`
          UPDATE companies
          SET company_prefix = UPPER(REPLACE(company_prefix, ' ', ''))
          WHERE company_prefix IS NOT NULL;
        `);

        await sequelize.query(`
          UPDATE companies c
          JOIN (
            SELECT company_prefix, COUNT(*) AS cnt
            FROM companies
            GROUP BY company_prefix
            HAVING COUNT(*) > 1
          ) dup ON c.company_prefix = dup.company_prefix
          SET c.company_prefix = LEFT(CONCAT(LEFT(c.company_prefix, 6), LPAD(c.id, 4, '0')), 10)
          WHERE c.company_prefix = dup.company_prefix;
        `);

        try {
          await sequelize.query(`
            CREATE UNIQUE INDEX idx_company_prefix ON companies (company_prefix);
          `);
        } catch (err) {
          // index may already exist
        }

        await sequelize.query(`
          UPDATE companies
          SET primary_email = email
          WHERE primary_email IS NULL AND email IS NOT NULL;
        `);

        await sequelize.query(`
          UPDATE companies
          SET primary_phone = phone
          WHERE primary_phone IS NULL AND phone IS NOT NULL;
        `);

        await sequelize.query(`
          UPDATE companies
          SET status = CASE
            WHEN is_active = 1 THEN 'active'
            WHEN is_active = 0 THEN 'inactive'
            ELSE 'active'
          END
          WHERE status IS NULL;
        `);

        await sequelize.query(`
          ALTER TABLE company_addresses
            ADD COLUMN IF NOT EXISTS is_active TINYINT NULL DEFAULT 1;
        `);

        await sequelize.query(`
          ALTER TABLE company_locations
            ADD COLUMN IF NOT EXISTS is_active TINYINT NULL DEFAULT 1,
            ADD COLUMN IF NOT EXISTS address_line_1 VARCHAR(255) NULL,
            ADD COLUMN IF NOT EXISTS address_line_2 VARCHAR(255) NULL,
            ADD COLUMN IF NOT EXISTS address_city VARCHAR(100) NULL,
            ADD COLUMN IF NOT EXISTS address_state VARCHAR(100) NULL,
            ADD COLUMN IF NOT EXISTS address_country VARCHAR(100) NULL,
            ADD COLUMN IF NOT EXISTS address_postal_code VARCHAR(50) NULL;
        `);

        await sequelize.query(`
          ALTER TABLE company_metadata
            ADD COLUMN IF NOT EXISTS is_active TINYINT NULL DEFAULT 1;
        `);

        await sequelize.query(`
          ALTER TABLE quotations
            ADD COLUMN IF NOT EXISTS document_type VARCHAR(10) NOT NULL DEFAULT 'QT',
            ADD COLUMN IF NOT EXISTS daily_sequence INT NULL,
            ADD COLUMN IF NOT EXISTS overall_sequence INT NULL;
        `);

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS company_addresses (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            company_id BIGINT NOT NULL,
            type VARCHAR(50) NULL,
            label VARCHAR(150) NULL,
            line_1 VARCHAR(255) NULL,
            line_2 VARCHAR(255) NULL,
            city VARCHAR(100) NULL,
            state VARCHAR(100) NULL,
            country VARCHAR(100) NULL,
            postal_code VARCHAR(50) NULL,
            phone VARCHAR(50) NULL,
            fax VARCHAR(50) NULL,
            notes TEXT NULL,
            is_default TINYINT NULL DEFAULT 0,
            is_active TINYINT NULL DEFAULT 1,
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (company_id),
            CONSTRAINT fk_company_addresses_company_id FOREIGN KEY (company_id) REFERENCES companies(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS company_locations (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            company_id BIGINT NOT NULL,
            name VARCHAR(255) NULL,
            location_type VARCHAR(100) NULL,
            address_id BIGINT NULL,
            manager_name VARCHAR(150) NULL,
            manager_phone VARCHAR(50) NULL,
            capacity VARCHAR(100) NULL,
            operational_hours VARCHAR(255) NULL,
            address_line_1 VARCHAR(255) NULL,
            address_line_2 VARCHAR(255) NULL,
            address_city VARCHAR(100) NULL,
            address_state VARCHAR(100) NULL,
            address_country VARCHAR(100) NULL,
            address_postal_code VARCHAR(50) NULL,
            notes TEXT NULL,
            is_active TINYINT NULL DEFAULT 1,
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (company_id),
            INDEX (address_id),
            CONSTRAINT fk_company_locations_company_id FOREIGN KEY (company_id) REFERENCES companies(id),
            CONSTRAINT fk_company_locations_address_id FOREIGN KEY (address_id) REFERENCES company_addresses(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS company_metadata (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            company_id BIGINT NOT NULL,
            \`key\` VARCHAR(150) NOT NULL,
            value TEXT NULL,
            data_type VARCHAR(50) NULL,
            is_sensitive TINYINT NULL DEFAULT 0,            is_active TINYINT NULL DEFAULT 1,            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (company_id),
            INDEX (\`key\`),
            CONSTRAINT fk_company_metadata_company_id FOREIGN KEY (company_id) REFERENCES companies(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        await sequelize.query(`
          CREATE TABLE IF NOT EXISTS quotations (
            id BIGINT AUTO_INCREMENT PRIMARY KEY,
            company_id BIGINT NULL,
            quotation_number VARCHAR(100) NULL,
            document_type VARCHAR(10) NOT NULL DEFAULT 'QT',
            daily_sequence INT NULL,
            overall_sequence INT NULL,
            customer_name VARCHAR(255) NOT NULL,
            customer_address TEXT NULL,
            customer_phone VARCHAR(50) NULL,
            customer_email VARCHAR(150) NULL,
            business_name VARCHAR(255) NULL,
            business_address TEXT NULL,
            business_gst VARCHAR(100) NULL,
            business_phone VARCHAR(50) NULL,
            business_email VARCHAR(150) NULL,
            sub_total DECIMAL(12, 2) NULL DEFAULT 0.0,
            discount DECIMAL(5, 2) NULL DEFAULT 0.0,
            gst DECIMAL(5, 2) NULL DEFAULT 0.0,
            transport DECIMAL(12, 2) NULL DEFAULT 0.0,
            grand_total DECIMAL(12, 2) NULL DEFAULT 0.0,
            validity VARCHAR(50) NULL,
            delivery_time VARCHAR(255) NULL,
            notes TEXT NULL,
            items TEXT NULL,
            is_active TINYINT NULL DEFAULT 1,
            created_at DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX (company_id),
            INDEX (quotation_number),
            INDEX (company_id, document_type, created_at),
            INDEX (company_id, document_type, overall_sequence),
            CONSTRAINT fk_quotations_company_id FOREIGN KEY (company_id) REFERENCES companies(id)
          ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        `);

        return { db, sequelize };
      } catch (error) {
        throw error;
      }
    },
  },
];
