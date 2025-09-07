-- 000_tenants_base.sql — base table(s) required by subsequent migrations
-- Idempotent and safe for fresh databases

-- Ensure extension for gen_random_uuid (used by later migrations)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create tenants table (minimal columns). Later migrations will add more fields/constraints.
CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

