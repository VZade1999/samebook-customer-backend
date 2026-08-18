-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Safe to run once; re-running will fail on the second attempt because the columns already exist.

ALTER TABLE `users`
  ADD COLUMN `date_of_birth` DATE NULL DEFAULT NULL AFTER `last_login`,
  ADD COLUMN `gender` VARCHAR(20) NULL DEFAULT NULL AFTER `date_of_birth`,
  ADD COLUMN `marital_status` VARCHAR(20) NULL DEFAULT NULL AFTER `gender`,
  ADD COLUMN `blood_group` VARCHAR(10) NULL DEFAULT NULL AFTER `marital_status`,
  ADD COLUMN `permanent_address` TEXT NULL DEFAULT NULL AFTER `blood_group`,
  ADD COLUMN `aadhar_no` VARCHAR(20) NULL DEFAULT NULL AFTER `permanent_address`,
  ADD COLUMN `pan_no` VARCHAR(20) NULL DEFAULT NULL AFTER `aadhar_no`,
  ADD COLUMN `emergency_contact` VARCHAR(50) NULL DEFAULT NULL AFTER `pan_no`,
  ADD COLUMN `bank_name` VARCHAR(150) NULL DEFAULT NULL AFTER `emergency_contact`,
  ADD COLUMN `branch_name` VARCHAR(150) NULL DEFAULT NULL AFTER `bank_name`,
  ADD COLUMN `account_number` VARCHAR(50) NULL DEFAULT NULL AFTER `branch_name`,
  ADD COLUMN `account_type` VARCHAR(30) NULL DEFAULT NULL AFTER `account_number`,
  ADD COLUMN `ifsc_code` VARCHAR(20) NULL DEFAULT NULL AFTER `account_type`,
  ADD COLUMN `micr_code` VARCHAR(20) NULL DEFAULT NULL AFTER `ifsc_code`,
  ADD COLUMN `salary_payment_mode` VARCHAR(30) NULL DEFAULT NULL AFTER `micr_code`,
  ADD COLUMN `avatar` LONGBLOB NULL DEFAULT NULL AFTER `salary_payment_mode`;
