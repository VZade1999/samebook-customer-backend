-- Step 3 of the linking plan: every type of business.
--
-- companies.sales_flow   How the company usually sells; NULL = not chosen yet
--                        (admins are asked once), ALL = show everything.
--                        WITH_GOODS / SEND_FIRST / BILL_FIRST / SERVICES only
--                        change which buttons come first — nothing is blocked.
-- invoices.quotation_id  Now optional: an invoice can be made without a
--                        quotation (walk-in sales, challans made without one).
-- invoices.vehicle_number / transporter_name / lr_number / eway_bill_number
--                        Dispatch details of an invoice that travels with the
--                        goods (no challan); printed in its dispatch box.
--
-- Safe to run more than once.

DROP PROCEDURE IF EXISTS samebook_sales_flow;
DELIMITER //
CREATE PROCEDURE samebook_sales_flow()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'sales_flow') THEN
    ALTER TABLE companies ADD COLUMN sales_flow VARCHAR(20) NULL;
  END IF;

  ALTER TABLE invoices MODIFY COLUMN quotation_id BIGINT NULL;

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'vehicle_number') THEN
    ALTER TABLE invoices
      ADD COLUMN transporter_name VARCHAR(255) NULL,
      ADD COLUMN vehicle_number   VARCHAR(32)  NULL,
      ADD COLUMN lr_number        VARCHAR(50)  NULL,
      ADD COLUMN eway_bill_number VARCHAR(32)  NULL;
  END IF;
END //
DELIMITER ;
CALL samebook_sales_flow();
DROP PROCEDURE samebook_sales_flow;
