# Mapping: smart_order -> ordertech

This document will be filled after introspection of the existing smart_order schema.

Plan:
- Inventory smart_order tables and schemas
- Identify domain tables to migrate now (categories, products, etc.)
- Map source columns to target tables/columns, including transformations
- Define tenant assignment strategy (single default tenant unless multi-tenant already)
- Capture constraints/uniqueness rules and conflict handling

Sections to complete:

## 1. Source inventory
- public.tenants(tenant_id, company_name, created_at, license_limit, branch_limit, short_code, subdomain, email, status, start_date, renewal_date, plan_type)
- public.tenant_domains(host, tenant_id, verified_at)
- public.branches(branch_id, tenant_id, branch_name, created_at, location, expiry_date, is_active)
- public.users(user_id, email, name, password_hash, created_at, full_name, mobile, photo_url, deleted_at, status, last_login)
- public.tenant_users(tenant_id, user_id, invited_at, accepted_at, role, created_at)
- public.roles(role_id, tenant_id, role_name, description, created_at)
- public.permissions(permission_id, code, description)
- public.role_permissions(role_id, permission_id)
- public.devices(device_id, tenant_id, device_name, role, status, branch, device_token, activated_at, revoked_at, last_seen, meta, short_code, branch_id, location, uuid, activation_token, expiry_date, last_checkin, created_at)
- public.subscriptions(subscription_id, tenant_id, start_date, end_date, is_active, devices_allowed, branches_allowed, notes)
- public.categories(id, tenant_id, name, created_at, reference, name_localized, image_url, meta, active, deleted)
- public.products(id, tenant_id, category_id, name, description, price, created_at, image_url, image_ext, name_localized, description_localized, sku, tax_group_reference, is_sold_by_weight, is_active, is_stock_product, cost, barcode, preparation_time, calories, walking_minutes_to_burn_calories, is_high_salt, meta, active, category_reference, ingredients_en, ingredients_ar, allergens, fat_g, carbs_g, protein_g, sugar_g, sodium_mg, serving_size, pos_visible, online_visible, delivery_visible, spice_level, packaging_fee, image_white_url, image_beauty_url, talabat_reference, jahez_reference, vthru_reference, nutrition, salt_g)

## 2. Target overview
- saas.* tables: tenants, branches, roles, users, devices, subscriptions, permissions, role_permissions
- audit.audit_logs
- catalog.*: categories, products

## 3. Column mapping

- public.tenants → saas.tenants
  - tenant_id → tenant_id (preserved)
  - company_name → company_name
  - subdomain → subdomain; if null, generated from company_name slug
  - tenant_domains.host (min per tenant) → domain
  - email → email
  - status → status (normalized to active/trial/suspended/inactive/deleted)
  - start_date → start_date
  - renewal_date → renewal_date
  - plan_type → plan_type
  - created_at → created_at
  - timezone → 'UTC' default (adjust later per tenant)

- public.branches → saas.branches
  - branch_id → branch_id (preserved)
  - tenant_id → tenant_id
  - branch_name → branch_name
  - location → location
  - expiry_date → expiry_date
  - is_active → is_active
  - created_at → created_at

- public.permissions → saas.permissions
  - permission_id → permission_id (preserved)
  - code → code
  - description → description

- public.roles → saas.roles
  - role_id → role_id (preserved)
  - tenant_id → tenant_id
  - role_name → role_name
  - description → description
  - created_at → created_at

- public.role_permissions → saas.role_permissions
  - role_id, permission_id → role_id, permission_id (preserved)

- public.tenant_users + public.users → saas.users
  - user_id (legacy) + tenant_id → user_id (new deterministic md5-based UUID per-tenant)
  - tenant_id → tenant_id
  - email (lowercased) → email
  - password_hash → password_hash
  - full_name/name → name
  - tenant_users.role (text) → role_id (mapped to saas.roles by name, created if missing)
  - status, deleted_at, last_login, created_at → status/last_login/created_at (normalized)

- public.devices → saas.devices
  - device_id → device_id (preserved)
  - tenant_id → tenant_id
  - branch_id → branch_id
  - device_name → device_name
  - uuid (text) → uuid (cast if valid UUID, else generated)
  - activation_token → activation_token
  - status → status (normalized)
  - expiry_date → expiry_date
  - last_checkin → last_checkin
  - created_at → created_at

- public.categories → catalog.categories
  - id → id (preserved)
  - tenant_id → tenant_id
  - parent_id → null (legacy has no parent)
  - name → name
  - slug → generated from name
  - active/deleted → status
  - created_at → created_at/updated_at
  - legacy_source, legacy_id set to ('smart_order', id)

- public.products → catalog.products
  - id → id (preserved)
  - tenant_id → tenant_id
  - category_id → category_id
  - name → name
  - sku → sku (if null, generated as 'SKU-' || id)
  - price → price (numeric)
  - description → description
  - meta → metadata (jsonb)
  - is_active/active → status
  - created_at → created_at/updated_at
  - legacy_source, legacy_id set to ('smart_order', id)

## 4. Data quality and constraints
- Duplicate handling
  - users: unique per (tenant_id, lower(email)) enforced
  - categories: unique (tenant_id, name), (tenant_id, slug)
  - products: unique (tenant_id, sku)
- Status normalization
  - devices/users/categories/products strings normalized to enumerated statuses; deleted flags mapped to 'deleted' where applicable
- Timestamp parsing/timezone
  - All timestamps stored as TIMESTAMPTZ; tenant.timezone currently defaulted to 'UTC'

## 5. Post-load checks
- Row counts
- Uniqueness validation
- FK integrity
