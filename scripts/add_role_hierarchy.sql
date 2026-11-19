-- Super Admin (platform), company Admins, role levels and a team hierarchy.
--
-- roles.level        1 = Admin (top of a company) … 5 = view only; 0 = platform.
-- roles.scope        PLATFORM (Super Admin: SameBook staff, every company) or COMPANY.
-- users.reports_to   The person's manager in the same company; NULL = top / not set.
-- users.designation  Job title, e.g. "Sales Executive".
-- users.department   e.g. "Sales", "Accounts".
-- permissions        + tenants.manage (platform).
--
-- Data (once), keeping everyone's access the same:
--  1. Every company other than the one that owned the shared ("system") roles gets
--     its own copy of each shared role its people use — same name, permissions and
--     people — so editing a role never touches another company again.
--  2. The shared roles become the owning company's own roles; every company's
--     ADMIN is its locked top role; levels are set by role name.
--  3. SUPER_ADMIN becomes the platform role (no company); whoever holds it also gets
--     their company's ADMIN role, so their access inside their company is unchanged.
-- Companies with no people get their default roles from the app when first used.
--
-- Run this BEFORE deploying the backend that reads it. Safe to run more than once.

DROP PROCEDURE IF EXISTS samebook_role_hierarchy;
DELIMITER //
CREATE PROCEDURE samebook_role_hierarchy()
BEGIN
  DECLARE owner BIGINT DEFAULT NULL;
  DECLARE done INT DEFAULT 0;

  -- Columns
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roles' AND COLUMN_NAME = 'level') THEN
    ALTER TABLE roles
      ADD COLUMN level TINYINT NOT NULL DEFAULT 4 AFTER description,
      ADD COLUMN scope VARCHAR(10) NOT NULL DEFAULT 'COMPANY' AFTER level;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'reports_to') THEN
    ALTER TABLE users
      ADD COLUMN reports_to  BIGINT       NULL AFTER company_id,
      ADD COLUMN designation VARCHAR(100) NULL AFTER reports_to,
      ADD COLUMN department  VARCHAR(100) NULL AFTER designation,
      ADD INDEX idx_users_company_reports_to (company_id, reports_to);
  END IF;

  INSERT INTO permissions (name, module_name, description, is_active, created_at, updated_at)
  SELECT 'tenants.manage', 'Platform', 'Manage every company: add, suspend, add-ons, admins', 1, NOW(), NOW()
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'tenants.manage');

  -- Already done once (SUPER_ADMIN is the platform role)? Then leave the data alone.
  SELECT COUNT(*) INTO done FROM roles WHERE name = 'SUPER_ADMIN' AND scope = 'PLATFORM';

  IF done = 0 THEN
    -- The company that owned the shared roles.
    SELECT company_id INTO owner FROM roles
    WHERE is_system = 1 AND company_id IS NOT NULL AND name NOT IN ('ADMIN', 'SUPER_ADMIN')
    ORDER BY id LIMIT 1;

    IF owner IS NOT NULL THEN
      -- 1. Own copies for every other company whose people use a shared role
      --    (level 99 marks the new copies until their level is set below).
      INSERT INTO roles (company_id, name, description, level, scope, is_system, created_at, updated_at)
      SELECT DISTINCT u.company_id, r.name, r.description, 99, 'COMPANY', 0, NOW(), NOW()
      FROM user_roles ur
      JOIN users u ON u.id = ur.user_id
      JOIN roles r ON r.id = ur.role_id
      WHERE r.company_id = owner AND r.is_system = 1 AND r.name <> 'SUPER_ADMIN' AND u.company_id <> owner
        AND NOT EXISTS (SELECT 1 FROM roles x WHERE x.company_id = u.company_id AND x.name = r.name);

      INSERT INTO role_permissions (role_id, permission_id)
      SELECT c.id, rp.permission_id
      FROM roles c
      JOIN roles r ON r.company_id = owner AND r.is_system = 1 AND r.name = c.name
      JOIN role_permissions rp ON rp.role_id = r.id
      WHERE c.level = 99 AND c.company_id <> owner
        AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = c.id AND x.permission_id = rp.permission_id);

      UPDATE user_roles ur
      JOIN users u ON u.id = ur.user_id
      JOIN roles r ON r.id = ur.role_id AND r.company_id = owner AND r.is_system = 1 AND r.name <> 'SUPER_ADMIN'
      JOIN roles c ON c.company_id = u.company_id AND c.name = r.name
      SET ur.role_id = c.id
      WHERE u.company_id <> owner;

      UPDATE roles SET level = 4 WHERE level = 99;
    END IF;

    -- 2. Levels by name; only ADMIN stays locked.
    UPDATE roles SET level = 1, is_system = 1 WHERE name = 'ADMIN' AND scope = 'COMPANY';
    UPDATE roles SET level = 2 WHERE name = 'MANAGER' AND scope = 'COMPANY';
    UPDATE roles SET level = 3 WHERE name IN ('ACCOUNTANT', 'SALES') AND scope = 'COMPANY';
    UPDATE roles SET level = 5 WHERE name = 'VIEWER' AND scope = 'COMPANY';
    UPDATE roles SET is_system = 0 WHERE scope = 'COMPANY' AND name NOT IN ('ADMIN', 'SUPER_ADMIN');

    -- 3. SUPER_ADMIN → platform; its holders keep full access to their own company.
    INSERT INTO user_roles (user_id, role_id)
    SELECT ur.user_id, a.id
    FROM user_roles ur
    JOIN roles s ON s.id = ur.role_id AND s.name = 'SUPER_ADMIN'
    JOIN users u ON u.id = ur.user_id
    JOIN roles a ON a.company_id = u.company_id AND a.name = 'ADMIN' AND a.scope = 'COMPANY'
    WHERE NOT EXISTS (SELECT 1 FROM user_roles x WHERE x.user_id = ur.user_id AND x.role_id = a.id);

    UPDATE roles SET scope = 'PLATFORM', level = 0, company_id = NULL, is_system = 1,
                     description = 'SameBook platform owner: every company'
    WHERE name = 'SUPER_ADMIN';
  END IF;

  INSERT INTO role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM roles r JOIN permissions p ON p.name = 'tenants.manage'
  WHERE r.name = 'SUPER_ADMIN' AND r.scope = 'PLATFORM'
    AND NOT EXISTS (SELECT 1 FROM role_permissions x WHERE x.role_id = r.id AND x.permission_id = p.id);
END //
DELIMITER ;
CALL samebook_role_hierarchy();
DROP PROCEDURE samebook_role_hierarchy;
