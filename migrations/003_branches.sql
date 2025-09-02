-- 003_branches.sql — Ensure branches table exists and tenant branch_limit column

-- Add branch_limit to tenants if missing
ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS branch_limit integer NOT NULL DEFAULT 3;

-- Create branches table with unique name per tenant
CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

-- Helpful index
CREATE INDEX IF NOT EXISTS idx_branches_tenant ON branches(tenant_id);

