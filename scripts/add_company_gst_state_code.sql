-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Safe to run once; re-running will fail on the second attempt because the column already exists.

ALTER TABLE `companies`
  ADD COLUMN `gst_state_code` VARCHAR(2) NULL DEFAULT NULL AFTER `gst_no`;
