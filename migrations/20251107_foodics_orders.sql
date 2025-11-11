-- Migration: Create foodics_orders table matching Foodics API v5 structure
-- This stores raw Foodics orders for multi-tenant sales analytics

BEGIN;

-- Drop existing if needed
DROP TABLE IF EXISTS foodics_orders CASCADE;

-- Create foodics_orders table with exact Foodics v5 fields
CREATE TABLE foodics_orders (
    -- Internal ID
    row_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE CASCADE,
    
    -- Foodics Order Fields (exact match to API)
    id UUID NOT NULL,                              -- Foodics order ID
    app_id UUID,
    promotion_id UUID,
    discount_type INT,
    reference_x TEXT,
    number INT,
    type INT,                                      -- 1=dine-in, 2=takeaway, 3=delivery, etc.
    source INT,                                    -- 1=POS, 2=online, etc.
    status INT,                                    -- 1=open, 2=pending, 3=in_progress, 4=closed, etc.
    delivery_status INT,
    guests INT,
    kitchen_notes TEXT,
    customer_notes TEXT,
    business_date DATE,
    
    -- Pricing
    subtotal_price NUMERIC(12,3),
    discount_amount NUMERIC(12,3),
    rounding_amount NUMERIC(12,3),
    total_price NUMERIC(12,3),
    tax_exclusive_discount_amount NUMERIC(12,3),
    
    -- Timestamps
    delay_in_seconds INT,
    opened_at TIMESTAMPTZ,
    accepted_at TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    driver_assigned_at TIMESTAMPTZ,
    dispatched_at TIMESTAMPTZ,
    driver_collected_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    
    -- References
    reference BIGINT,
    check_number BIGINT,
    
    -- Full meta/raw data
    meta JSONB,
    
    -- Timestamps for sync tracking
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint per tenant
    UNIQUE (tenant_id, id)
);

-- Indexes for performance
CREATE INDEX idx_foodics_orders_tenant ON foodics_orders(tenant_id);
CREATE INDEX idx_foodics_orders_tenant_business_date ON foodics_orders(tenant_id, business_date DESC);
CREATE INDEX idx_foodics_orders_tenant_created ON foodics_orders(tenant_id, created_at DESC);
CREATE INDEX idx_foodics_orders_tenant_closed ON foodics_orders(tenant_id, closed_at DESC);
CREATE INDEX idx_foodics_orders_tenant_status ON foodics_orders(tenant_id, status);
CREATE INDEX idx_foodics_orders_reference ON foodics_orders(reference);
CREATE INDEX idx_foodics_orders_check_number ON foodics_orders(check_number);
CREATE INDEX idx_foodics_orders_meta_gin ON foodics_orders USING GIN (meta);

-- Comment
COMMENT ON TABLE foodics_orders IS 'Foodics POS orders - exact API v5 structure for multi-tenant sales analytics';

COMMIT;
