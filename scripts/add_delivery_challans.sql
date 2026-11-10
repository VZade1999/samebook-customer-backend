-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Adds the Delivery Challan (DC) feature: three NEW tables plus the challans.* permissions.
-- No existing table is altered.
-- Safe to run more than once: tables use CREATE TABLE IF NOT EXISTS and every
-- permission/grant insert is guarded, so re-running is a no-op.
-- Permissions are read from the access token, so affected users must log in again
-- (or wait for a token refresh) before the new grants take effect.

CREATE TABLE IF NOT EXISTS `delivery_challans` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `challan_number` VARCHAR(64) NOT NULL,
  `challan_date` DATE NOT NULL,
  `reason` VARCHAR(32) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  `quotation_id` BIGINT NULL DEFAULT NULL,
  `invoice_id` BIGINT NULL DEFAULT NULL,
  `customer_id` BIGINT NULL DEFAULT NULL,
  `customer_name` VARCHAR(255) NULL DEFAULT NULL,
  `customer_gst_number` VARCHAR(20) NULL DEFAULT NULL,
  `billing_address_snapshot` JSON NULL,
  `shipping_address_snapshot` JSON NULL,
  `place_of_supply` VARCHAR(100) NULL DEFAULT NULL,
  `from_warehouse_id` BIGINT NULL DEFAULT NULL,
  `to_warehouse_id` BIGINT NULL DEFAULT NULL,
  `transporter_name` VARCHAR(255) NULL DEFAULT NULL,
  `vehicle_number` VARCHAR(32) NULL DEFAULT NULL,
  `eway_bill_number` VARCHAR(32) NULL DEFAULT NULL,
  `notes` TEXT NULL,
  `total_quantity` DECIMAL(14,3) NULL DEFAULT 0,
  `total_value` DECIMAL(14,2) NULL DEFAULT 0,
  `affects_stock` TINYINT NULL DEFAULT 1,
  `overall_sequence` INT NOT NULL,
  `dispatched_at` DATETIME NULL DEFAULT NULL,
  `delivered_at` DATETIME NULL DEFAULT NULL,
  `cancelled_at` DATETIME NULL DEFAULT NULL,
  `created_by` BIGINT NULL DEFAULT NULL,
  `updated_by` BIGINT NULL DEFAULT NULL,
  `is_active` TINYINT NULL DEFAULT 1,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_dc_company_number` (`company_id`, `challan_number`),
  KEY `idx_dc_company_status` (`company_id`, `status`),
  KEY `idx_dc_quotation` (`quotation_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `delivery_challan_items` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `delivery_challan_id` BIGINT NOT NULL,
  `quotation_item_id` BIGINT NULL DEFAULT NULL,
  `product_id` BIGINT NULL DEFAULT NULL,
  `variant_id` BIGINT NULL DEFAULT NULL,
  `item_name` VARCHAR(255) NOT NULL,
  `description` TEXT NULL,
  `hsn_code` VARCHAR(20) NULL DEFAULT NULL,
  `quantity` DECIMAL(14,3) NOT NULL,
  `unit` VARCHAR(32) NULL DEFAULT NULL,
  `rate` DECIMAL(14,2) NULL DEFAULT 0,
  `value` DECIMAL(14,2) NULL DEFAULT 0,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dci_challan` (`delivery_challan_id`),
  KEY `idx_dci_quotation_item` (`quotation_item_id`),
  CONSTRAINT `fk_dci_challan` FOREIGN KEY (`delivery_challan_id`) REFERENCES `delivery_challans` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `delivery_challan_activity_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `delivery_challan_id` BIGINT NOT NULL,
  `action` VARCHAR(32) NOT NULL,
  `old_value` JSON NULL,
  `new_value` JSON NULL,
  `changed_by` BIGINT NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_dcal_challan` (`delivery_challan_id`),
  CONSTRAINT `fk_dcal_challan` FOREIGN KEY (`delivery_challan_id`) REFERENCES `delivery_challans` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Permissions
INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'challans.view' AS name, 'challans' AS module_name, 'View delivery challans' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'challans.view');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'challans.create' AS name, 'challans' AS module_name, 'Create delivery challans' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'challans.create');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'challans.edit' AS name, 'challans' AS module_name, 'Edit draft delivery challans' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'challans.edit');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'challans.delete' AS name, 'challans' AS module_name, 'Delete draft delivery challans' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'challans.delete');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'challans.dispatch' AS name, 'challans' AS module_name, 'Dispatch, mark delivered and cancel delivery challans' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'challans.dispatch');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'challans.convert' AS name, 'challans' AS module_name, 'Convert delivery challans to invoice' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'challans.convert');

-- Granted directly to ADMIN and SUPER_ADMIN roles by name (same pattern as
-- add_rbac_permissions.sql).
INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.name IN (
  'challans.view', 'challans.create', 'challans.edit',
  'challans.delete', 'challans.dispatch', 'challans.convert'
)
WHERE r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
