-- Run this manually against the SameBook MySQL database (no migration tooling exists in this repo).
-- Run AFTER create_warehouses_table.sql.
-- Safe to run more than once — every insert is guarded so re-running is a no-op.

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'categories.view' AS name, 'categories' AS module_name, 'View product categories' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'categories.view');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'categories.create' AS name, 'categories' AS module_name, 'Create product categories' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'categories.create');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'categories.edit' AS name, 'categories' AS module_name, 'Edit product categories' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'categories.edit');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'categories.delete' AS name, 'categories' AS module_name, 'Delete product categories' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'categories.delete');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'warehouses.view' AS name, 'warehouses' AS module_name, 'View warehouses' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'warehouses.view');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'warehouses.create' AS name, 'warehouses' AS module_name, 'Create warehouses' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'warehouses.create');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'warehouses.edit' AS name, 'warehouses' AS module_name, 'Edit warehouses' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'warehouses.edit');

INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'warehouses.delete' AS name, 'warehouses' AS module_name, 'Delete warehouses' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'warehouses.delete');

-- Grant each new permission to every role that already holds the equivalent
-- `products.*` permission, so existing users keep working access instead of
-- suddenly losing it once the new permission checks go live.

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT rp.role_id, p_new.id
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.name = 'products.view'
JOIN `permissions` p_new ON p_new.name = 'categories.view'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permissions` existing
  WHERE existing.role_id = rp.role_id AND existing.permission_id = p_new.id
);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT rp.role_id, p_new.id
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.name = 'products.create'
JOIN `permissions` p_new ON p_new.name = 'categories.create'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permissions` existing
  WHERE existing.role_id = rp.role_id AND existing.permission_id = p_new.id
);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT rp.role_id, p_new.id
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.name = 'products.edit'
JOIN `permissions` p_new ON p_new.name = 'categories.edit'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permissions` existing
  WHERE existing.role_id = rp.role_id AND existing.permission_id = p_new.id
);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT rp.role_id, p_new.id
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.name = 'products.delete'
JOIN `permissions` p_new ON p_new.name = 'categories.delete'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permissions` existing
  WHERE existing.role_id = rp.role_id AND existing.permission_id = p_new.id
);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT rp.role_id, p_new.id
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.name = 'products.view'
JOIN `permissions` p_new ON p_new.name = 'warehouses.view'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permissions` existing
  WHERE existing.role_id = rp.role_id AND existing.permission_id = p_new.id
);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT rp.role_id, p_new.id
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.name = 'products.create'
JOIN `permissions` p_new ON p_new.name = 'warehouses.create'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permissions` existing
  WHERE existing.role_id = rp.role_id AND existing.permission_id = p_new.id
);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT rp.role_id, p_new.id
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.name = 'products.edit'
JOIN `permissions` p_new ON p_new.name = 'warehouses.edit'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permissions` existing
  WHERE existing.role_id = rp.role_id AND existing.permission_id = p_new.id
);

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT rp.role_id, p_new.id
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.name = 'products.delete'
JOIN `permissions` p_new ON p_new.name = 'warehouses.delete'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permissions` existing
  WHERE existing.role_id = rp.role_id AND existing.permission_id = p_new.id
);
