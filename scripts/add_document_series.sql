-- Document numbering series (invoices, quotations, delivery challans).
--
-- A company that has no active series for a document type keeps the standard
-- format (INV-YYYYMMDD-0001, QT-<PREFIX>-YYMMDD-001-0001, DC-...). Creating a
-- series lets a business continue its own numbering, e.g. KD/25-26/1543.
--
-- Safe to run more than once.

CREATE TABLE IF NOT EXISTS document_series (
  id                 BIGINT       NOT NULL AUTO_INCREMENT,
  company_id         BIGINT       NOT NULL,
  doc_type           VARCHAR(20)  NOT NULL,              -- INVOICE | QUOTATION | DELIVERY_CHALLAN
  name               VARCHAR(60)  NOT NULL,
  format             VARCHAR(80)  NOT NULL,              -- e.g. {PREFIX}/{FY}/{SEQ}
  padding            TINYINT      NOT NULL DEFAULT 4,    -- digits in {SEQ}, zero-filled
  reset_period       VARCHAR(10)  NOT NULL DEFAULT 'YEARLY', -- NEVER | YEARLY (Apr-Mar) | MONTHLY | DAILY
  next_number        INT          NOT NULL DEFAULT 1,
  current_period     VARCHAR(16)  NULL,                  -- period next_number belongs to
  is_default         TINYINT(1)   NOT NULL DEFAULT 0,
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,
  issued_count       INT          NOT NULL DEFAULT 0,
  last_issued_number VARCHAR(100) NULL,
  last_issued_at     DATETIME     NULL,
  created_by         BIGINT       NULL,
  updated_by         BIGINT       NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ds_company_type_name (company_id, doc_type, name),
  KEY idx_ds_company_type (company_id, doc_type, is_active, is_default)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Document numbers are unique per company, not across all companies: two
-- businesses may both have invoice "1543". Add the per-company keys first,
-- then drop the old global ones.
DROP PROCEDURE IF EXISTS samebook_ds_indexes;
DELIMITER //
CREATE PROCEDURE samebook_ds_indexes()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
                   AND INDEX_NAME = 'uq_invoices_company_number') THEN
    ALTER TABLE invoices ADD UNIQUE KEY uq_invoices_company_number (company_id, invoice_number);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices'
               AND INDEX_NAME = 'uk_invoice_number') THEN
    ALTER TABLE invoices DROP INDEX uk_invoice_number;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations'
                   AND INDEX_NAME = 'uq_quotations_company_number') THEN
    ALTER TABLE quotations ADD UNIQUE KEY uq_quotations_company_number (company_id, quotation_number);
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations'
               AND INDEX_NAME = 'quotation_number') THEN
    ALTER TABLE quotations DROP INDEX quotation_number;
  END IF;
  -- delivery_challans already has uq_dc_company_number (company_id, challan_number).
END //
DELIMITER ;
CALL samebook_ds_indexes();
DROP PROCEDURE samebook_ds_indexes;
