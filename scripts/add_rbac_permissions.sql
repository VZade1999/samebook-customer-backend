-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Run BEFORE (or together with) deploying the RBAC guard fix: the users/roles/permissions
-- endpoints now enforce these permissions, so roles without them lose access.
-- Safe to run more than once — every insert is guarded so re-running is a no-op.
-- Permissions are read from the access token, so affected users must log in again
-- (or wait for a token refresh) before the new grants take effect.

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'users.view' AS name, 'users' AS module_name, 'View users' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'users.view');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'users.create' AS name, 'users' AS module_name, 'Create users' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'users.create');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'users.edit' AS name, 'users' AS module_name, 'Edit users and assign their roles' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'users.edit');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'users.delete' AS name, 'users' AS module_name, 'Delete users' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'users.delete');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'roles.view' AS name, 'roles' AS module_name, 'View roles and their permissions' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'roles.view');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'roles.create' AS name, 'roles' AS module_name, 'Create roles' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'roles.create');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'roles.edit' AS name, 'roles' AS module_name, 'Edit roles and assign their permissions' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'roles.edit');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'roles.delete' AS name, 'roles' AS module_name, 'Delete roles' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'roles.delete');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'permissions.view' AS name, 'permissions' AS module_name, 'View permissions' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'permissions.view');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'permissions.create' AS name, 'permissions' AS module_name, 'Create permissions' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'permissions.create');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'permissions.edit' AS name, 'permissions' AS module_name, 'Edit permissions' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'permissions.edit');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'permissions.delete' AS name, 'permissions' AS module_name, 'Delete permissions' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'permissions.delete');

-- Granted directly to ADMIN and SUPER_ADMIN roles by name (same pattern as
-- add_attendance_manage_permission.sql), so existing admins keep the access
-- they had while these checks were not enforced.
INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.name IN (
  'users.view', 'users.create', 'users.edit', 'users.delete',
  'roles.view', 'roles.create', 'roles.edit', 'roles.delete',
  'permissions.view'
)
WHERE r.name IN ('ADMIN', 'SUPER_ADMIN')
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );

-- The `permissions` table is shared by ALL companies, so creating/editing/
-- deleting a permission affects every tenant. Only SUPER_ADMIN (platform
-- level) gets these - a company ADMIN must not be able to rename or delete
-- a permission other companies rely on.
INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.name IN (
  'permissions.create', 'permissions.edit', 'permissions.delete'
)
WHERE r.name = 'SUPER_ADMIN'
  AND NOT EXISTS (
    SELECT 1 FROM `role_permissions` existing
    WHERE existing.role_id = r.id AND existing.permission_id = p.id
  );
