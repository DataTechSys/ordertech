-- 20250901_tenant_short_code.sql — Add 6-digit short code for tenants and backfill

-- Add short_code to tenants: 6 digits, unique when present
ALTER TABLE IF EXISTS public.tenants
  ADD COLUMN IF NOT EXISTS short_code char(6);

-- Enforce 6-digit format (strict check). On fresh DB this will succeed; on re-run it will be skipped by schema_migrations.
ALTER TABLE public.tenants
  ADD CONSTRAINT tenants_short_code_digits_chk
  CHECK (short_code ~ '^[0-9]{6}$');

-- Unique short_code per tenant (only when not null). Create if missing.
CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_short_code
  ON public.tenants(short_code) WHERE short_code IS NOT NULL;

-- Backfill missing codes deterministically to avoid collisions
WITH seq AS (
  SELECT id,
         lpad((row_number() over (order by id))::text, 6, '0') AS code
  FROM public.tenants
  WHERE short_code IS NULL
)
UPDATE public.tenants t
SET short_code = seq.code
FROM seq
WHERE t.id = seq.id;

