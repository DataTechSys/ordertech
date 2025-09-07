-- 20250828_catalog_base.sql — base catalog tables (categories, products)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Ensure categories table
CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  reference text,
  name_localized text,
  image_url text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Helpful index; strict uniqueness added later if needed
CREATE INDEX IF NOT EXISTS ix_categories_tenant_name ON categories(tenant_id, name);
CREATE INDEX IF NOT EXISTS ix_categories_tenant_ref  ON categories(tenant_id, reference);

-- Ensure products table
CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  category_reference text,
  name text NOT NULL,
  name_localized text,
  description text,
  description_localized text,
  sku text,
  tax_group_reference text,
  is_sold_by_weight boolean,
  is_active boolean,
  is_stock_product boolean,
  price numeric(10,3) NOT NULL DEFAULT 0,
  cost numeric(10,3),
  barcode text,
  preparation_time integer,
  calories integer,
  walking_minutes_to_burn_calories integer,
  is_high_salt boolean,
  image_url text,
  image_ext text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Basic indexes
CREATE INDEX IF NOT EXISTS ix_products_tenant_name   ON products(tenant_id, name);
CREATE INDEX IF NOT EXISTS ix_products_tenant_catref ON products(tenant_id, category_reference);

