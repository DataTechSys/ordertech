-- 20250926_enforce_catalog_uniqueness.sql
-- Enforce uniqueness for Products by (tenant, lower(sku)) and Modifier Options by (tenant, group, lower(reference)).
-- Run this AFTER running the deduplication script so no duplicates remain.

-- Products: unique SKU per tenant (case-insensitive), ignoring null/blank SKUs
CREATE UNIQUE INDEX IF NOT EXISTS ux_products_tenant_lower_sku
  ON products (tenant_id, lower(sku))
  WHERE sku IS NOT NULL AND length(btrim(sku)) > 0;

-- Modifier options: unique reference (SKU) within group per tenant (case-insensitive), ignoring null/blank references
CREATE UNIQUE INDEX IF NOT EXISTS ux_modopt_tenant_group_lower_ref
  ON modifier_options (tenant_id, group_id, lower(reference))
  WHERE reference IS NOT NULL AND length(btrim(reference)) > 0;
