-- scripts/sql/add_company_id_saas_tenants.sql — add and backfill company_id on saas.tenants
-- Option A: preserve codes from archived public.tenants.short_code where available, else generate new unique 6‑digit codes

BEGIN;

-- 1) Column
ALTER TABLE saas.tenants
  ADD COLUMN IF NOT EXISTS company_id char(6);

-- 2) CHECK constraint (6 digits), create if missing (not valid yet)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE c.conname='tenants_company_id_digits_chk'
      AND n.nspname='saas' AND t.relname='tenants'
  ) THEN
    ALTER TABLE saas.tenants
      ADD CONSTRAINT tenants_company_id_digits_chk
      CHECK (company_id ~ '^[0-9]{6}$') NOT VALID;
  END IF;
END$$;

-- 3) Unique index (where not null)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname='saas' AND indexname='ux_saas_tenants_company_id'
  ) THEN
    CREATE UNIQUE INDEX ux_saas_tenants_company_id
      ON saas.tenants(company_id)
      WHERE company_id IS NOT NULL;
  END IF;
END$$;

-- 4) Backfill from archived public tenants (latest archive table). Prefer company_id if present; else short_code.
DO $$
DECLARE arch_tbl text; col_name text;
BEGIN
  SELECT c.relname INTO arch_tbl
    FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='archive' AND c.relname LIKE 'public__tenants__%'
   ORDER BY c.relname DESC
   LIMIT 1;

  IF arch_tbl IS NOT NULL THEN
    -- Detect which column exists in the archived tenants table
    SELECT CASE
             WHEN EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_schema='archive' AND table_name=arch_tbl AND column_name='company_id'
             ) THEN 'company_id'
             WHEN EXISTS (
               SELECT 1 FROM information_schema.columns
                WHERE table_schema='archive' AND table_name=arch_tbl AND column_name='short_code'
             ) THEN 'short_code'
             ELSE NULL
           END
      INTO col_name;

    IF col_name IS NOT NULL THEN
      EXECUTE format(
        'UPDATE saas.tenants s
            SET company_id = a.%I
           FROM archive.%I a
          WHERE s.company_id IS NULL
            AND s.tenant_id = a.tenant_id
            AND a.%I ~ ''^[0-9]{6}$'' ', col_name, arch_tbl, col_name);
    END IF;
  END IF;
END$$;

-- 5) Generate random unique codes for remaining NULLs
DO $$
DECLARE r RECORD; v_code char(6);
BEGIN
  FOR r IN SELECT tenant_id FROM saas.tenants WHERE company_id IS NULL LOOP
    FOR i IN 1..50 LOOP
      v_code := lpad(floor(random()*1000000)::text, 6, '0');
      EXIT WHEN NOT EXISTS (SELECT 1 FROM saas.tenants WHERE company_id = v_code);
    END LOOP;
    UPDATE saas.tenants SET company_id = v_code WHERE tenant_id = r.tenant_id;
  END LOOP;
END$$;

-- 6) Validate the CHECK
ALTER TABLE saas.tenants VALIDATE CONSTRAINT tenants_company_id_digits_chk;

COMMIT;
