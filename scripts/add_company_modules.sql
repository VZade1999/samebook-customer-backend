-- Run against the SameBook MySQL/MariaDB database (no migration tooling exists in this repo).
-- Per-company add-on modules (first add-on: 'attendance' = Attendance & Leave).
-- Billing is core and has no row here. A company with no row for a module has it OFF,
-- so NO rows are seeded: every company, including existing ones, starts with add-ons off.
-- Also adds the 'company.modules.manage' permission (connect/disconnect add-ons) and grants
-- it to the ADMIN and SUPER_ADMIN system roles.
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS `company_modules` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `module_key` VARCHAR(50) NOT NULL,
  `enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `plan` VARCHAR(30) NOT NULL DEFAULT 'FREE',
  `enabled_by` BIGINT NULL DEFAULT NULL,
  `enabled_at` DATETIME NULL DEFAULT NULL,
  `disabled_by` BIGINT NULL DEFAULT NULL,
  `disabled_at` DATETIME NULL DEFAULT NULL,
  `expires_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_company_modules_company_module` (`company_id`, `module_key`),
  KEY `enabled_by` (`enabled_by`),
  KEY `disabled_by` (`disabled_by`),
  CONSTRAINT `fk_company_modules_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_company_modules_enabled_by` FOREIGN KEY (`enabled_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_company_modules_disabled_by` FOREIGN KEY (`disabled_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'company.modules.manage' AS name, 'company' AS module_name, 'Connect and disconnect add-on modules for the company' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'company.modules.manage');

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.name = 'company.modules.manage'
WHERE r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND r.is_system = 1
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
