-- 20250830_products_enhancements.sql
-- Align products schema with CSV headers and UI fields; add indexes

-- Ensure extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Categories: enforce unique reference per tenant
CREATE UNIQUE INDEX IF NOT EXISTS ux_categories_tenant_reference
  ON categories(tenant_id, reference);

-- Products: add/ensure columns
ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS category_reference text,
  ADD COLUMN IF NOT EXISTS name_localized text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS description_localized text,
  ADD COLUMN IF NOT EXISTS sku text,
  ADD COLUMN IF NOT EXISTS tax_group_reference text,
  ADD COLUMN IF NOT EXISTS is_sold_by_weight boolean,
  ADD COLUMN IF NOT EXISTS is_active boolean,
  ADD COLUMN IF NOT EXISTS is_stock_product boolean,
  ADD COLUMN IF NOT EXISTS cost numeric(10,3),
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS preparation_time integer,
  ADD COLUMN IF NOT EXISTS calories integer,
  ADD COLUMN IF NOT EXISTS walking_minutes_to_burn_calories integer,
  ADD COLUMN IF NOT EXISTS is_high_salt boolean,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS image_ext text,
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- Adjust price/cost precision to KWD-friendly 3 decimals
ALTER TABLE IF EXISTS products
  ALTER COLUMN price TYPE numeric(10,3);

ALTER TABLE IF EXISTS products
  ALTER COLUMN cost TYPE numeric(10,3);

-- Index for category_reference lookups per tenant
CREATE INDEX IF NOT EXISTS ix_products_tenant_category_reference
  ON products(tenant_id, category_reference);

