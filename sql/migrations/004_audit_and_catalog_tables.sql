-- Migration: 004_audit_and_catalog_tables.sql
-- Purpose: Create audit logs (keeping CSV column names) and initial catalog tables.

-- ==================
-- audit.audit_logs
-- ==================
CREATE TABLE IF NOT EXISTS audit.audit_logs (
  log_id     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  user_id    uuid REFERENCES saas.users(user_id) ON DELETE SET NULL,
  action     varchar(100) NOT NULL,
  "timestamp" timestamptz NOT NULL DEFAULT now(),
  meta       jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_audit_logs_tenant_time ON audit.audit_logs(tenant_id, "timestamp" DESC);
CREATE INDEX IF NOT EXISTS ix_audit_logs_user_id ON audit.audit_logs(user_id);

-- ==================
-- catalog.categories
-- ==================
CREATE TABLE IF NOT EXISTS catalog.categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  parent_id   uuid REFERENCES catalog.categories(id) ON DELETE SET NULL,
  name        text NOT NULL,
  slug        text NOT NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','deleted')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz,
  legacy_source text,
  legacy_id     text,
  UNIQUE (tenant_id, slug),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS ix_categories_tenant_id ON catalog.categories(tenant_id);
DROP TRIGGER IF EXISTS trg_categories_updated_at ON catalog.categories;
CREATE TRIGGER trg_categories_updated_at BEFORE UPDATE ON catalog.categories FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();

-- =================
-- catalog.products
-- =================
CREATE TABLE IF NOT EXISTS catalog.products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  category_id  uuid REFERENCES catalog.categories(id) ON DELETE SET NULL,
  name         text NOT NULL,
  sku          text NOT NULL,
  price        numeric(12,2) NOT NULL DEFAULT 0,
  currency     text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  description  text,
  metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','deleted')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  legacy_source text,
  legacy_id     text,
  UNIQUE (tenant_id, sku)
);
CREATE INDEX IF NOT EXISTS ix_products_tenant_id ON catalog.products(tenant_id);
CREATE INDEX IF NOT EXISTS ix_products_category_id ON catalog.products(category_id);
DROP TRIGGER IF EXISTS trg_products_updated_at ON catalog.products;
CREATE TRIGGER trg_products_updated_at BEFORE UPDATE ON catalog.products FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();
