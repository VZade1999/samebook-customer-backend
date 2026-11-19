-- The customer's purchase order (PO) — the "Buyer's Order No. & Date" printed
-- on Indian challans and invoices. It lives on the quotation (the approved
-- quotation is the order); challans and invoices read it from there. It can
-- be changed until the quotation is invoiced, then it locks.
--
-- customers.po_required: the customer always sends a PO, so a quotation for
-- them can't be approved without one.
--
-- Safe to run more than once.

DROP PROCEDURE IF EXISTS samebook_customer_po;
DELIMITER //
CREATE PROCEDURE samebook_customer_po()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations'
                   AND COLUMN_NAME = 'customer_po_number') THEN
    ALTER TABLE quotations
      ADD COLUMN customer_po_number VARCHAR(40) NULL,
      ADD COLUMN customer_po_date   DATE        NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'customers'
                   AND COLUMN_NAME = 'po_required') THEN
    ALTER TABLE customers
      ADD COLUMN po_required TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
END //
DELIMITER ;
CALL samebook_customer_po();
DROP PROCEDURE samebook_customer_po;
