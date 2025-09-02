-- 20250901_product_fields_expansion.sql — Expand product attributes, branch availability, and product-modifier linking

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Enum for spice level
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'product_spice_level') THEN
    CREATE TYPE product_spice_level AS ENUM ('none','mild','medium','hot','extra_hot');
  END IF;
END$$;

-- Add new columns to products (idempotent)
ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS ingredients_en              text,
  ADD COLUMN IF NOT EXISTS ingredients_ar              text,
  ADD COLUMN IF NOT EXISTS allergens                   jsonb,
  ADD COLUMN IF NOT EXISTS fat_g                       numeric(10,3),
  ADD COLUMN IF NOT EXISTS carbs_g                     numeric(10,3),
  ADD COLUMN IF NOT EXISTS protein_g                   numeric(10,3),
  ADD COLUMN IF NOT EXISTS sugar_g                     numeric(10,3),
  ADD COLUMN IF NOT EXISTS sodium_mg                   integer,
  ADD COLUMN IF NOT EXISTS serving_size                text,
  ADD COLUMN IF NOT EXISTS pos_visible                 boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS online_visible              boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS delivery_visible            boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS spice_level                 product_spice_level,
  ADD COLUMN IF NOT EXISTS packaging_fee               numeric(10,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS image_white_url             text,
  ADD COLUMN IF NOT EXISTS image_beauty_url            text,
  ADD COLUMN IF NOT EXISTS talabat_reference           text,
  ADD COLUMN IF NOT EXISTS jahez_reference             text,
  ADD COLUMN IF NOT EXISTS vthru_reference             text,
  ADD COLUMN IF NOT EXISTS nutrition                   jsonb;

-- Basic non-breaking constraint (validate later if needed)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE c.conname = 'chk_products_packaging_fee_nonneg'
      AND t.relname = 'products'
      AND n.nspname = 'public'
  ) THEN
    ALTER TABLE IF EXISTS public.products
      ADD CONSTRAINT chk_products_packaging_fee_nonneg CHECK (packaging_fee >= 0) NOT VALID;
  END IF;
END$$;

-- Per-branch availability and overrides
CREATE TABLE IF NOT EXISTS product_branch_availability (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id  uuid NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  available  boolean NOT NULL DEFAULT true,
  price_override numeric(10,3),
  packaging_fee_override numeric(10,3),
  PRIMARY KEY (product_id, branch_id)
);
CREATE INDEX IF NOT EXISTS ix_pba_branch ON product_branch_availability(branch_id);

-- Link products to modifier groups with optional ordering/requirements
CREATE TABLE IF NOT EXISTS product_modifier_groups (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id   uuid NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  sort_order integer,
  required   boolean,
  min_select integer,
  max_select integer,
  PRIMARY KEY (product_id, group_id)
);

-- Unique mappings per tenant for external channels
-- Assumes products has tenant_id
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_tenant_talabat_ref ON products(tenant_id, talabat_reference) WHERE talabat_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_tenant_jahez_ref   ON products(tenant_id, jahez_reference)   WHERE jahez_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_tenant_vthru_ref   ON products(tenant_id, vthru_reference)   WHERE vthru_reference IS NOT NULL;

