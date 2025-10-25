-- 20250901_tenant_short_code.sql — Add 6-digit short code for tenants and backfill

-- Add short_code to tenants: 6 digits, unique when present
ALTER TABLE IF EXISTS public.tenants
  ADD COLUMN IF NOT EXISTS short_code char(6);

-- Enforce 6-digit format (strict check) if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'tenants_short_code_digits_chk'
      AND t.relname = 'tenants'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_short_code_digits_chk
      CHECK (short_code ~ '^[0-9]{6}$');
  END IF;
END$$;

-- Unique short_code per tenant (only when not null). Create if missing.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_short_code
  ON public.tenants(short_code) WHERE short_code IS NOT NULL;

-- Backfill missing codes deterministically to avoid collisions
DO $$
DECLARE has_tenant_id boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='tenants' AND column_name='tenant_id'
  ) INTO has_tenant_id;

  IF has_tenant_id THEN
    WITH seq AS (
      SELECT tenant_id AS k,
             lpad((row_number() over (order by tenant_id))::text, 6, '0') AS code
        FROM public.tenants
       WHERE short_code IS NULL
    )
    UPDATE public.tenants t
       SET short_code = seq.code
      FROM seq
     WHERE t.tenant_id = seq.k;
  ELSE
    WITH seq AS (
      SELECT id AS k,
             lpad((row_number() over (order by id))::text, 6, '0') AS code
        FROM public.tenants
       WHERE short_code IS NULL
    )
    UPDATE public.tenants t
       SET short_code = seq.code
      FROM seq
     WHERE t.id = seq.k;
  END IF;
END$$;

