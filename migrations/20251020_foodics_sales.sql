BEGIN;

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
    customer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    external_id text,
    external_ref text,
    full_name text,
    first_name text,
    last_name text,
    email text,
    phone text,
    phone_normalized text,
    country_code text,
    tags text[],
    last_seen_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (tenant_id, external_id)
);

-- Customer addresses
CREATE TABLE IF NOT EXISTS customer_addresses (
    address_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    customer_id uuid NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    external_id text,
    label text,
    line1 text,
    line2 text,
    city text,
    region text,
    postal_code text,
    country text,
    latitude numeric(10,6),
    longitude numeric(10,6),
    is_default boolean DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Sales orders
CREATE TABLE IF NOT EXISTS sales_orders (
    order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    external_id text NOT NULL,
    external_ref text,
    branch_id uuid REFERENCES branches(branch_id) ON DELETE SET NULL,
    customer_id uuid REFERENCES customers(customer_id) ON DELETE SET NULL,
    currency text DEFAULT 'KWD',
    status text,
    source_channel text,
    service_type text,
    order_no text,
    receipt_no text,
    table_name text,
    waiter_name text,
    driver_name text,
    
    -- Monetary amounts (precision 12,3 for sub-currency units)
    subtotal numeric(12,3) DEFAULT 0,
    discount_total numeric(12,3) DEFAULT 0,
    tax_total numeric(12,3) DEFAULT 0,
    service_charge numeric(12,3) DEFAULT 0,
    delivery_fee numeric(12,3) DEFAULT 0,
    rounding numeric(12,3) DEFAULT 0,
    tip_amount numeric(12,3) DEFAULT 0,
    total numeric(12,3) DEFAULT 0,
    paid_total numeric(12,3) DEFAULT 0,
    balance_due numeric(12,3) DEFAULT 0,
    
    -- Timestamps
    placed_at timestamptz,
    paid_at timestamptz,
    closed_at timestamptz,
    pos_created_at timestamptz,
    pos_updated_at timestamptz,
    
    -- Status flags
    is_voided boolean DEFAULT false,
    is_refunded boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    
    UNIQUE (tenant_id, external_id)
);

-- Sales order items
CREATE TABLE IF NOT EXISTS sales_order_items (
    item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES sales_orders(order_id) ON DELETE CASCADE,
    external_id text NOT NULL,
    line_no integer,
    product_id uuid REFERENCES products(id) ON DELETE SET NULL,
    product_external_id text,
    product_name text NOT NULL,
    product_ref text,
    sku text,
    
    -- Quantities and pricing
    qty numeric(12,3) NOT NULL DEFAULT 1,
    unit_price numeric(12,3) NOT NULL DEFAULT 0,
    base_price numeric(12,3) DEFAULT 0,
    discount_total numeric(12,3) DEFAULT 0,
    tax_total numeric(12,3) DEFAULT 0,
    total numeric(12,3) NOT NULL DEFAULT 0,
    
    is_voided boolean DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    
    UNIQUE (tenant_id, order_id, external_id)
);

-- Sales order item modifiers
CREATE TABLE IF NOT EXISTS sales_order_item_modifiers (
    mod_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    item_id uuid NOT NULL REFERENCES sales_order_items(item_id) ON DELETE CASCADE,
    option_id uuid REFERENCES modifier_options(id) ON DELETE SET NULL,
    option_external_id text,
    option_name text NOT NULL,
    qty numeric(12,3) NOT NULL DEFAULT 1,
    unit_price numeric(12,3) DEFAULT 0,
    total numeric(12,3) DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Sales payments
CREATE TABLE IF NOT EXISTS sales_payments (
    payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES sales_orders(order_id) ON DELETE CASCADE,
    external_id text NOT NULL,
    method text,
    provider text,
    reference text,
    amount numeric(12,3) NOT NULL DEFAULT 0,
    tip_amount numeric(12,3) DEFAULT 0,
    currency text DEFAULT 'KWD',
    paid_at timestamptz,
    card_type text,
    card_last4 text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    
    UNIQUE (tenant_id, external_id)
);

-- Sales discounts
CREATE TABLE IF NOT EXISTS sales_discounts (
    discount_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES sales_orders(order_id) ON DELETE CASCADE,
    item_id uuid REFERENCES sales_order_items(item_id) ON DELETE CASCADE,
    external_id text,
    name text,
    scope text, -- 'order' or 'item'
    type text,  -- 'fixed', 'percentage', etc.
    value numeric(12,3), -- discount value (amount or percentage)
    amount numeric(12,3) NOT NULL DEFAULT 0, -- actual discount amount applied
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Sales taxes
CREATE TABLE IF NOT EXISTS sales_taxes (
    tax_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    order_id uuid NOT NULL REFERENCES sales_orders(order_id) ON DELETE CASCADE,
    item_id uuid REFERENCES sales_order_items(item_id) ON DELETE CASCADE,
    external_id text,
    name text,
    rate numeric(5,3), -- Tax rate (e.g., 0.100 for 10%)
    amount numeric(12,3) NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- Integration sync state for cursors
CREATE TABLE IF NOT EXISTS integration_sync_state (
    tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
    provider text NOT NULL,
    resource text NOT NULL,
    cursor jsonb DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, provider, resource)
);

-- Indexes for customers
CREATE INDEX IF NOT EXISTS ix_customers_tenant_phone ON customers(tenant_id, phone_normalized);
CREATE INDEX IF NOT EXISTS ix_customers_tenant_email ON customers(tenant_id, email);
CREATE INDEX IF NOT EXISTS ix_customers_tenant_last_seen ON customers(tenant_id, last_seen_at DESC);

-- Indexes for customer_addresses
CREATE INDEX IF NOT EXISTS ix_customer_addresses_tenant_customer ON customer_addresses(tenant_id, customer_id);
CREATE INDEX IF NOT EXISTS ix_customer_addresses_tenant_external ON customer_addresses(tenant_id, external_id);

-- Indexes for sales_orders
CREATE INDEX IF NOT EXISTS ix_sales_orders_tenant_paid ON sales_orders(tenant_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS ix_sales_orders_tenant_created ON sales_orders(tenant_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS ix_sales_orders_branch_closed ON sales_orders(branch_id, closed_at DESC);
CREATE INDEX IF NOT EXISTS ix_sales_orders_customer_paid ON sales_orders(customer_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS ix_sales_orders_status ON sales_orders(tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_sales_orders_external ON sales_orders(tenant_id, external_id);

-- Indexes for sales_order_items
CREATE INDEX IF NOT EXISTS ix_sales_order_items_tenant_order ON sales_order_items(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS ix_sales_order_items_tenant_product ON sales_order_items(tenant_id, product_id);

-- Indexes for sales_order_item_modifiers
CREATE INDEX IF NOT EXISTS ix_sales_order_item_modifiers_tenant_item ON sales_order_item_modifiers(tenant_id, item_id);

-- Indexes for sales_payments
CREATE INDEX IF NOT EXISTS ix_sales_payments_tenant_order ON sales_payments(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS ix_sales_payments_tenant_paid ON sales_payments(tenant_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS ix_sales_payments_tenant_method ON sales_payments(tenant_id, method);

-- Indexes for sales_discounts
CREATE INDEX IF NOT EXISTS ix_sales_discounts_tenant_order ON sales_discounts(tenant_id, order_id);
CREATE INDEX IF NOT EXISTS ix_sales_discounts_tenant_item ON sales_discounts(tenant_id, item_id);

-- Indexes for sales_taxes
CREATE INDEX IF NOT EXISTS ix_sales_taxes_tenant_order ON sales_taxes(tenant_id, order_id);

-- GIN index on meta columns for dynamic queries
CREATE INDEX IF NOT EXISTS ix_sales_orders_meta ON sales_orders USING GIN (meta);

COMMIT;