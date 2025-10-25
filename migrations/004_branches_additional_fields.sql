-- 004_branches_additional_fields.sql — Add additional fields to branches table for Foodics sync

-- Add additional fields to branches table (idempotent - safe to run multiple times)
ALTER TABLE branches 
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS tax_group text,
  ADD COLUMN IF NOT EXISTS active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Add index for reference lookups (commonly used for branch identification)
CREATE INDEX IF NOT EXISTS idx_branches_reference ON branches(tenant_id, reference) WHERE reference IS NOT NULL;

-- Add index for active branches (commonly filtered)
CREATE INDEX IF NOT EXISTS idx_branches_active ON branches(tenant_id, active);

-- Add updated_at trigger for branches
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_timestamp_branches ON branches;
CREATE TRIGGER set_timestamp_branches
    BEFORE UPDATE ON branches
    FOR EACH ROW
    EXECUTE PROCEDURE trigger_set_timestamp();