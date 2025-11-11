-- Create foodics_categories table
CREATE TABLE IF NOT EXISTS saas.foodics_categories (
  row_id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE CASCADE,
  id UUID NOT NULL, -- Foodics category ID
  
  -- Category info
  name TEXT NOT NULL,
  name_localized JSONB,
  reference TEXT,
  
  -- Hierarchy
  parent_id UUID,
  
  -- Metadata
  meta JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, id)
);

-- Create indexes for foodics_categories
CREATE INDEX IF NOT EXISTS idx_foodics_categories_tenant ON saas.foodics_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_foodics_categories_parent ON saas.foodics_categories(parent_id);
CREATE INDEX IF NOT EXISTS idx_foodics_categories_reference ON saas.foodics_categories(reference);

-- Create foodics_products table
CREATE TABLE IF NOT EXISTS saas.foodics_products (
  row_id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE CASCADE,
  id UUID NOT NULL, -- Foodics product ID
  
  -- Product info
  name TEXT NOT NULL,
  name_localized JSONB,
  description TEXT,
  description_localized JSONB,
  sku TEXT,
  barcode TEXT,
  image TEXT, -- Image URL
  
  -- Pricing
  price NUMERIC(12,3),
  cost NUMERIC(12,3),
  
  -- Category & Classification
  category_id UUID,
  is_active BOOLEAN DEFAULT true,
  is_ready BOOLEAN DEFAULT true,
  is_stock_product BOOLEAN DEFAULT false,
  
  -- Metadata
  meta JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, id)
);

-- Create indexes for foodics_products
CREATE INDEX IF NOT EXISTS idx_foodics_products_tenant ON saas.foodics_products(tenant_id);
CREATE INDEX IF NOT EXISTS idx_foodics_products_category ON saas.foodics_products(category_id);
CREATE INDEX IF NOT EXISTS idx_foodics_products_sku ON saas.foodics_products(sku);
CREATE INDEX IF NOT EXISTS idx_foodics_products_barcode ON saas.foodics_products(barcode);
CREATE INDEX IF NOT EXISTS idx_foodics_products_active ON saas.foodics_products(tenant_id, is_active);

-- Create foodics_order_items table
CREATE TABLE IF NOT EXISTS saas.foodics_order_items (
  row_id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE CASCADE,
  id UUID NOT NULL, -- Foodics order_item ID
  
  -- Relations
  order_id UUID NOT NULL, -- References foodics_orders(id)
  product_id UUID, -- References foodics_products(id)
  
  -- Item details
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,3),
  price NUMERIC(12,3),
  total_price NUMERIC(12,3),
  discount_amount NUMERIC(12,3),
  tax_amount NUMERIC(12,3),
  
  -- Product info (snapshot)
  product_name TEXT,
  product_sku TEXT,
  notes TEXT,
  
  -- Metadata
  meta JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(tenant_id, id)
);

-- Create indexes for foodics_order_items
CREATE INDEX IF NOT EXISTS idx_foodics_order_items_tenant ON saas.foodics_order_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_foodics_order_items_order ON saas.foodics_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_foodics_order_items_product ON saas.foodics_order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_foodics_order_items_tenant_product ON saas.foodics_order_items(tenant_id, product_id);
