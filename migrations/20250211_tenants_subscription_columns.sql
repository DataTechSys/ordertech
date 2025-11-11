-- Add subscription columns directly to tenants table
-- This consolidates subscription data from tenant_settings.features JSONB into proper columns

ALTER TABLE tenants 
  ADD COLUMN IF NOT EXISTS subscription_type text DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

-- Backfill from tenant_settings.features.subscription if exists
UPDATE tenants t
SET 
  subscription_type = COALESCE(
    (SELECT features->'subscription'->>'tier' FROM tenant_settings WHERE tenant_id = t.tenant_id),
    'trial'
  ),
  subscription_expires_at = (
    SELECT (features->'subscription'->>'trial_ends_at')::timestamptz 
    FROM tenant_settings 
    WHERE tenant_id = t.tenant_id 
      AND features->'subscription'->>'trial_ends_at' IS NOT NULL
  )
WHERE EXISTS (SELECT 1 FROM tenant_settings WHERE tenant_id = t.tenant_id);

-- Create index for quick lookups of expired subscriptions
CREATE INDEX IF NOT EXISTS idx_tenants_subscription_expires 
  ON tenants(subscription_expires_at) 
  WHERE subscription_expires_at IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN tenants.subscription_type IS 'Subscription tier: trial, monthly, yearly, or custom';
COMMENT ON COLUMN tenants.subscription_expires_at IS 'When the subscription expires (NULL = never expires)';
