-- Migration: 026_add_tenants_meta.sql
-- Purpose: Add meta JSONB column to saas.tenants for storing Foodics API tokens and other config

-- Add meta column to saas.tenants
ALTER TABLE saas.tenants ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}';

-- Create index for efficient JSONB queries
CREATE INDEX IF NOT EXISTS ix_tenants_meta ON saas.tenants USING GIN (meta);

-- Add comment
COMMENT ON COLUMN saas.tenants.meta IS 'JSONB metadata including foodics_api_token and other tenant-specific configuration';
