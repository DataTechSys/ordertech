-- Migration: Create Foodics inventory transactions table
-- This stores waste transactions from Foodics API

CREATE TABLE IF NOT EXISTS saas.foodics_inventory_transactions (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  foodics_id VARCHAR(50),
  type INTEGER NOT NULL, -- 10=Waste from Order, 12=Waste from production, 3=Adjustment
  quantity NUMERIC(10,3) NOT NULL,
  cost NUMERIC(10,3) DEFAULT 0,
  total_cost NUMERIC(10,3) DEFAULT 0, -- quantity * cost
  inventory_item_id UUID,
  product_id UUID,
  branch_id UUID,
  reason_id UUID,
  reason_name TEXT,
  notes TEXT,
  business_date DATE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ,
  meta JSONB,
  FOREIGN KEY (tenant_id) REFERENCES tenants(tenant_id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_fit_tenant_date ON saas.foodics_inventory_transactions(tenant_id, business_date DESC);
CREATE INDEX IF NOT EXISTS idx_fit_tenant_type ON saas.foodics_inventory_transactions(tenant_id, type);
CREATE INDEX IF NOT EXISTS idx_fit_tenant_product ON saas.foodics_inventory_transactions(tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_fit_tenant_branch ON saas.foodics_inventory_transactions(tenant_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_fit_created_at ON saas.foodics_inventory_transactions(created_at DESC);

COMMENT ON TABLE saas.foodics_inventory_transactions IS 'Inventory transactions from Foodics including waste data';
COMMENT ON COLUMN saas.foodics_inventory_transactions.type IS 'Transaction type: 10=Waste from Order, 12=Waste from production, 3=Quantity Adjustment';
COMMENT ON COLUMN saas.foodics_inventory_transactions.total_cost IS 'Calculated: quantity * cost';
