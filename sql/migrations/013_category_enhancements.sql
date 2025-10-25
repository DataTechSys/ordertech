-- Migration: 013_category_enhancements.sql
-- Purpose: Add sort/feature/tags to categories

ALTER TABLE catalog.categories
  ADD COLUMN IF NOT EXISTS sort_order integer,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

-- Indexes to support UI sorting and filtering
CREATE INDEX IF NOT EXISTS ix_categories_sort
  ON catalog.categories(tenant_id, sort_order NULLS LAST, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_categories_featured
  ON catalog.categories(tenant_id, is_featured);
CREATE INDEX IF NOT EXISTS gin_categories_tags
  ON catalog.categories USING GIN (tags);
