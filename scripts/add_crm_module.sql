-- Run against the SameBook MySQL/MariaDB database (no migration tooling exists in this repo).
-- CRM add-on (module key 'crm'): leads with a sales pipeline, follow-ups and an activity
-- timeline; lead sources (IndiaMART pull + push, website / generic webhook) that bring
-- enquiries in automatically; and the lead -> customer -> quotation hand-off.
-- Adds permissions crm.view / crm.create / crm.manage and grants all three to the ADMIN and
-- SUPER_ADMIN system roles. Other roles get access when an admin connects the add-on
-- (Apps & Add-ons) and ticks them.
-- Tables use utf8mb4_unicode_ci like customers / quotations, so lead <-> customer matching
-- never hits "Illegal mix of collations".
-- Additive only; safe to run more than once.

CREATE TABLE IF NOT EXISTS `crm_lead_sources` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `type` VARCHAR(20) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  -- SHA-256 of the secret part of the intake (webhook) URL; the URL itself is in secret_enc.
  `token_hash` CHAR(64) NULL DEFAULT NULL,
  -- AES-256-GCM encrypted JSON: { token, api_key }.
  `secret_enc` TEXT NULL,
  -- Plain JSON: assignment rule, lead tag, default rating, thank-you URL.
  `settings` TEXT NULL,
  `rr_cursor` INT NOT NULL DEFAULT 0,
  -- IndiaMART pull: end of the last window fetched successfully (UTC).
  `sync_cursor` DATETIME NULL DEFAULT NULL,
  `last_sync_at` DATETIME NULL DEFAULT NULL,
  `last_sync_status` VARCHAR(20) NULL DEFAULT NULL,
  `last_sync_message` VARCHAR(300) NULL DEFAULT NULL,
  `sync_lock_until` DATETIME NULL DEFAULT NULL,
  `last_lead_at` DATETIME NULL DEFAULT NULL,
  `leads_total` INT NOT NULL DEFAULT 0,
  `created_by` BIGINT NOT NULL,
  `updated_by` BIGINT NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_sources_token` (`token_hash`),
  KEY `idx_crm_sources_company` (`company_id`, `type`),
  CONSTRAINT `fk_crm_sources_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_crm_sources_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_crm_sources_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `crm_leads` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `lead_number` INT NOT NULL,
  `name` VARCHAR(150) NOT NULL,
  `company_name` VARCHAR(200) NULL DEFAULT NULL,
  -- Normalised: a 10-digit Indian mobile, or +<country code><number>.
  `phone` VARCHAR(20) NULL DEFAULT NULL,
  `alt_phone` VARCHAR(20) NULL DEFAULT NULL,
  `email` VARCHAR(200) NULL DEFAULT NULL,
  `gst_number` VARCHAR(20) NULL DEFAULT NULL,
  `address` VARCHAR(500) NULL DEFAULT NULL,
  `city` VARCHAR(100) NULL DEFAULT NULL,
  `state` VARCHAR(100) NULL DEFAULT NULL,
  `pincode` VARCHAR(10) NULL DEFAULT NULL,
  `country` VARCHAR(60) NULL DEFAULT NULL,
  `requirement` VARCHAR(300) NULL DEFAULT NULL,
  `message` TEXT NULL,
  `estimated_value` DECIMAL(14,2) NULL DEFAULT NULL,
  `source` VARCHAR(20) NOT NULL DEFAULT 'OTHER',
  `source_id` BIGINT NULL DEFAULT NULL,
  `source_detail` VARCHAR(100) NULL DEFAULT NULL,
  `stage` VARCHAR(20) NOT NULL DEFAULT 'NEW',
  `rating` VARCHAR(10) NULL DEFAULT NULL,
  `owner_id` BIGINT NULL DEFAULT NULL,
  `next_follow_up_at` DATETIME NULL DEFAULT NULL,
  `follow_up_note` VARCHAR(300) NULL DEFAULT NULL,
  `last_activity_at` DATETIME NULL DEFAULT NULL,
  `first_response_at` DATETIME NULL DEFAULT NULL,
  `lost_reason` VARCHAR(300) NULL DEFAULT NULL,
  `won_at` DATETIME NULL DEFAULT NULL,
  `lost_at` DATETIME NULL DEFAULT NULL,
  `customer_id` BIGINT NULL DEFAULT NULL,
  `converted_at` DATETIME NULL DEFAULT NULL,
  `converted_by` BIGINT NULL DEFAULT NULL,
  -- Highest quotation id already reflected in the timeline (lead -> quotation sync).
  `quote_sync_id` BIGINT NULL DEFAULT NULL,
  `enquiry_count` INT NOT NULL DEFAULT 1,
  -- When the enquiry was made at the source (e.g. IndiaMART QUERY_TIME); else created_at.
  `received_at` DATETIME NULL DEFAULT NULL,
  -- NULL = arrived through an integration.
  `created_by` BIGINT NULL DEFAULT NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_leads_company_number` (`company_id`, `lead_number`),
  KEY `idx_crm_leads_stage` (`company_id`, `is_deleted`, `stage`),
  KEY `idx_crm_leads_owner` (`company_id`, `owner_id`, `stage`),
  KEY `idx_crm_leads_follow_up` (`company_id`, `next_follow_up_at`),
  KEY `idx_crm_leads_phone` (`company_id`, `phone`),
  KEY `idx_crm_leads_email` (`company_id`, `email`),
  KEY `idx_crm_leads_customer` (`company_id`, `customer_id`),
  KEY `idx_crm_leads_created` (`company_id`, `created_at`),
  CONSTRAINT `fk_crm_leads_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_crm_leads_owner_id` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_crm_leads_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_crm_leads_converted_by` FOREIGN KEY (`converted_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_crm_leads_customer_id` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`),
  CONSTRAINT `fk_crm_leads_source_id` FOREIGN KEY (`source_id`) REFERENCES `crm_lead_sources` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every inbound enquiry (integration, webhook, import). A repeat enquiry from the same
-- person is attached to their open lead instead of creating a second lead. The unique key
-- makes re-delivered or overlapping pulls (IndiaMART UNIQUE_QUERY_ID) harmless.
CREATE TABLE IF NOT EXISTS `crm_enquiries` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `lead_id` BIGINT NOT NULL,
  `source` VARCHAR(20) NOT NULL,
  `source_id` BIGINT NULL DEFAULT NULL,
  `source_ref` VARCHAR(100) NULL DEFAULT NULL,
  `source_detail` VARCHAR(100) NULL DEFAULT NULL,
  `subject` VARCHAR(300) NULL DEFAULT NULL,
  `message` TEXT NULL,
  `received_at` DATETIME NULL DEFAULT NULL,
  `raw` MEDIUMTEXT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_crm_enquiries_ref` (`company_id`, `source`, `source_ref`),
  KEY `idx_crm_enquiries_lead` (`lead_id`, `received_at`),
  KEY `idx_crm_enquiries_source` (`source_id`, `created_at`),
  CONSTRAINT `fk_crm_enquiries_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_crm_enquiries_lead_id` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`),
  CONSTRAINT `fk_crm_enquiries_source_id` FOREIGN KEY (`source_id`) REFERENCES `crm_lead_sources` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `crm_activities` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `lead_id` BIGINT NOT NULL,
  -- NULL = done by the system or an integration.
  `user_id` BIGINT NULL DEFAULT NULL,
  `type` VARCHAR(20) NOT NULL,
  `outcome` VARCHAR(30) NULL DEFAULT NULL,
  `body` TEXT NULL,
  -- Small JSON, e.g. {"from":"NEW","to":"CONTACTED"}.
  `meta` VARCHAR(1000) NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_crm_activities_lead` (`lead_id`, `created_at`),
  KEY `idx_crm_activities_company` (`company_id`, `created_at`),
  CONSTRAINT `fk_crm_activities_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_crm_activities_lead_id` FOREIGN KEY (`lead_id`) REFERENCES `crm_leads` (`id`),
  CONSTRAINT `fk_crm_activities_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'crm.view' AS name, 'crm' AS module_name, 'Use CRM: work on your own leads and unassigned leads, log calls and follow-ups' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'crm.view');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'crm.create' AS name, 'crm' AS module_name, 'Add leads by hand and import leads from a CSV file' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'crm.create');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'crm.manage' AS name, 'crm' AS module_name, 'See and assign everyone''s leads, team insights, and connect lead sources (IndiaMART, website)' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'crm.manage');

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.name IN ('crm.view', 'crm.create', 'crm.manage')
WHERE r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND r.is_system = 1
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
