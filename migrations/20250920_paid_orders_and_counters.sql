BEGIN;

CREATE TABLE IF NOT EXISTS paid_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_no bigserial UNIQUE,
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(branch_id) ON DELETE SET NULL,
  basket_id text NOT NULL,
  osn text,
  ref text,
  branch_ticket_no bigint,
  cashier_device_id uuid REFERENCES devices(device_id) ON DELETE SET NULL,
  cashier_name text,
  display_device_id uuid REFERENCES devices(device_id) ON DELETE SET NULL,
  customer_name text,
  source text,
  location text,
  branch text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  total numeric(10,3) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KWD',
  paid_at timestamptz NOT NULL DEFAULT now(),
  sent_to_foodics_at timestamptz,
  foodics_status text,
  foodics_order_id text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_paid_orders_tenant_paid_at ON paid_orders(tenant_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS ix_paid_orders_branch_paid_at ON paid_orders(branch_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS ix_paid_orders_basket_paid_at ON paid_orders(basket_id, paid_at DESC);

CREATE TABLE IF NOT EXISTS paid_order_counters (
  tenant_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  current bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, branch_id)
);

COMMIT;
