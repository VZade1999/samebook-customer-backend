-- Purchases: suppliers, purchase orders (POs), goods received (GRN), supplier
-- bills and payments to suppliers — the buying side, in Indian GST format.
--
-- suppliers / supplier_addresses / supplier_contacts
--     Who you buy from. gst_type REGISTERED | COMPOSITION | UNREGISTERED (only a
--     registered supplier charges GST). msme_type MICRO | SMALL | MEDIUM with the
--     Udyam number (micro and small suppliers must be paid within 45 days).
--     credit_days = their payment terms; bank details are where you pay them.
-- purchase_orders / purchase_order_items / purchase_order_activity
--     A PO to a supplier. Each line keeps its own HSN and GST rate. status:
--     DRAFT → PENDING_APPROVAL → APPROVED → SENT → PARTLY_RECEIVED → RECEIVED,
--     or CLOSED (part came, the rest won't) / CANCELLED (nothing came).
--     revision = amendment number; the activity log keeps each earlier version.
-- goods_receipts / goods_receipt_items
--     Goods that arrived against a PO (GRN). Accepted quantities go into stock
--     through stock_movements (type RECEIVED, reference_type 'grn'); a cancelled
--     GRN takes them back out (RECEIVE_CANCELLED).
-- purchase_bills / purchase_bill_items
--     The supplier's tax invoice as entered by you: what you owe and by when.
-- supplier_payments / supplier_payment_allocations
--     Money paid to a supplier, shared over their bills; anything not shared is
--     an advance (optionally against a PO).
-- purchase_settings
--     Per company: the approval limit, extra % allowed when receiving, default terms.
-- permissions
--     purchases.view / create / approve / receive / bills.
-- company_modules
--     Purchases is the add-on "purchases", switched on for every existing company
--     (only Admins see it until other roles are given access).
--
-- Run this BEFORE deploying the backend that reads it. Safe to run more than once.

CREATE TABLE IF NOT EXISTS suppliers (
  id                  BIGINT       NOT NULL AUTO_INCREMENT,
  company_id          BIGINT       NOT NULL,
  name                VARCHAR(200) NOT NULL,
  legal_name          VARCHAR(200) NULL,
  gst_type            VARCHAR(16)  NOT NULL DEFAULT 'REGISTERED',
  gstin               VARCHAR(15)  NULL,
  pan                 VARCHAR(10)  NULL,
  state               VARCHAR(60)  NULL,
  state_code          CHAR(2)      NULL,
  phone               VARCHAR(20)  NULL,
  email               VARCHAR(150) NULL,
  msme_type           VARCHAR(10)  NULL,
  udyam_number        VARCHAR(25)  NULL,
  credit_days         INT          NULL,
  bank_account_name   VARCHAR(150) NULL,
  bank_account_number VARCHAR(30)  NULL,
  bank_ifsc           VARCHAR(11)  NULL,
  bank_name           VARCHAR(100) NULL,
  upi_id              VARCHAR(100) NULL,
  notes               TEXT         NULL,
  is_active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_by          BIGINT       NULL,
  updated_by          BIGINT       NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sup_company (company_id, is_active, name),
  KEY ix_sup_gstin (company_id, gstin)
);

CREATE TABLE IF NOT EXISTS supplier_addresses (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  supplier_id    BIGINT       NOT NULL,
  label          VARCHAR(60)  NULL,
  address_line_1 VARCHAR(255) NOT NULL,
  address_line_2 VARCHAR(255) NULL,
  city           VARCHAR(100) NULL,
  state          VARCHAR(60)  NULL,
  state_code     CHAR(2)      NULL,
  postal_code    VARCHAR(10)  NULL,
  country        VARCHAR(60)  NULL,
  gstin          VARCHAR(15)  NULL,
  is_primary     TINYINT(1)   NOT NULL DEFAULT 0,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_supaddr_supplier (supplier_id)
);

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  supplier_id BIGINT       NOT NULL,
  name        VARCHAR(120) NOT NULL,
  designation VARCHAR(80)  NULL,
  phone       VARCHAR(20)  NULL,
  email       VARCHAR(150) NULL,
  is_primary  TINYINT(1)   NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_supcon_supplier (supplier_id)
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                   BIGINT        NOT NULL AUTO_INCREMENT,
  company_id           BIGINT        NOT NULL,
  po_number            VARCHAR(40)   NOT NULL,
  series_id            BIGINT        NULL,
  po_date              DATE          NOT NULL,
  expected_date        DATE          NULL,
  supplier_id          BIGINT        NOT NULL,
  supplier_address_id  BIGINT        NULL,
  supplier_snapshot    LONGTEXT      NULL,
  supplier_ref         VARCHAR(80)   NULL,
  issuing_location_id  BIGINT        NULL,
  buyer_snapshot       LONGTEXT      NULL,
  warehouse_id         BIGINT        NULL,
  ship_to_snapshot     LONGTEXT      NULL,
  place_of_supply      VARCHAR(60)   NULL,
  place_of_supply_code CHAR(2)       NULL,
  tax_type             VARCHAR(12)   NOT NULL DEFAULT 'INTRA_STATE',
  status               VARCHAR(20)   NOT NULL DEFAULT 'DRAFT',
  revision             INT           NOT NULL DEFAULT 0,
  sub_total            DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount_amount      DECIMAL(15,2) NOT NULL DEFAULT 0,
  freight_charges      DECIMAL(15,2) NOT NULL DEFAULT 0,
  freight_gst          TINYINT(1)    NOT NULL DEFAULT 1,
  taxable_amount       DECIMAL(15,2) NOT NULL DEFAULT 0,
  cgst_amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
  sgst_amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
  igst_amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
  round_off            DECIMAL(8,2)  NOT NULL DEFAULT 0,
  grand_total          DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_terms        VARCHAR(200)  NULL,
  delivery_terms       VARCHAR(200)  NULL,
  notes                TEXT          NULL,
  terms_conditions     TEXT          NULL,
  submitted_at         DATETIME      NULL,
  approved_by          BIGINT        NULL,
  approved_at          DATETIME      NULL,
  sent_at              DATETIME      NULL,
  closed_by            BIGINT        NULL,
  closed_at            DATETIME      NULL,
  close_reason         VARCHAR(300)  NULL,
  created_by           BIGINT        NULL,
  updated_by           BIGINT        NULL,
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_po_number (company_id, po_number),
  KEY ix_po_status (company_id, status, po_date),
  KEY ix_po_supplier (company_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  po_id            BIGINT        NOT NULL,
  line_no          INT           NOT NULL DEFAULT 1,
  product_id       BIGINT        NULL,
  item_name        VARCHAR(255)  NOT NULL,
  description      TEXT          NULL,
  hsn_code         VARCHAR(20)   NULL,
  unit             VARCHAR(30)   NULL,
  qty              DECIMAL(14,3) NOT NULL,
  rate             DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount_percent DECIMAL(5,2)  NOT NULL DEFAULT 0,
  gst_rate         DECIMAL(5,2)  NOT NULL DEFAULT 0,
  amount           DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_poi_po (po_id),
  KEY ix_poi_product (product_id)
);

CREATE TABLE IF NOT EXISTS purchase_order_activity (
  id         BIGINT       NOT NULL AUTO_INCREMENT,
  company_id BIGINT       NOT NULL,
  po_id      BIGINT       NOT NULL,
  action     VARCHAR(30)  NOT NULL,
  note       VARCHAR(500) NULL,
  snapshot   LONGTEXT     NULL,
  user_id    BIGINT       NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_poa_po (po_id, id)
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id                  BIGINT       NOT NULL AUTO_INCREMENT,
  company_id          BIGINT       NOT NULL,
  grn_number          VARCHAR(40)  NOT NULL,
  series_id           BIGINT       NULL,
  po_id               BIGINT       NOT NULL,
  supplier_id         BIGINT       NOT NULL,
  warehouse_id        BIGINT       NOT NULL,
  receipt_date        DATE         NOT NULL,
  supplier_challan_no VARCHAR(50)  NULL,
  supplier_invoice_no VARCHAR(50)  NULL,
  vehicle_number      VARCHAR(32)  NULL,
  eway_bill_number    VARCHAR(32)  NULL,
  transporter_name    VARCHAR(120) NULL,
  notes               TEXT         NULL,
  status              VARCHAR(12)  NOT NULL DEFAULT 'RECEIVED',
  stock_batch_id      CHAR(36)     NULL,
  cancel_reason       VARCHAR(300) NULL,
  cancelled_by        BIGINT       NULL,
  cancelled_at        DATETIME     NULL,
  created_by          BIGINT       NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grn_number (company_id, grn_number),
  KEY ix_grn_po (company_id, po_id),
  KEY ix_grn_date (company_id, receipt_date)
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  grn_id        BIGINT        NOT NULL,
  po_item_id    BIGINT        NOT NULL,
  product_id    BIGINT        NULL,
  item_name     VARCHAR(255)  NOT NULL,
  unit          VARCHAR(30)   NULL,
  received_qty  DECIMAL(14,3) NOT NULL,
  accepted_qty  DECIMAL(14,3) NOT NULL,
  rejected_qty  DECIMAL(14,3) NOT NULL DEFAULT 0,
  reject_reason VARCHAR(200)  NULL,
  unit_cost     DECIMAL(14,2) NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_grni_grn (grn_id),
  KEY ix_grni_poitem (po_item_id)
);

CREATE TABLE IF NOT EXISTS purchase_bills (
  id                   BIGINT        NOT NULL AUTO_INCREMENT,
  company_id           BIGINT        NOT NULL,
  supplier_id          BIGINT        NOT NULL,
  po_id                BIGINT        NULL,
  bill_number          VARCHAR(40)   NOT NULL,
  bill_date            DATE          NOT NULL,
  due_date             DATE          NULL,
  supplier_snapshot    LONGTEXT      NULL,
  place_of_supply_code CHAR(2)       NULL,
  tax_type             VARCHAR(12)   NOT NULL DEFAULT 'INTRA_STATE',
  sub_total            DECIMAL(15,2) NOT NULL DEFAULT 0,
  discount_amount      DECIMAL(15,2) NOT NULL DEFAULT 0,
  freight_charges      DECIMAL(15,2) NOT NULL DEFAULT 0,
  freight_gst          TINYINT(1)    NOT NULL DEFAULT 1,
  taxable_amount       DECIMAL(15,2) NOT NULL DEFAULT 0,
  cgst_amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
  sgst_amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
  igst_amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
  round_off            DECIMAL(8,2)  NOT NULL DEFAULT 0,
  grand_total          DECIMAL(15,2) NOT NULL DEFAULT 0,
  paid_amount          DECIMAL(15,2) NOT NULL DEFAULT 0,
  balance_amount       DECIMAL(15,2) NOT NULL DEFAULT 0,
  status               VARCHAR(14)   NOT NULL DEFAULT 'UNPAID',
  notes                TEXT          NULL,
  cancel_reason        VARCHAR(300)  NULL,
  cancelled_by         BIGINT        NULL,
  cancelled_at         DATETIME      NULL,
  created_by           BIGINT        NULL,
  updated_by           BIGINT        NULL,
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_pb_status (company_id, status, due_date),
  KEY ix_pb_supplier (company_id, supplier_id),
  KEY ix_pb_po (company_id, po_id)
);

CREATE TABLE IF NOT EXISTS purchase_bill_items (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  bill_id          BIGINT        NOT NULL,
  po_item_id       BIGINT        NULL,
  product_id       BIGINT        NULL,
  item_name        VARCHAR(255)  NOT NULL,
  hsn_code         VARCHAR(20)   NULL,
  unit             VARCHAR(30)   NULL,
  qty              DECIMAL(14,3) NOT NULL,
  rate             DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount_percent DECIMAL(5,2)  NOT NULL DEFAULT 0,
  gst_rate         DECIMAL(5,2)  NOT NULL DEFAULT 0,
  amount           DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_pbi_bill (bill_id),
  KEY ix_pbi_poitem (po_item_id)
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  company_id      BIGINT        NOT NULL,
  supplier_id     BIGINT        NOT NULL,
  po_id           BIGINT        NULL,
  payment_date    DATE          NOT NULL,
  amount          DECIMAL(15,2) NOT NULL,
  mode            VARCHAR(16)   NOT NULL,
  reference       VARCHAR(100)  NULL,
  bank_account_id BIGINT        NULL,
  notes           VARCHAR(500)  NULL,
  status          VARCHAR(12)   NOT NULL DEFAULT 'ACTIVE',
  cancel_reason   VARCHAR(300)  NULL,
  cancelled_by    BIGINT        NULL,
  cancelled_at    DATETIME      NULL,
  created_by      BIGINT        NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_sp_supplier (company_id, supplier_id),
  KEY ix_sp_date (company_id, payment_date)
);

CREATE TABLE IF NOT EXISTS supplier_payment_allocations (
  id         BIGINT        NOT NULL AUTO_INCREMENT,
  payment_id BIGINT        NOT NULL,
  bill_id    BIGINT        NOT NULL,
  amount     DECIMAL(15,2) NOT NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_spa_payment (payment_id),
  KEY ix_spa_bill (bill_id)
);

CREATE TABLE IF NOT EXISTS purchase_settings (
  company_id             BIGINT        NOT NULL,
  approval_limit         DECIMAL(15,2) NULL,
  over_receipt_percent   DECIMAL(5,2)  NOT NULL DEFAULT 0,
  default_payment_terms  VARCHAR(200)  NULL,
  default_delivery_terms VARCHAR(200)  NULL,
  default_terms          TEXT          NULL,
  updated_by             BIGINT        NULL,
  updated_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id)
);

-- The five Purchases permissions. Company Admins get every permission automatically.
INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'purchases.view' AS name, 'Purchases' AS module_name, 'See suppliers, purchase orders and their prices' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'purchases.view');
INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'purchases.create' AS name, 'Purchases' AS module_name, 'Add suppliers; make and edit draft purchase orders' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'purchases.create');
INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'purchases.approve' AS name, 'Purchases' AS module_name, 'Approve, amend, cancel and close purchase orders' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'purchases.approve');
INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'purchases.receive' AS name, 'Purchases' AS module_name, 'Record goods received against purchase orders' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'purchases.receive');
INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'purchases.bills' AS name, 'Purchases' AS module_name, 'Enter supplier bills and payments to suppliers' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'purchases.bills');

-- Purchases as an add-on, switched on for every existing company.
INSERT INTO company_modules (company_id, module_key, enabled, plan, enabled_at)
SELECT c.id, 'purchases', 1, 'FREE', NOW()
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM company_modules m WHERE m.company_id = c.id AND m.module_key = 'purchases');
