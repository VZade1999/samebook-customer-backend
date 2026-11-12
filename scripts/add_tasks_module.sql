-- Run against the SameBook MySQL/MariaDB database (no migration tooling exists in this repo).
-- Tasks add-on (module key 'tasks'): Epic > Goal > Task > Subtask work items with
-- assignment, status, comments, follow-ups and an activity history; plus a generic
-- in-app notifications table (the header bell) that any module can write to.
-- Adds permissions tasks.view / tasks.create / tasks.manage and grants all three to
-- the ADMIN and SUPER_ADMIN system roles. Other roles get access when an admin
-- connects the add-on (Apps & Add-ons) and ticks them.
-- Additive only; safe to run more than once.

CREATE TABLE IF NOT EXISTS `tasks` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `task_number` INT NOT NULL,
  `type` VARCHAR(10) NOT NULL DEFAULT 'TASK',
  `parent_id` BIGINT NULL DEFAULT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` TEXT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'TODO',
  `priority` VARCHAR(10) NOT NULL DEFAULT 'NORMAL',
  `assignee_id` BIGINT NULL DEFAULT NULL,
  `created_by` BIGINT NOT NULL,
  `due_date` DATE NULL DEFAULT NULL,
  `due_time` TIME NULL DEFAULT NULL,
  `link_type` VARCHAR(20) NULL DEFAULT NULL,
  `link_id` BIGINT NULL DEFAULT NULL,
  `completed_at` DATETIME NULL DEFAULT NULL,
  `is_deleted` TINYINT(1) NOT NULL DEFAULT 0,
  `deleted_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tasks_company_number` (`company_id`, `task_number`),
  KEY `idx_tasks_company_assignee` (`company_id`, `assignee_id`, `status`),
  KEY `idx_tasks_company_creator` (`company_id`, `created_by`),
  KEY `idx_tasks_company_due` (`company_id`, `due_date`),
  KEY `idx_tasks_parent` (`parent_id`),
  CONSTRAINT `fk_tasks_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_tasks_parent_id` FOREIGN KEY (`parent_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_tasks_assignee_id` FOREIGN KEY (`assignee_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_tasks_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `task_comments` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `kind` VARCHAR(20) NOT NULL DEFAULT 'COMMENT',
  `body` TEXT NOT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_comments_task` (`task_id`, `created_at`),
  CONSTRAINT `fk_task_comments_task_id` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_task_comments_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_task_comments_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `task_activity_logs` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `task_id` BIGINT NOT NULL,
  `company_id` BIGINT NOT NULL,
  `user_id` BIGINT NULL DEFAULT NULL,
  `action` VARCHAR(30) NOT NULL,
  `field` VARCHAR(30) NULL DEFAULT NULL,
  `old_value` VARCHAR(500) NULL DEFAULT NULL,
  `new_value` VARCHAR(500) NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_task_activity_task` (`task_id`, `created_at`),
  CONSTRAINT `fk_task_activity_task_id` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`),
  CONSTRAINT `fk_task_activity_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_task_activity_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT NOT NULL,
  `user_id` BIGINT NOT NULL,
  `module` VARCHAR(30) NULL DEFAULT NULL,
  `type` VARCHAR(40) NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `body` VARCHAR(500) NULL DEFAULT NULL,
  `link` VARCHAR(255) NULL DEFAULT NULL,
  `entity_type` VARCHAR(30) NULL DEFAULT NULL,
  `entity_id` BIGINT NULL DEFAULT NULL,
  `actor_id` BIGINT NULL DEFAULT NULL,
  `is_read` TINYINT(1) NOT NULL DEFAULT 0,
  `read_at` DATETIME NULL DEFAULT NULL,
  `created_at` DATETIME NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notifications_user` (`user_id`, `is_read`, `created_at`),
  CONSTRAINT `fk_notifications_company_id` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`),
  CONSTRAINT `fk_notifications_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_notifications_actor_id` FOREIGN KEY (`actor_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'tasks.view' AS name, 'tasks' AS module_name, 'Use Tasks: see tasks you created or are assigned to' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'tasks.view');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'tasks.create' AS name, 'tasks' AS module_name, 'Create goals, tasks and subtasks and assign them' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'tasks.create');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'tasks.manage' AS name, 'tasks' AS module_name, 'See and edit everyone''s tasks, create epics, team overview' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'tasks.manage');

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.name IN ('tasks.view', 'tasks.create', 'tasks.manage')
WHERE r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND r.is_system = 1
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
