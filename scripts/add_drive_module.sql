-- Run against the SameBook MySQL/MariaDB database (no migration tooling exists in this repo).
-- Drive add-on (module key 'drive'): a company file drive with nested folders, files with
-- name / description / tags, full version history (every upload is kept) and an activity
-- log of who changed what and when. There is intentionally NO delete: files and versions
-- are never removed; restoring an old version adds a new version on top.
-- Adds permissions drive.view / drive.create / drive.update and grants all three to the
-- ADMIN and SUPER_ADMIN system roles. Other roles get access when an admin connects the
-- add-on (Apps & Add-ons) and ticks them.
-- Additive only; safe to run more than once.

CREATE TABLE IF NOT EXISTS `drive_folders` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `parent_id` BIGINT NULL DEFAULT NULL,
  `name` VARCHAR(120) NOT NULL,
  `description` VARCHAR(500) NULL DEFAULT NULL,
  `color` VARCHAR(20) NULL DEFAULT NULL,
  `created_by` BIGINT NOT NULL,
  `updated_by` BIGINT NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_drive_folders_parent` (`company_id`, `parent_id`),
  CONSTRAINT `fk_drive_folders_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_drive_folders_parent_id` FOREIGN KEY (`parent_id`) REFERENCES `drive_folders` (`id`),
  CONSTRAINT `fk_drive_folders_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_drive_folders_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `drive_files` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `folder_id` BIGINT NULL DEFAULT NULL,
  `name` VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  -- Normalised, lower-case, comma-wrapped: ",invoice,2026," so one tag matches with LIKE '%,tag,%'.
  `tags` VARCHAR(600) NULL DEFAULT NULL,
  `extension` VARCHAR(20) NULL DEFAULT NULL,
  `mime_type` VARCHAR(150) NULL DEFAULT NULL,
  `size_bytes` BIGINT NOT NULL DEFAULT 0,
  `current_version` INT NOT NULL DEFAULT 1,
  `created_by` BIGINT NOT NULL,
  `updated_by` BIGINT NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_drive_files_folder` (`company_id`, `folder_id`),
  KEY `idx_drive_files_updated` (`company_id`, `updated_at`),
  CONSTRAINT `fk_drive_files_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_drive_files_folder_id` FOREIGN KEY (`folder_id`) REFERENCES `drive_folders` (`id`),
  CONSTRAINT `fk_drive_files_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_drive_files_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `drive_file_versions` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `file_id` BIGINT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `version_no` INT NOT NULL,
  `storage_key` VARCHAR(300) NOT NULL,
  `original_name` VARCHAR(255) NOT NULL,
  `extension` VARCHAR(20) NULL DEFAULT NULL,
  `mime_type` VARCHAR(150) NULL DEFAULT NULL,
  `size_bytes` BIGINT NOT NULL DEFAULT 0,
  `checksum_sha256` CHAR(64) NULL DEFAULT NULL,
  `note` VARCHAR(500) NULL DEFAULT NULL,
  -- Set when this version re-publishes an older one (restore).
  `restored_from` INT NULL DEFAULT NULL,
  `uploaded_by` BIGINT NOT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_drive_versions_file_no` (`file_id`, `version_no`),
  KEY `idx_drive_versions_company` (`company_id`),
  CONSTRAINT `fk_drive_versions_file_id` FOREIGN KEY (`file_id`) REFERENCES `drive_files` (`id`),
  CONSTRAINT `fk_drive_versions_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_drive_versions_uploaded_by` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `drive_activity` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `file_id` BIGINT NULL DEFAULT NULL,
  `folder_id` BIGINT NULL DEFAULT NULL,
  `user_id` BIGINT NULL DEFAULT NULL,
  `action` VARCHAR(30) NOT NULL,
  `field` VARCHAR(30) NULL DEFAULT NULL,
  `old_value` VARCHAR(500) NULL DEFAULT NULL,
  `new_value` VARCHAR(500) NULL DEFAULT NULL,
  `version_no` INT NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_drive_activity_company` (`company_id`, `created_at`),
  KEY `idx_drive_activity_file` (`file_id`, `created_at`),
  KEY `idx_drive_activity_folder` (`folder_id`, `created_at`),
  CONSTRAINT `fk_drive_activity_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_drive_activity_file_id` FOREIGN KEY (`file_id`) REFERENCES `drive_files` (`id`),
  CONSTRAINT `fk_drive_activity_folder_id` FOREIGN KEY (`folder_id`) REFERENCES `drive_folders` (`id`),
  CONSTRAINT `fk_drive_activity_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'drive.view' AS name, 'drive' AS module_name, 'Browse, preview and download files in Drive' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'drive.view');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'drive.create' AS name, 'drive' AS module_name, 'Create folders and upload new files to Drive' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'drive.create');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'drive.update' AS name, 'drive' AS module_name, 'Rename, tag, move and upload new versions of Drive files and folders' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'drive.update');

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.name IN ('drive.view', 'drive.create', 'drive.update')
WHERE r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND r.is_system = 1
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
