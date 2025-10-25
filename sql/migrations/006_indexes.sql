-- Migration: 006_indexes.sql
-- Purpose: Ensure important supporting indexes exist for performance.

-- Users
CREATE INDEX IF NOT EXISTS ix_users_lower_email ON saas.users(lower(email));

-- Devices lookup
CREATE INDEX IF NOT EXISTS ix_devices_uuid ON saas.devices(uuid);

-- Audit logs composite (already created in 004 but safe to re-assert)
CREATE INDEX IF NOT EXISTS ix_audit_logs_tenant_time ON audit.audit_logs(tenant_id, "timestamp" DESC);

-- Catalog
CREATE INDEX IF NOT EXISTS ix_categories_parent_id ON catalog.categories(parent_id);
CREATE INDEX IF NOT EXISTS ix_products_status ON catalog.products(status);
