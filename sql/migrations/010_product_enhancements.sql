-- Migration: 010_product_enhancements.sql
-- Purpose: Add recommended fields and behaviors to catalog.products

-- 1) Types for enums
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'product_type' AND n.nspname = 'catalog') THEN
    CREATE TYPE catalog.product_type AS ENUM ('standard','combo','modifier','digital');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'sync_status' AND n.nspname = 'catalog') THEN
    CREATE TYPE catalog.sync_status AS ENUM ('pending','synced','error');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'diet_flag_enum' AND n.nspname = 'catalog') THEN
    CREATE TYPE catalog.diet_flag_enum AS ENUM ('vegan','gluten_free','keto');
  END IF;
END $$;

-- 2) Columns on catalog.products
ALTER TABLE catalog.products
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_modified_by uuid NULL REFERENCES saas.users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sort_order integer NULL,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS diet_flags catalog.diet_flag_enum[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS type catalog.product_type NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS sync_status catalog.sync_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS published_channels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS internal_notes text NULL,
  ADD COLUMN IF NOT EXISTS staff_notes text NULL;

-- is_deleted is a generated column from deleted_at
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='catalog' AND table_name='products' AND column_name='is_deleted'
  ) THEN
    ALTER TABLE catalog.products
      ADD COLUMN is_deleted boolean GENERATED ALWAYS AS (deleted_at IS NOT NULL) STORED;
  END IF;
END $$;

-- 3) Trigger to bump version, set updated_at and last_modified_by
CREATE OR REPLACE FUNCTION util.products_before_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  NEW.version := COALESCE(OLD.version, 1) + 1;
  -- set last_modified_by from session if provided
  NEW.last_modified_by := COALESCE(current_setting('app.user_id', true), NULL)::uuid;
  RETURN NEW;
END $$;

-- Replace existing updated_at trigger with the new composite trigger
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_products_updated_at'
  ) THEN
    DROP TRIGGER trg_products_updated_at ON catalog.products;
  END IF;
END $$;

CREATE TRIGGER trg_products_before_update
BEFORE UPDATE ON catalog.products
FOR EACH ROW
EXECUTE FUNCTION util.products_before_update();

-- 4) Indexes for new fields
CREATE INDEX IF NOT EXISTS ix_products_sort ON catalog.products(tenant_id, category_id, sort_order NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_products_featured ON catalog.products(tenant_id, is_featured);
CREATE INDEX IF NOT EXISTS ix_products_type ON catalog.products(type);
CREATE INDEX IF NOT EXISTS ix_products_sync_status ON catalog.products(sync_status);
CREATE INDEX IF NOT EXISTS ix_products_last_modified_by ON catalog.products(last_modified_by);
CREATE INDEX IF NOT EXISTS ix_products_is_deleted ON catalog.products(is_deleted);

-- GIN indexes for arrays (tags, diet_flags, published_channels)
CREATE INDEX IF NOT EXISTS gin_products_tags ON catalog.products USING GIN (tags);
CREATE INDEX IF NOT EXISTS gin_products_diet_flags ON catalog.products USING GIN (diet_flags);
CREATE INDEX IF NOT EXISTS gin_products_published_channels ON catalog.products USING GIN (published_channels);
