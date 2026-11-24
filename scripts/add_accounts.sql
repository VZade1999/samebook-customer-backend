-- Accounts (the ledger): books of accounts, double-entry, Tally-style groups.
--
-- ledger_settings
--     Per company: the date the books start (opening balances sit on it; nothing
--     dated earlier is in the books) and the bank that payments go to when a
--     payment doesn't name one.
-- ledger_accounts
--     The chart of accounts. code = the system key (SALES, CASH, BANK:5,
--     OUTPUT_CGST, DEBTORS…), NULL for accounts you make yourself. group_code =
--     a Tally-style group (SUNDRY_DEBTORS, BANK_ACCOUNTS, SALES, DUTIES_TAXES…).
-- ledger_entries / ledger_lines
--     Entries (vouchers) and their lines; every entry's lines add up (Dr = Cr).
--     Documents are the source: source_type + source_id point at the invoice,
--     payment, supplier bill or supplier payment the entry was made from, and
--     fingerprint holds what it was made from, so a changed document is
--     re-recorded. A cancelled document's entry has status CANCELLED and no
--     lines. Customer and supplier lines also carry party_type + party_id
--     (sub-ledgers of Sundry Debtors / Sundry Creditors).
--
-- Additive only: four new tables, three permissions and the "accounts" add-on
-- for each company. Safe to run more than once.

CREATE TABLE IF NOT EXISTS ledger_settings (
  company_id              BIGINT       NOT NULL,
  books_start             DATE         NOT NULL,
  default_bank_account_id BIGINT       NULL,
  synced_at               DATETIME     NULL,
  updated_by              BIGINT       NULL,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id)
);

CREATE TABLE IF NOT EXISTS ledger_accounts (
  id              BIGINT       NOT NULL AUTO_INCREMENT,
  company_id      BIGINT       NOT NULL,
  code            VARCHAR(40)  NULL,
  name            VARCHAR(120) NOT NULL,
  group_code      VARCHAR(30)  NOT NULL,
  bank_account_id BIGINT       NULL,
  is_system       TINYINT(1)   NOT NULL DEFAULT 0,
  is_active       TINYINT(1)   NOT NULL DEFAULT 1,
  notes           VARCHAR(300) NULL,
  created_by      BIGINT       NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_la_code (company_id, code),
  KEY ix_la_group (company_id, group_code),
  KEY ix_la_name (company_id, name)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id          BIGINT        NOT NULL AUTO_INCREMENT,
  company_id  BIGINT        NOT NULL,
  entry_type  VARCHAR(14)   NOT NULL,
  entry_date  DATE          NOT NULL,
  number      VARCHAR(60)   NULL,
  source_type VARCHAR(20)   NOT NULL,
  source_id   BIGINT        NULL,
  fingerprint VARCHAR(500)  NULL,
  party_type  VARCHAR(10)   NULL,
  party_id    BIGINT        NULL,
  amount      DECIMAL(15,2) NOT NULL DEFAULT 0,
  narration   VARCHAR(500)  NULL,
  status      VARCHAR(10)   NOT NULL DEFAULT 'ACTIVE',
  created_by  BIGINT        NULL,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_le_source (company_id, source_type, source_id),
  KEY ix_le_date (company_id, entry_date),
  KEY ix_le_party (company_id, party_type, party_id)
);

CREATE TABLE IF NOT EXISTS ledger_lines (
  id         BIGINT        NOT NULL AUTO_INCREMENT,
  entry_id   BIGINT        NOT NULL,
  company_id BIGINT        NOT NULL,
  entry_date DATE          NOT NULL,
  account_id BIGINT        NOT NULL,
  party_type VARCHAR(10)   NULL,
  party_id   BIGINT        NULL,
  debit      DECIMAL(15,2) NOT NULL DEFAULT 0,
  credit     DECIMAL(15,2) NOT NULL DEFAULT 0,
  line_no    SMALLINT      NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  KEY ix_ll_entry (entry_id),
  KEY ix_ll_account (company_id, account_id, entry_date),
  KEY ix_ll_party (company_id, party_type, party_id, entry_date)
);

-- The three Accounts permissions. Company Admins get every permission automatically.
INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'accounts.view' AS name, 'Accounts' AS module_name, 'See customer and supplier ledgers and statements' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'accounts.view');
INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'accounts.record' AS name, 'Accounts' AS module_name, 'Record receipts, expenses, journals and opening balances' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'accounts.record');
INSERT INTO `permissions` (`name`, `module_name`, `description`)
SELECT * FROM (SELECT 'accounts.reports' AS name, 'Accounts' AS module_name, 'See profit & loss, balance sheet, trial balance and GST reports' AS description) t
WHERE NOT EXISTS (SELECT 1 FROM `permissions` WHERE `name` = 'accounts.reports');

-- Accounts as an add-on, switched on for every existing company.
INSERT INTO company_modules (company_id, module_key, enabled, plan, enabled_at)
SELECT c.id, 'accounts', 1, 'FREE', NOW()
FROM companies c
WHERE NOT EXISTS (SELECT 1 FROM company_modules m WHERE m.company_id = c.id AND m.module_key = 'accounts');

-- ── Step 2: money in & out ──────────────────────────────────────────────────
-- customer_receipts
--     Money received from a customer (RCT/26-27/0001): for one or several
--     invoices, or an advance. Each invoice it settles gets an invoice_payments
--     row with receipt_id, so invoices update as before; the books record the
--     receipt once (the linked invoice_payments rows are not recorded again).
-- expenses
--     Money paid out for a business expense (EXP/26-27/0001), under an expense
--     head (a ledger account), with GST input credit when the payee has a GSTIN.
-- invoice_payments.receipt_id / bank_account_id
--     Which receipt a payment came from, and which bank it went into.
-- Journals and transfers (contra) are kept in ledger_entries themselves.

CREATE TABLE IF NOT EXISTS customer_receipts (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  company_id      BIGINT        NOT NULL,
  customer_id     BIGINT        NOT NULL,
  receipt_number  VARCHAR(40)   NOT NULL,
  receipt_date    DATE          NOT NULL,
  amount          DECIMAL(15,2) NOT NULL,
  mode            VARCHAR(16)   NOT NULL,
  bank_account_id BIGINT        NULL,
  reference       VARCHAR(100)  NULL,
  notes           VARCHAR(500)  NULL,
  status          VARCHAR(12)   NOT NULL DEFAULT 'ACTIVE',
  cancel_reason   VARCHAR(300)  NULL,
  cancelled_by    BIGINT        NULL,
  cancelled_at    DATETIME      NULL,
  created_by      BIGINT        NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_cr_number (company_id, receipt_number),
  KEY ix_cr_customer (company_id, customer_id),
  KEY ix_cr_date (company_id, receipt_date)
);

CREATE TABLE IF NOT EXISTS expenses (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  company_id      BIGINT        NOT NULL,
  expense_number  VARCHAR(40)   NOT NULL,
  expense_date    DATE          NOT NULL,
  account_id      BIGINT        NOT NULL,
  payee           VARCHAR(150)  NULL,
  payee_gstin     VARCHAR(15)   NULL,
  bill_number     VARCHAR(60)   NULL,
  amount          DECIMAL(15,2) NOT NULL,
  gst_rate        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  tax_type        VARCHAR(12)   NOT NULL DEFAULT 'NO_GST',
  cgst_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  sgst_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  igst_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  total           DECIMAL(15,2) NOT NULL,
  mode            VARCHAR(16)   NOT NULL,
  bank_account_id BIGINT        NULL,
  reference       VARCHAR(100)  NULL,
  notes           VARCHAR(500)  NULL,
  status          VARCHAR(12)   NOT NULL DEFAULT 'ACTIVE',
  cancel_reason   VARCHAR(300)  NULL,
  cancelled_by    BIGINT        NULL,
  cancelled_at    DATETIME      NULL,
  created_by      BIGINT        NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_exp_number (company_id, expense_number),
  KEY ix_exp_date (company_id, expense_date),
  KEY ix_exp_account (company_id, account_id)
);

DROP PROCEDURE IF EXISTS samebook_payment_links;
DELIMITER //
CREATE PROCEDURE samebook_payment_links()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_payments' AND COLUMN_NAME = 'receipt_id') THEN
    ALTER TABLE invoice_payments ADD COLUMN receipt_id BIGINT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_payments' AND COLUMN_NAME = 'bank_account_id') THEN
    ALTER TABLE invoice_payments ADD COLUMN bank_account_id BIGINT NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_payments' AND INDEX_NAME = 'ix_ip_receipt') THEN
    ALTER TABLE invoice_payments ADD KEY ix_ip_receipt (receipt_id);
  END IF;
END //
DELIMITER ;
CALL samebook_payment_links();
DROP PROCEDURE samebook_payment_links;

-- ── Step 3: credit notes, debit notes, refunds ──────────────────────────────
-- credit_notes / credit_note_items
--     A GST credit note (CN/26-27/0001) against one of your invoices: goods
--     returned (lines from the invoice, optionally back into stock) or a price
--     reduction. GST is reversed at the invoice's rates.
-- credit_note_applications
--     Where a credit note's value went: the invoice it was raised on (up to its
--     balance) and, later, other invoices of the same customer.
--     invoices.credited_amount = the sum of these for an invoice, so its
--     balance = grand_total - paid_amount - credited_amount.
-- customer_refunds / customer_refund_sources
--     Money paid back to a customer (RFD/26-27/0001) out of their advance:
--     receipts not used on invoices, or credit notes not applied.
-- debit_notes / debit_note_items
--     A debit note (DN/26-27/0001) to a supplier against their bill: goods
--     returned (optionally out of stock) or a price reduction; input GST is
--     reversed. purchase_bills.credited_amount lowers the bill's balance.

CREATE TABLE IF NOT EXISTS credit_notes (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  company_id      BIGINT        NOT NULL,
  cn_number       VARCHAR(40)   NOT NULL,
  cn_date         DATE          NOT NULL,
  invoice_id      BIGINT        NOT NULL,
  customer_id     BIGINT        NOT NULL,
  reason          VARCHAR(20)   NOT NULL,
  note            VARCHAR(500)  NULL,
  taxable_amount  DECIMAL(15,2) NOT NULL DEFAULT 0,
  cgst_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  sgst_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  igst_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  total           DECIMAL(15,2) NOT NULL DEFAULT 0,
  restock         TINYINT(1)    NOT NULL DEFAULT 0,
  warehouse_id    BIGINT        NULL,
  status          VARCHAR(12)   NOT NULL DEFAULT 'ACTIVE',
  cancel_reason   VARCHAR(300)  NULL,
  cancelled_by    BIGINT        NULL,
  cancelled_at    DATETIME      NULL,
  created_by      BIGINT        NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_cn_number (company_id, cn_number),
  KEY ix_cn_invoice (company_id, invoice_id),
  KEY ix_cn_customer (company_id, customer_id),
  KEY ix_cn_date (company_id, cn_date)
);

CREATE TABLE IF NOT EXISTS credit_note_items (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  credit_note_id  BIGINT        NOT NULL,
  invoice_item_id BIGINT        NULL,
  product_id      BIGINT        NULL,
  item_name       VARCHAR(255)  NOT NULL,
  hsn_code        VARCHAR(20)   NULL,
  unit            VARCHAR(30)   NULL,
  qty             DECIMAL(14,3) NULL,
  rate            DECIMAL(14,2) NULL,
  taxable_amount  DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_cni_note (credit_note_id),
  KEY ix_cni_item (invoice_item_id)
);

CREATE TABLE IF NOT EXISTS credit_note_applications (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  company_id      BIGINT        NOT NULL,
  credit_note_id  BIGINT        NOT NULL,
  invoice_id      BIGINT        NOT NULL,
  amount          DECIMAL(15,2) NOT NULL,
  created_by      BIGINT        NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_cna_note (credit_note_id),
  KEY ix_cna_invoice (invoice_id)
);

CREATE TABLE IF NOT EXISTS customer_refunds (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  company_id      BIGINT        NOT NULL,
  customer_id     BIGINT        NOT NULL,
  refund_number   VARCHAR(40)   NOT NULL,
  refund_date     DATE          NOT NULL,
  amount          DECIMAL(15,2) NOT NULL,
  mode            VARCHAR(16)   NOT NULL,
  bank_account_id BIGINT        NULL,
  reference       VARCHAR(100)  NULL,
  notes           VARCHAR(500)  NULL,
  status          VARCHAR(12)   NOT NULL DEFAULT 'ACTIVE',
  cancel_reason   VARCHAR(300)  NULL,
  cancelled_by    BIGINT        NULL,
  cancelled_at    DATETIME      NULL,
  created_by      BIGINT        NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_rfd_number (company_id, refund_number),
  KEY ix_rfd_customer (company_id, customer_id)
);

CREATE TABLE IF NOT EXISTS customer_refund_sources (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  refund_id       BIGINT        NOT NULL,
  receipt_id      BIGINT        NULL,
  credit_note_id  BIGINT        NULL,
  amount          DECIMAL(15,2) NOT NULL,
  PRIMARY KEY (id),
  KEY ix_rfs_refund (refund_id),
  KEY ix_rfs_receipt (receipt_id),
  KEY ix_rfs_note (credit_note_id)
);

CREATE TABLE IF NOT EXISTS debit_notes (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  company_id      BIGINT        NOT NULL,
  dn_number       VARCHAR(40)   NOT NULL,
  dn_date         DATE          NOT NULL,
  bill_id         BIGINT        NOT NULL,
  supplier_id     BIGINT        NOT NULL,
  reason          VARCHAR(20)   NOT NULL,
  note            VARCHAR(500)  NULL,
  taxable_amount  DECIMAL(15,2) NOT NULL DEFAULT 0,
  cgst_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  sgst_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  igst_amount     DECIMAL(15,2) NOT NULL DEFAULT 0,
  total           DECIMAL(15,2) NOT NULL DEFAULT 0,
  applied_amount  DECIMAL(15,2) NOT NULL DEFAULT 0,
  unstock         TINYINT(1)    NOT NULL DEFAULT 0,
  warehouse_id    BIGINT        NULL,
  status          VARCHAR(12)   NOT NULL DEFAULT 'ACTIVE',
  cancel_reason   VARCHAR(300)  NULL,
  cancelled_by    BIGINT        NULL,
  cancelled_at    DATETIME      NULL,
  created_by      BIGINT        NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_dn_number (company_id, dn_number),
  KEY ix_dn_bill (company_id, bill_id),
  KEY ix_dn_supplier (company_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS debit_note_items (
  id              BIGINT        NOT NULL AUTO_INCREMENT,
  debit_note_id   BIGINT        NOT NULL,
  bill_item_id    BIGINT        NULL,
  product_id      BIGINT        NULL,
  item_name       VARCHAR(255)  NOT NULL,
  hsn_code        VARCHAR(20)   NULL,
  unit            VARCHAR(30)   NULL,
  qty             DECIMAL(14,3) NULL,
  rate            DECIMAL(14,2) NULL,
  gst_rate        DECIMAL(5,2)  NOT NULL DEFAULT 0,
  taxable_amount  DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_dni_note (debit_note_id),
  KEY ix_dni_item (bill_item_id)
);

DROP PROCEDURE IF EXISTS samebook_credited_amounts;
DELIMITER //
CREATE PROCEDURE samebook_credited_amounts()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'credited_amount') THEN
    ALTER TABLE invoices ADD COLUMN credited_amount DECIMAL(15,2) NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'purchase_bills' AND COLUMN_NAME = 'credited_amount') THEN
    ALTER TABLE purchase_bills ADD COLUMN credited_amount DECIMAL(15,2) NOT NULL DEFAULT 0;
  END IF;
END //
DELIMITER ;
CALL samebook_credited_amounts();
DROP PROCEDURE samebook_credited_amounts;
