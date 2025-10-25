-- Migration: 007_staging_setup.sql
-- Purpose: Create staging tables to import data from legacy smart_order DB before transformation.

-- Drop existing staging tables if re-running (idempotent via IF EXISTS)
DROP TABLE IF EXISTS staging.tenants_raw;
DROP TABLE IF EXISTS staging.tenant_domains_raw;
DROP TABLE IF EXISTS staging.branches_raw;
DROP TABLE IF EXISTS staging.users_raw;
DROP TABLE IF EXISTS staging.tenant_users_raw;
DROP TABLE IF EXISTS staging.roles_raw;
DROP TABLE IF EXISTS staging.permissions_raw;
DROP TABLE IF EXISTS staging.role_permissions_raw;
DROP TABLE IF EXISTS staging.devices_raw;
DROP TABLE IF EXISTS staging.subscriptions_raw;
DROP TABLE IF EXISTS staging.categories_raw;
DROP TABLE IF EXISTS staging.products_raw;

-- Create tables with flexible text types to accommodate input variability
CREATE TABLE staging.tenants_raw (
  tenant_id text,
  company_name text,
  created_at text,
  license_limit text,
  branch_limit text,
  short_code text,
  subdomain text,
  email text,
  status text,
  start_date text,
  renewal_date text,
  plan_type text
);

CREATE TABLE staging.tenant_domains_raw (
  host text,
  tenant_id text,
  verified_at text
);

CREATE TABLE staging.branches_raw (
  branch_id text,
  tenant_id text,
  branch_name text,
  created_at text,
  location text,
  expiry_date text,
  is_active text
);

CREATE TABLE staging.users_raw (
  user_id text,
  email text,
  name text,
  password_hash text,
  created_at text,
  full_name text,
  mobile text,
  photo_url text,
  deleted_at text,
  status text,
  last_login text
);

CREATE TABLE staging.tenant_users_raw (
  tenant_id text,
  user_id text,
  invited_at text,
  accepted_at text,
  role text,
  created_at text
);

CREATE TABLE staging.roles_raw (
  role_id text,
  tenant_id text,
  role_name text,
  description text,
  created_at text
);

CREATE TABLE staging.permissions_raw (
  permission_id text,
  code text,
  description text
);

CREATE TABLE staging.role_permissions_raw (
  role_id text,
  permission_id text
);

CREATE TABLE staging.devices_raw (
  device_id text,
  tenant_id text,
  device_name text,
  role text,
  status text,
  branch text,
  device_token text,
  activated_at text,
  revoked_at text,
  last_seen text,
  meta text,
  short_code text,
  branch_id text,
  location text,
  uuid text,
  activation_token text,
  expiry_date text,
  last_checkin text,
  created_at text
);

CREATE TABLE staging.subscriptions_raw (
  subscription_id text,
  tenant_id text,
  start_date text,
  end_date text,
  is_active text,
  devices_allowed text,
  branches_allowed text,
  notes text
);

CREATE TABLE staging.categories_raw (
  id text,
  tenant_id text,
  name text,
  created_at text,
  reference text,
  name_localized text,
  image_url text,
  meta text,
  active text,
  deleted text
);

CREATE TABLE staging.products_raw (
  id text,
  tenant_id text,
  category_id text,
  name text,
  description text,
  price text,
  created_at text,
  image_url text,
  image_ext text,
  name_localized text,
  description_localized text,
  sku text,
  tax_group_reference text,
  is_sold_by_weight text,
  is_active text,
  is_stock_product text,
  cost text,
  barcode text,
  preparation_time text,
  calories text,
  walking_minutes_to_burn_calories text,
  is_high_salt text,
  meta text,
  active text,
  category_reference text,
  ingredients_en text,
  ingredients_ar text,
  allergens text,
  fat_g text,
  carbs_g text,
  protein_g text,
  sugar_g text,
  sodium_mg text,
  serving_size text,
  pos_visible text,
  online_visible text,
  delivery_visible text,
  spice_level text,
  packaging_fee text,
  image_white_url text,
  image_beauty_url text,
  talabat_reference text,
  jahez_reference text,
  vthru_reference text,
  nutrition text,
  salt_g text
);
