-- Stock & warehouses: stock history, default warehouse, rack / shelf, and the
-- "Manage stock" permission.
--
-- stock_movements              Every change to stock: opening stock, goods received,
--                              moves between warehouses, counts, and challan
--                              dispatch / cancel. `quantity` is signed (+ in, - out);
--                              `balance_after` is that warehouse's stock of the
--                              product after the change. Lines of one action share
--                              a `batch_id`.
-- warehouses.is_default        The warehouse new stock and new products go to
--                              unless another is picked (one per company).
-- product_inventory.bin_location  Where in the warehouse the product sits (rack / shelf).
-- permission stock.manage      Receive, move and count stock. Company Admins get every
--                              permission automatically; roles that can already edit
--                              warehouses get it here.
--
-- Also: existing stock is recorded once as opening stock, and each product's
-- stock_quantity is set to the sum of its warehouse stock (the figure the
-- Dashboard and Products pages read).
--
-- Run this BEFORE deploying the backend that reads it. Safe to run more than once.

CREATE TABLE IF NOT EXISTS stock_movements (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  company_id     BIGINT       NOT NULL,
  product_id     BIGINT       NOT NULL,
  variant_id     BIGINT       NULL,
  warehouse_id   BIGINT       NULL,
  type           VARCHAR(24)  NOT NULL,
  quantity       INT          NOT NULL,
  balance_after  INT          NOT NULL DEFAULT 0,
  unit_cost      DECIMAL(12,2) NULL,
  reason         VARCHAR(32)  NULL,
  reference_type VARCHAR(24)  NULL,
  reference_id   BIGINT       NULL,
  reference_no   VARCHAR(64)  NULL,
  batch_id       VARCHAR(36)  NULL,
  note           VARCHAR(255) NULL,
  created_by     BIGINT       NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_stock_mov_product (company_id, product_id, id),
  KEY ix_stock_mov_warehouse (company_id, warehouse_id, id),
  KEY ix_stock_mov_ref (reference_type, reference_id),
  KEY ix_stock_mov_batch (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP PROCEDURE IF EXISTS samebook_stock_ledger;
DELIMITER //
CREATE PROCEDURE samebook_stock_ledger()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'warehouses' AND COLUMN_NAME = 'is_default') THEN
    ALTER TABLE warehouses ADD COLUMN is_default TINYINT NOT NULL DEFAULT 0 AFTER state;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_inventory' AND COLUMN_NAME = 'bin_location') THEN
    ALTER TABLE product_inventory ADD COLUMN bin_location VARCHAR(64) NULL AFTER warehouse_id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'product_inventory' AND INDEX_NAME = 'ix_inventory_warehouse') THEN
    ALTER TABLE product_inventory ADD INDEX ix_inventory_warehouse (warehouse_id, product_id);
  END IF;
END //
DELIMITER ;
CALL samebook_stock_ledger();
DROP PROCEDURE samebook_stock_ledger;

-- One default warehouse per company: the oldest active one, where none is set.
UPDATE warehouses w
JOIN (
  SELECT company_id, MIN(id) AS id FROM warehouses
  WHERE is_active = 1 AND company_id NOT IN (SELECT company_id FROM (SELECT company_id FROM warehouses WHERE is_default = 1 AND is_active = 1) d)
  GROUP BY company_id
) pick ON pick.id = w.id
SET w.is_default = 1;

-- The "Manage stock" permission, given to every role that can edit warehouses.
INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'stock.manage' AS name, 'warehouses' AS module_name, 'Receive, move and count stock' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'stock.manage');

INSERT INTO `role_permissions` (`role_id`, `permission_id`)
SELECT rp.role_id, p_new.id
FROM `role_permissions` rp
JOIN `permissions` p_old ON p_old.id = rp.permission_id AND p_old.name = 'warehouses.edit'
JOIN `permissions` p_new ON p_new.name = 'stock.manage'
WHERE NOT EXISTS (
  SELECT 1 FROM `role_permissions` existing
  WHERE existing.role_id = rp.role_id AND existing.permission_id = p_new.id
);

-- Existing stock becomes opening stock in the history (once per product + warehouse).
INSERT INTO stock_movements (company_id, product_id, warehouse_id, type, quantity, balance_after, note)
SELECT p.company_id, pi.product_id, pi.warehouse_id, 'OPENING', SUM(pi.stock_level), SUM(pi.stock_level),
       'Stock held before the history started'
FROM product_inventory pi
JOIN products p ON p.id = pi.product_id
WHERE pi.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM stock_movements m
                  WHERE m.product_id = pi.product_id AND m.warehouse_id <=> pi.warehouse_id)
GROUP BY p.company_id, pi.product_id, pi.warehouse_id
HAVING SUM(pi.stock_level) <> 0;

-- A product's stock is the sum of its warehouse stock.
UPDATE products p
JOIN (SELECT product_id, SUM(stock_level) AS s FROM product_inventory WHERE is_active = 1 GROUP BY product_id) x
  ON x.product_id = p.id
SET p.stock_quantity = x.s
WHERE COALESCE(p.stock_quantity, 0) <> x.s;
