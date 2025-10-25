-- 20250919_product_versioning_and_fields.sql — Product versioning, advanced fields, and indexes (ordertech)
-- Idempotent migration targeting public.products used by the admin APIs

BEGIN;

-- Ensure util schema exists
CREATE SCHEMA IF NOT EXISTS util;

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'diet_flag_enum') THEN
    CREATE TYPE diet_flag_enum AS ENUM ('vegan','gluten_free','keto');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_type') THEN
    CREATE TYPE product_type AS ENUM ('standard','combo','modifier','digital');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sync_status') THEN
    CREATE TYPE sync_status AS ENUM ('pending','synced','error');
  END IF;
END$$;

-- Columns on public.products
ALTER TABLE IF EXISTS public.products
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_modified_by text NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS sort_order integer NULL,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS diet_flags diet_flag_enum[] NOT NULL DEFAULT '{}'::diet_flag_enum[],
  ADD COLUMN IF NOT EXISTS product_type product_type NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS sync_status sync_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS published_channels text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS internal_notes text NULL,
  ADD COLUMN IF NOT EXISTS staff_notes text NULL;

-- Trigger to bump version and updated_at on UPDATE
CREATE OR REPLACE FUNCTION util.products_before_update()
RETURNS trigger AS $fn$
BEGIN
  NEW.updated_at := now();
  NEW.version := COALESCE(OLD.version, 1) + 1;
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_trigger
     WHERE tgname = 'trg_products_before_update'
  ) THEN
    CREATE TRIGGER trg_products_before_update
      BEFORE UPDATE ON public.products
      FOR EACH ROW
      EXECUTE FUNCTION util.products_before_update();
  END IF;
END$$;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS products_tenant_category_sort_created_idx
  ON public.products (tenant_id, category_id, sort_order NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS products_tenant_featured_idx
  ON public.products (tenant_id, is_featured);

-- GIN for arrays
CREATE INDEX IF NOT EXISTS products_tags_gin_idx
  ON public.products USING gin (tags);

CREATE INDEX IF NOT EXISTS products_diet_flags_gin_idx
  ON public.products USING gin (diet_flags);

CREATE INDEX IF NOT EXISTS products_published_channels_gin_idx
  ON public.products USING gin (published_channels);

COMMIT;
