-- Migration: 002_utilities.sql
-- Purpose: Common utility functions (updated_at trigger, tenant GUC helper)

-- Function to auto-touch updated_at on UPDATE
CREATE OR REPLACE FUNCTION util.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Helper to set tenant in current session for RLS
CREATE OR REPLACE FUNCTION util.set_tenant(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.tenant_id', p_tenant_id::text, true);
END $$;
