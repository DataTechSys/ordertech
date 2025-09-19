-- 20250800_compat_alias_columns.sql — Schema compatibility shims for legacy PK names
-- This migration adds alias columns (id/admin_id/role_id) to align older schemas that
-- used tenant_id/branch_id/device_id/id variants. It is safe and idempotent.
-- It runs before later migrations that reference tenants(id), devices(id), branches(id), etc.

DO $$
DECLARE
  spec RECORD;
  coltype TEXT;
BEGIN
  -- table_name, from_col (existing), alias_col (to add)
  FOR spec IN
    SELECT * FROM (VALUES
      ('tenants',          'tenant_id', 'id'),
      ('branches',         'branch_id', 'id'),
      ('devices',          'device_id', 'id'),
      ('platform_admins',  'id',        'admin_id'),
      ('platform_roles',   'id',        'role_id')
    ) AS t(table_name, from_col, alias_col)
  LOOP
    -- Ensure the source column exists on the table (and therefore the table exists)
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = spec.table_name
        AND column_name  = spec.from_col
    ) THEN
      -- Skip if alias already exists
      IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name   = spec.table_name
          AND column_name  = spec.alias_col
      ) THEN
        -- Determine the source column's type (e.g., uuid)
        SELECT format_type(a.atttypid, a.atttypmod)
          INTO coltype
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = spec.table_name
          AND a.attname = spec.from_col
          AND a.attnum > 0
          AND NOT a.attisdropped;

        -- Add alias column with the same type as the source column
        EXECUTE format('ALTER TABLE %I ADD COLUMN %I %s', spec.table_name, spec.alias_col, coltype);

        -- Backfill alias from the source
        EXECUTE format('UPDATE %I SET %I = %I WHERE %I IS NULL', spec.table_name, spec.alias_col, spec.from_col, spec.alias_col);

        -- Add a UNIQUE constraint so future FKs can reference the alias
        BEGIN
          EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (%I)',
            spec.table_name, spec.table_name || '_' || spec.alias_col || '_unique', spec.alias_col);
        EXCEPTION WHEN duplicate_object THEN
          -- constraint already exists
          NULL;
        END;

        -- Create/replace a small sync function: alias := source
        EXECUTE format($fn$
          CREATE OR REPLACE FUNCTION %I_%I_sync()
          RETURNS trigger AS $BODY$
          BEGIN
            NEW.%I := NEW.%I;
            RETURN NEW;
          END
          $BODY$ LANGUAGE plpgsql;
        $fn$, spec.table_name, spec.alias_col, spec.alias_col, spec.from_col);

        -- Trigger to keep alias in sync on insert/update of source
        BEGIN
          EXECUTE format('CREATE TRIGGER %I_%I_sync_tr BEFORE INSERT OR UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION %I_%I_sync()',
            spec.table_name, spec.alias_col, spec.from_col, spec.table_name, spec.table_name, spec.alias_col);
        EXCEPTION WHEN duplicate_object THEN
          -- trigger already exists
          NULL;
        END;
      END IF;
    END IF;
  END LOOP;
END $$;
