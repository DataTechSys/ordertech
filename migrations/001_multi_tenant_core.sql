-- Multi-tenant core schema
-- Safe, idempotent migration to add core SaaS tables

-- Ensure required extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Users table (platform users)
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Role enum (create if missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('owner','admin','staff','viewer');
  END IF;
END$$;

-- Tenant membership and roles
CREATE TABLE IF NOT EXISTS tenant_users (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'viewer',
  invited_at timestamptz,
  accepted_at timestamptz,
  PRIMARY KEY (tenant_id, user_id)
);

-- Tenant domains (subdomain or custom domains mapped to a tenant)
CREATE TABLE IF NOT EXISTS tenant_domains (
  host text PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  verified_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_tenant_domains_tenant_id ON tenant_domains(tenant_id);

-- Tenant settings and branding
CREATE TABLE IF NOT EXISTS tenant_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  slug text UNIQUE,
  default_locale text,
  currency text,
  timezone text,
  features jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS tenant_brand (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  display_name text,
  logo_url text,
  color_primary text,
  color_secondary text
);
