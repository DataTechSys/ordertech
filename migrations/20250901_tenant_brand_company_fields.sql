-- 20250901_tenant_brand_company_fields.sql — extend tenant_brand with company profile fields
-- Idempotent and safe

ALTER TABLE IF EXISTS tenant_brand
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS website text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text;

