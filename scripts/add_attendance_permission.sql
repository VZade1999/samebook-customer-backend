-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Run AFTER create_attendance_table.sql.
-- Safe to run more than once — every insert is guarded so re-running is a no-op.

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'attendance.view' AS name, 'attendance' AS module_name, 'Punch in/out and view own attendance' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'attendance.view');

-- Grant to every role that already holds `dashboard.view` — the closest
-- existing proxy for "every base employee role" — so attendance is usable
-- by default instead of requiring a separate manual rollout per role.
INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT rp.role_id, p_new.id
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.name = 'dashboard.view'
JOIN `permissions` p_new ON p_new.name = 'attendance.view'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permissions` existing
  WHERE existing.role_id = rp.role_id AND existing.permission_id = p_new.id
);
