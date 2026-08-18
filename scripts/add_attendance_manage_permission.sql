-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Run AFTER create_leave_requests_table.sql.
-- Safe to run more than once — every insert is guarded so re-running is a no-op.

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'attendance.manage' AS name, 'attendance' AS module_name, 'View team attendance and approve/reject leave requests' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'attendance.manage');

-- Granted directly to ADMIN and SUPER_ADMIN roles by name — deliberately
-- narrower than the attendance.view rollout (MANAGER does not get this).
INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.name = 'attendance.manage'
WHERE r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
