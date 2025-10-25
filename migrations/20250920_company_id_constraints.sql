-- 20250920_company_id_constraints.sql — Enforce 6-digit Company ID and uniqueness, with backfill from short_code

-- Ensure column exists
ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS company_id char(6);

-- Backfill company_id from legacy short_code where missing
DO $$
BEGIN
  -- Only backfill rows where company_id is NULL and short_code seems valid (6 digits)
  BEGIN
    EXECUTE 'UPDATE tenants SET company_id = short_code WHERE company_id IS NULL AND short_code ~ ''^\\d{6}$'' ';
  EXCEPTION WHEN undefined_column THEN
    -- short_code column may not exist; skip backfill if so
    NULL;
  END;
END$$;

-- Add 6-digit constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'tenants_company_id_digits_chk'
      AND t.relname = 'tenants'
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_company_id_digits_chk
      CHECK (company_id ~ '^[0-9]{6}$');
  END IF;
END$$;

-- Unique company_id per tenant (only when not null). Idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_company_id
  ON tenants(company_id) WHERE company_id IS NOT NULL;
