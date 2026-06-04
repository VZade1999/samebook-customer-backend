-- Add company_prefix column to companies and ensure unique uppercase values
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS company_prefix VARCHAR(10) NOT NULL DEFAULT '';

ALTER TABLE companies
  MODIFY COLUMN company_prefix VARCHAR(10) NOT NULL DEFAULT '';

UPDATE companies
SET company_prefix = UPPER(REPLACE(name, ' ', ''))
WHERE company_prefix = '' OR company_prefix IS NULL;

UPDATE companies
SET company_prefix = UPPER(REPLACE(company_prefix, ' ', ''))
WHERE company_prefix IS NOT NULL;

UPDATE companies c
JOIN (
  SELECT company_prefix, COUNT(*) AS cnt
  FROM companies
  GROUP BY company_prefix
  HAVING COUNT(*) > 1
) dup ON c.company_prefix = dup.company_prefix
SET c.company_prefix = LEFT(CONCAT(LEFT(c.company_prefix, 6), LPAD(c.id, 4, '0')), 10)
WHERE c.company_prefix = dup.company_prefix;

CREATE UNIQUE INDEX idx_company_prefix ON companies (company_prefix);
