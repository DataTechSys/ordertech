-- Migration: 025_foodics_order_push.sql
-- Purpose: Add JSONB meta columns for Foodics order push configuration and tracking
-- Date: 2025-01-07

BEGIN;

-- ============================================================================
-- Add meta column to saas.branches for Foodics configuration
-- ============================================================================
ALTER TABLE saas.branches 
ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN saas.branches.meta IS 'Branch metadata including Foodics configuration: foodics_branch_id, foodics_terminal_id, foodics_cashier_id, foodics_data';

-- Create GIN index for efficient JSONB queries on branches
CREATE INDEX IF NOT EXISTS idx_branches_meta_gin 
ON saas.branches USING gin (meta);

-- ============================================================================
-- Add meta column to saas.devices for device-level Foodics overrides
-- ============================================================================
-- Check if meta column already exists in devices
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'saas' 
        AND table_name = 'devices' 
        AND column_name = 'meta'
    ) THEN
        ALTER TABLE saas.devices 
        ADD COLUMN meta JSONB DEFAULT '{}'::jsonb;
    END IF;
END $$;

COMMENT ON COLUMN saas.devices.meta IS 'Device metadata including Foodics overrides: foodics_terminal_id_override, foodics_cashier_id_override';

-- Create GIN index for efficient JSONB queries on devices
CREATE INDEX IF NOT EXISTS idx_devices_meta_gin 
ON saas.devices USING gin (meta);

-- ============================================================================
-- Ensure orders table exists and has meta column
-- ============================================================================
-- Note: orders table structure may vary; adjust schema if needed
CREATE TABLE IF NOT EXISTS orders (
    order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
    device_id uuid REFERENCES saas.devices(device_id) ON DELETE SET NULL,
    branch_id uuid REFERENCES saas.branches(branch_id) ON DELETE SET NULL,
    order_number varchar(50),
    total numeric(12,2) NOT NULL DEFAULT 0,
    subtotal numeric(12,2),
    tax numeric(12,2),
    status varchar(50) NOT NULL DEFAULT 'pending',
    payment_method varchar(50),
    external_reference varchar(100),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    deleted_at timestamptz
);

-- Add meta column to orders for Foodics push tracking
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN orders.meta IS 'Order metadata including Foodics push tracking: foodics_order_id, foodics_push_status, foodics_push_attempts, foodics_push_error, foodics_reference, payment_method_hint';

-- Create GIN index for efficient JSONB queries on orders
CREATE INDEX IF NOT EXISTS idx_orders_meta_gin 
ON orders USING gin (meta);

-- Create index on orders for faster lookups by status and push status
CREATE INDEX IF NOT EXISTS idx_orders_status 
ON orders(status) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_foodics_push_status 
ON orders((meta->>'foodics_push_status')) 
WHERE deleted_at IS NULL AND (meta->>'foodics_push_status') IN ('pending', 'failed');

-- Create index for retry queue (orders needing push)
CREATE INDEX IF NOT EXISTS idx_orders_retry_queue 
ON orders(created_at) 
WHERE deleted_at IS NULL 
AND (meta->>'foodics_push_status') = 'failed'
AND COALESCE((meta->>'foodics_push_attempts')::int, 0) < 50;

-- ============================================================================
-- Create order_items table if not exists
-- ============================================================================
CREATE TABLE IF NOT EXISTS order_items (
    order_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id uuid,
    product_name varchar(255) NOT NULL,
    sku varchar(100),
    quantity integer NOT NULL DEFAULT 1,
    unit_price numeric(12,2) NOT NULL,
    line_total numeric(12,2) NOT NULL,
    options jsonb DEFAULT '[]'::jsonb,
    meta jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON order_items(product_id);

COMMENT ON COLUMN order_items.meta IS 'Item metadata including Foodics mapping: foodics_product_id, foodics_modifiers';

-- ============================================================================
-- Create foodics_push_log table for audit trail
-- ============================================================================
CREATE TABLE IF NOT EXISTS foodics_push_log (
    log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
    order_id uuid REFERENCES orders(order_id) ON DELETE SET NULL,
    device_id uuid REFERENCES saas.devices(device_id) ON DELETE SET NULL,
    branch_id uuid REFERENCES saas.branches(branch_id) ON DELETE SET NULL,
    attempt_number integer NOT NULL DEFAULT 1,
    status varchar(20) NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
    foodics_order_id varchar(100),
    foodics_reference varchar(100),
    request_payload jsonb,
    response_payload jsonb,
    error_message text,
    http_status integer,
    duration_ms integer,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_foodics_push_log_order_id ON foodics_push_log(order_id);
CREATE INDEX IF NOT EXISTS idx_foodics_push_log_tenant_id ON foodics_push_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_foodics_push_log_status ON foodics_push_log(status);
CREATE INDEX IF NOT EXISTS idx_foodics_push_log_created_at ON foodics_push_log(created_at DESC);

COMMENT ON TABLE foodics_push_log IS 'Audit log for Foodics order push attempts';

-- ============================================================================
-- Create helper function to get effective Foodics config for a device
-- ============================================================================
CREATE OR REPLACE FUNCTION get_device_foodics_config(p_device_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_config jsonb := '{}'::jsonb;
    v_device_meta jsonb;
    v_branch_meta jsonb;
BEGIN
    -- Get device meta and branch meta
    SELECT 
        d.meta,
        b.meta
    INTO 
        v_device_meta,
        v_branch_meta
    FROM saas.devices d
    LEFT JOIN saas.branches b ON d.branch_id = b.branch_id
    WHERE d.device_id = p_device_id;
    
    -- Start with branch defaults
    v_config := COALESCE(v_branch_meta, '{}'::jsonb);
    
    -- Apply device overrides if they exist
    IF v_device_meta ? 'foodics_terminal_id_override' THEN
        v_config := jsonb_set(v_config, '{foodics_terminal_id}', v_device_meta->'foodics_terminal_id_override');
    END IF;
    
    IF v_device_meta ? 'foodics_cashier_id_override' THEN
        v_config := jsonb_set(v_config, '{foodics_cashier_id}', v_device_meta->'foodics_cashier_id_override');
    END IF;
    
    RETURN v_config;
END;
$$;

COMMENT ON FUNCTION get_device_foodics_config(uuid) IS 'Returns effective Foodics configuration for a device, merging branch defaults with device overrides';

-- ============================================================================
-- Create view for orders needing Foodics push
-- ============================================================================
CREATE OR REPLACE VIEW orders_pending_foodics_push AS
SELECT 
    o.order_id,
    o.tenant_id,
    o.device_id,
    o.branch_id,
    o.order_number,
    o.total,
    o.status,
    o.created_at,
    COALESCE((o.meta->>'foodics_push_attempts')::int, 0) as push_attempts,
    o.meta->>'foodics_push_status' as push_status,
    o.meta->>'foodics_push_error' as last_error
FROM orders o
WHERE o.deleted_at IS NULL
  AND o.status NOT IN ('cancelled', 'voided')
  AND (
    o.meta->>'foodics_push_status' IS NULL 
    OR o.meta->>'foodics_push_status' IN ('pending', 'failed')
  )
  AND COALESCE((o.meta->>'foodics_push_attempts')::int, 0) < 50;

COMMENT ON VIEW orders_pending_foodics_push IS 'Orders that need to be pushed to Foodics (new, pending, or failed with retry attempts remaining)';

-- ============================================================================
-- Update trigger for orders.updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION touch_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_orders_updated_at ON orders;
CREATE TRIGGER trg_orders_updated_at
    BEFORE UPDATE ON orders
    FOR EACH ROW
    EXECUTE FUNCTION touch_orders_updated_at();

-- ============================================================================
-- Sample data examples (commented out)
-- ============================================================================

-- Example: Set Foodics config for a branch
-- UPDATE saas.branches 
-- SET meta = jsonb_set(
--     COALESCE(meta, '{}'::jsonb),
--     '{foodics_branch_id}',
--     '"abc123"'
-- )
-- WHERE branch_id = 'your-branch-uuid';

-- Example: Set terminal and cashier for a branch
-- UPDATE saas.branches 
-- SET meta = meta || jsonb_build_object(
--     'foodics_branch_id', 'abc123',
--     'foodics_terminal_id', 'terminal-001',
--     'foodics_cashier_id', 'ordertech-user-id'
-- )
-- WHERE branch_id = 'your-branch-uuid';

-- Example: Set device override
-- UPDATE saas.devices 
-- SET meta = meta || jsonb_build_object(
--     'foodics_terminal_id_override', 'terminal-002'
-- )
-- WHERE device_id = 'your-device-uuid';

COMMIT;
