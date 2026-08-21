-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Safe to run once; re-running will fail on the second attempt because the columns already exist.

ALTER TABLE `company_locations`
  ADD COLUMN `gst_no` VARCHAR(15) NULL DEFAULT NULL AFTER `address_postal_code`,
  ADD COLUMN `gst_state_code` VARCHAR(2) NULL DEFAULT NULL AFTER `gst_no`;
