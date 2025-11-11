-- Create inventory items table for Foodics
-- This table stores inventory items with their costs for accurate COGS calculation

CREATE TABLE IF NOT EXISTS saas.foodics_inventory_items (
  row_id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE CASCADE,
  id UUID NOT NULL,
  name TEXT NOT NULL,
  sku TEXT,
  barcode TEXT,
  description TEXT,
  cost NUMERIC(12, 3),
  unit TEXT,
  category_id UUID,
  is_active BOOLEAN DEFAULT true,
  meta JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_foodics_inventory_items_tenant ON saas.foodics_inventory_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_foodics_inventory_items_sku ON saas.foodics_inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_foodics_inventory_items_active ON saas.foodics_inventory_items(tenant_id, is_active);

-- Create product to inventory item mapping table
CREATE TABLE IF NOT EXISTS saas.foodics_product_inventory_items (
  row_id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE CASCADE,
  product_id UUID NOT NULL,
  inventory_item_id UUID NOT NULL,
  quantity NUMERIC(12, 3) DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, product_id, inventory_item_id)
);

CREATE INDEX IF NOT EXISTS idx_product_inventory_items_product ON saas.foodics_product_inventory_items(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_product_inventory_items_inventory ON saas.foodics_product_inventory_items(tenant_id, inventory_item_id);

COMMENT ON TABLE saas.foodics_inventory_items IS 'Inventory items from Foodics with cost information';
COMMENT ON TABLE saas.foodics_product_inventory_items IS 'Maps products to their inventory items (recipes)';
