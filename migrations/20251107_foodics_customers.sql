-- Migration: Create foodics_customers table matching Foodics API v5 structure
-- This stores Foodics customers for multi-tenant sales analytics

BEGIN;

-- Drop existing if needed
DROP TABLE IF EXISTS foodics_customers CASCADE;

-- Create foodics_customers table with exact Foodics v5 fields
CREATE TABLE foodics_customers (
    -- Internal ID
    row_id BIGSERIAL PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE CASCADE,
    
    -- Foodics Customer Fields (exact match to API)
    id UUID NOT NULL,                              -- Foodics customer ID
    name TEXT,
    phone TEXT,
    dial_code INT,
    email TEXT,
    gender TEXT,
    birth_date DATE,
    notes TEXT,
    
    -- Account info
    order_count INT DEFAULT 0,
    house_account_balance NUMERIC(12,3) DEFAULT 0,
    house_account_limit NUMERIC(12,3),
    loyalty_balance NUMERIC(12,3) DEFAULT 0,
    
    -- Flags
    is_blacklisted BOOLEAN DEFAULT FALSE,
    is_house_account_enabled BOOLEAN DEFAULT FALSE,
    is_loyalty_enabled BOOLEAN DEFAULT FALSE,
    
    -- Timestamps
    last_order_at TIMESTAMPTZ,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    
    -- Sync tracking
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Unique constraint per tenant
    UNIQUE (tenant_id, id)
);

-- Indexes for performance
CREATE INDEX idx_foodics_customers_tenant ON foodics_customers(tenant_id);
CREATE INDEX idx_foodics_customers_tenant_name ON foodics_customers(tenant_id, name);
CREATE INDEX idx_foodics_customers_tenant_phone ON foodics_customers(tenant_id, phone);
CREATE INDEX idx_foodics_customers_tenant_email ON foodics_customers(tenant_id, email);
CREATE INDEX idx_foodics_customers_tenant_order_count ON foodics_customers(tenant_id, order_count DESC);
CREATE INDEX idx_foodics_customers_tenant_last_order ON foodics_customers(tenant_id, last_order_at DESC);
CREATE INDEX idx_foodics_customers_phone ON foodics_customers(phone) WHERE phone IS NOT NULL;

-- Comment
COMMENT ON TABLE foodics_customers IS 'Foodics POS customers - exact API v5 structure for multi-tenant sales analytics';

COMMIT;
