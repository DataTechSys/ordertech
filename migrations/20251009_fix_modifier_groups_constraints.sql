-- Fix product_modifier_groups foreign key constraints
-- This migration resolves the conflicting FK constraints that prevent modifier group linking

BEGIN;

-- First, let's see what we're working with
DO $$ 
BEGIN
    RAISE NOTICE 'Starting foreign key constraint cleanup for product_modifier_groups table';
END $$;

-- Drop all existing foreign key constraints on product_modifier_groups
-- to start with a clean slate
ALTER TABLE IF EXISTS product_modifier_groups 
    DROP CONSTRAINT IF EXISTS product_modifier_groups_group_id_fkey;

ALTER TABLE IF EXISTS product_modifier_groups 
    DROP CONSTRAINT IF EXISTS product_modifier_groups_product_id_fkey;

ALTER TABLE IF EXISTS product_modifier_groups 
    DROP CONSTRAINT IF EXISTS fk_pmg_product;

ALTER TABLE IF EXISTS product_modifier_groups 
    DROP CONSTRAINT IF EXISTS fk_pmg_modifier_group;

-- Drop the conflicting modifier_group_id column if it exists
ALTER TABLE IF EXISTS product_modifier_groups 
    DROP COLUMN IF EXISTS modifier_group_id;

-- Ensure the table has the correct structure
CREATE TABLE IF NOT EXISTS product_modifier_groups (
    product_id uuid NOT NULL,
    group_id uuid NOT NULL,
    sort_order integer DEFAULT 0,
    required boolean DEFAULT false,
    min_select integer,
    max_select integer,
    default_option_reference text,
    unique_options boolean NOT NULL DEFAULT true,
    PRIMARY KEY (product_id, group_id)
);

-- Add the correct foreign key constraints
ALTER TABLE product_modifier_groups 
    ADD CONSTRAINT product_modifier_groups_product_id_fkey 
    FOREIGN KEY (product_id) 
    REFERENCES products(id) 
    ON DELETE CASCADE;

ALTER TABLE product_modifier_groups 
    ADD CONSTRAINT product_modifier_groups_group_id_fkey 
    FOREIGN KEY (group_id) 
    REFERENCES modifier_groups(id) 
    ON DELETE CASCADE;

-- Clean up any orphaned records that might exist
DELETE FROM product_modifier_groups 
WHERE product_id NOT IN (SELECT id FROM products);

DELETE FROM product_modifier_groups 
WHERE group_id NOT IN (SELECT id FROM modifier_groups);

-- Add helpful indexes
CREATE INDEX IF NOT EXISTS idx_product_modifier_groups_product_id 
    ON product_modifier_groups(product_id);

CREATE INDEX IF NOT EXISTS idx_product_modifier_groups_group_id 
    ON product_modifier_groups(group_id);

DO $$ 
BEGIN
    RAISE NOTICE 'Foreign key constraint cleanup completed successfully';
END $$;

COMMIT;