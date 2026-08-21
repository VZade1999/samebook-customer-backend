-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Safe to run once; re-running will fail on the second attempt because the columns already exist.

ALTER TABLE `leave_requests`
  ADD COLUMN `leave_type` VARCHAR(20) NOT NULL DEFAULT 'FULL_DAY' AFTER `to_date`,
  ADD COLUMN `half_day_period` VARCHAR(10) NULL DEFAULT NULL AFTER `leave_type`;
