-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Adds the indexes now declared in src/models/products.ts's initModel() so the actual
-- table matches what Sequelize expects. Safe to run once; re-running will fail with
-- "Duplicate key name" because the indexes already exist.

ALTER TABLE `products`
  ADD INDEX `barcode` (`barcode`),
  ADD INDEX `company_id_sku` (`company_id`, `sku`),
  ADD INDEX `company_id_barcode` (`company_id`, `barcode`);
