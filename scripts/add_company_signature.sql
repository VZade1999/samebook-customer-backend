-- Signature & stamp printed on documents.
--
-- companies.signature   The company's signature and/or stamp as a PNG (transparent
--                       background), printed above "Authorised Signatory" on
--                       quotations, delivery challans and tax invoices. NULL = none
--                       (the box stays blank to sign by hand).
--
-- Run this BEFORE deploying the backend that reads it. Safe to run more than once.

DROP PROCEDURE IF EXISTS samebook_company_signature;
DELIMITER //
CREATE PROCEDURE samebook_company_signature()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'signature') THEN
    ALTER TABLE companies ADD COLUMN signature MEDIUMBLOB NULL AFTER logo;
  END IF;
END //
DELIMITER ;
CALL samebook_company_signature();
DROP PROCEDURE samebook_company_signature;
