-- Step 2 of the linking plan: bill what was delivered.
--
-- Each invoice line remembers what it bills:
--   quotation_item_id         the ordered line (for "ordered / sent / billed")
--   delivery_challan_id       the challan whose goods it bills, when made from challans
--   delivery_challan_item_id  …and the challan line
-- qty widens to 3 decimals to match challan quantities exactly.
--
-- Older invoices billed their whole quotation with the same lines in the same
-- order; their lines are linked to the quotation lines by name, quantity and
-- rate (checked unambiguous on 19 Nov 2026: 25 of 25 invoices match).
--
-- Safe to run more than once.

DROP PROCEDURE IF EXISTS samebook_invoice_line_links;
DELIMITER //
CREATE PROCEDURE samebook_invoice_line_links()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'invoice_items'
                   AND COLUMN_NAME = 'quotation_item_id') THEN
    ALTER TABLE invoice_items
      ADD COLUMN quotation_item_id        BIGINT NULL,
      ADD COLUMN delivery_challan_id      BIGINT NULL,
      ADD COLUMN delivery_challan_item_id BIGINT NULL,
      MODIFY COLUMN qty DECIMAL(14,3) NULL,
      ADD INDEX idx_invoice_items_quotation_item (quotation_item_id),
      ADD INDEX idx_invoice_items_challan (delivery_challan_id);
  END IF;

  UPDATE invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    JOIN quotation_items qi ON qi.quotation_id = i.quotation_id
                           AND qi.product_name = ii.product_name
                           AND qi.qty = ii.qty
                           AND qi.rate = ii.rate
     SET ii.quotation_item_id = qi.id
   WHERE ii.quotation_item_id IS NULL;
END //
DELIMITER ;
CALL samebook_invoice_line_links();
DROP PROCEDURE samebook_invoice_line_links;
