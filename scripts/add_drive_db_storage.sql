-- Run against the SameBook MySQL/MariaDB database (no migration tooling exists in this repo).
-- Drive "db" storage mode: file bytes live in the database as 2 MB chunks, so Drive works on
-- Vercel (no disk; 4.5 MB request/response limit) without an external bucket. Every version's
-- storage_key maps to rows here (seq 0..n-1). Chunks are immutable once their version is saved.
-- Additive only; safe to run more than once.

CREATE TABLE IF NOT EXISTS `drive_blob_chunks` (
  `storage_key` VARCHAR(300) CHARACTER SET ascii NOT NULL,
  `seq` INT NOT NULL,
  `size` INT NOT NULL,
  `data` MEDIUMBLOB NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`storage_key`, `seq`),
  KEY `idx_drive_chunks_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Lookups of a version by its blob (duplicate-commit checks, orphan sweep).
CREATE INDEX IF NOT EXISTS `idx_drive_versions_key` ON `drive_file_versions` (`storage_key`);
