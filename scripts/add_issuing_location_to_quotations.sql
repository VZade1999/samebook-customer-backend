-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Safe to run once; re-running will fail on the second attempt because the column already exists.
-- issuing_location_id is NULL for a quotation issued under the company's primary GSTIN
-- (companies.gst_no) rather than a specific branch location's GSTIN.

ALTER TABLE `quotations`
  ADD COLUMN `issuing_location_id` BIGINT NULL DEFAULT NULL AFTER `place_of_supply_state_id`,
  ADD KEY `idx_quotations_issuing_location_id` (`issuing_location_id`);
