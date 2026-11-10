-- Run this manually against the SameBook MySQL/MariaDB database (no migration tooling exists in this repo).
-- Adds per-company attendance policy (shift timings, grace, half/full day thresholds,
-- weekly offs, timezone) and a company holiday calendar: two NEW tables.
-- No existing table is altered and no permission is added (reads use attendance.view,
-- writes use attendance.manage, both of which already exist).
-- Safe to run more than once: both tables use CREATE TABLE IF NOT EXISTS.
-- A company without a row in attendance_settings uses the application defaults
-- (Asia/Kolkata, 09:30-18:30, 15 min grace, 240/480 min, Sunday off).

CREATE TABLE IF NOT EXISTS `attendance_settings` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `timezone` VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  `shift_start` TIME NOT NULL DEFAULT '09:30:00',
  `shift_end` TIME NOT NULL DEFAULT '18:30:00',
  `grace_minutes` INT NOT NULL DEFAULT 15,
  `half_day_minutes` INT NOT NULL DEFAULT 240,
  `full_day_minutes` INT NOT NULL DEFAULT 480,
  `weekly_offs` VARCHAR(20) NOT NULL DEFAULT '0',
  `updated_by` BIGINT NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_settings_company_id` (`company_id`),
  KEY `updated_by` (`updated_by`),
  CONSTRAINT `fk_attendance_settings_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_attendance_settings_updated_by` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `attendance_holidays` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `holiday_date` DATE NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  `created_by` BIGINT NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_attendance_holidays_company_date` (`company_id`, `holiday_date`),
  KEY `company_id_holiday_date` (`company_id`, `holiday_date`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `fk_attendance_holidays_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_attendance_holidays_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
