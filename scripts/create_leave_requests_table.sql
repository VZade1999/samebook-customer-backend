-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Safe to run once; re-running will fail on the second attempt because the table already exists.

CREATE TABLE `leave_requests` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `user_id` BIGINT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `from_date` DATE NOT NULL,
  `to_date` DATE NOT NULL,
  `reason` TEXT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
  `reviewed_by` BIGINT NULL DEFAULT NULL,
  `reviewed_at` DATETIME NULL DEFAULT NULL,
  `review_note` VARCHAR(255) NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `user_id` (`user_id`),
  KEY `company_id` (`company_id`),
  KEY `status` (`status`),
  CONSTRAINT `fk_leave_requests_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_leave_requests_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_leave_requests_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
