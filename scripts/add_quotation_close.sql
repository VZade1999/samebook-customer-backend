-- Closing a quotation — the customer rejected it, or it expired — with the
-- reason (a key from CLOSE_REASONS in src/quotations/quotation-insights.rules.ts)
-- and the customer's feedback as a remark. The status itself goes to
-- REJECTED / EXPIRED (already in the enum); reopening clears these columns.
--
-- Safe to run more than once.

DROP PROCEDURE IF EXISTS samebook_qt_close;
DELIMITER //
CREATE PROCEDURE samebook_qt_close()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'quotations'
                   AND COLUMN_NAME = 'close_reason') THEN
    ALTER TABLE quotations
      ADD COLUMN close_reason VARCHAR(40)   NULL,
      ADD COLUMN close_remark VARCHAR(1000) NULL,
      ADD COLUMN closed_at    DATETIME      NULL,
      ADD COLUMN closed_by    BIGINT        NULL;
  END IF;
END //
DELIMITER ;
CALL samebook_qt_close();
DROP PROCEDURE samebook_qt_close;
