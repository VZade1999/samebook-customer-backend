-- GST on transport charges.
--
-- Under GST, transport (freight) that the seller charges on its own quotation or
-- invoice is part of the sale (value of supply, CGST Act section 15; a composite
-- supply with the goods), so it is taxed at the goods' GST rate.
--
-- companies.transport_gst   1 = transport on quotations and invoices carries GST at
--                           the document's rate (the GST rule; every company starts
--                           here). 0 = an Admin turned it off on the Company page,
--                           e.g. when the CA treats the freight as a pure-agent
--                           reimbursement.
-- quotations.transport_gst  Whether that document's transport was taxed. It is set
-- invoices.transport_gst    when the document's totals are worked out. Documents
--                           that already exist stay 0, exactly as they were issued.
--
-- Run this BEFORE deploying the backend that reads it. Safe to run more than once.

DROP PROCEDURE IF EXISTS samebook_transport_gst;
DELIMITER //
CREATE PROCEDURE samebook_transport_gst()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'companies' AND COLUMN_NAME = 'transport_gst') THEN
    ALTER TABLE companies ADD COLUMN transport_gst TINYINT(1) NOT NULL DEFAULT 1;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations' AND COLUMN_NAME = 'transport_gst') THEN
    ALTER TABLE quotations ADD COLUMN transport_gst TINYINT(1) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoices' AND COLUMN_NAME = 'transport_gst') THEN
    ALTER TABLE invoices ADD COLUMN transport_gst TINYINT(1) NOT NULL DEFAULT 0;
  END IF;
END //
DELIMITER ;
CALL samebook_transport_gst();
DROP PROCEDURE samebook_transport_gst;
