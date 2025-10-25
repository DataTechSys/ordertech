-- SQL script to move inactive modifier groups and options to deleted status
-- This updates items by setting deleted_at timestamps

BEGIN;

-- Move inactive modifier options to deleted (where is_active = false)
UPDATE modifier_options 
SET deleted_at = NOW() 
WHERE tenant_id = '56ac557e-589d-4602-bc9b-946b201fb6f6'
  AND deleted_at IS NULL 
  AND is_active = false;

-- Get count of updated options
SELECT 'Moved inactive options to deleted:', COUNT(*) 
FROM modifier_options 
WHERE tenant_id = '56ac557e-589d-4602-bc9b-946b201fb6f6'
  AND deleted_at IS NOT NULL 
  AND is_active = false;

-- Move inactive products to deleted (where active = false)  
UPDATE products 
SET deleted_at = NOW() 
WHERE tenant_id = '56ac557e-589d-4602-bc9b-946b201fb6f6'
  AND deleted_at IS NULL 
  AND active = false;

-- Get count of updated products
SELECT 'Moved inactive products to deleted:', COUNT(*) 
FROM products 
WHERE tenant_id = '56ac557e-589d-4602-bc9b-946b201fb6f6'
  AND deleted_at IS NOT NULL 
  AND active = false;

-- Move modifier groups that are not required and have no active options to deleted
UPDATE modifier_groups 
SET deleted_at = NOW() 
WHERE tenant_id = '56ac557e-589d-4602-bc9b-946b201fb6f6'
  AND deleted_at IS NULL 
  AND (required = false OR required IS NULL)
  AND id NOT IN (
    SELECT DISTINCT group_id 
    FROM modifier_options 
    WHERE tenant_id = '56ac557e-589d-4602-bc9b-946b201fb6f6'
      AND is_active = true 
      AND deleted_at IS NULL
  );

-- Get count of updated groups  
SELECT 'Moved inactive groups to deleted:', COUNT(*) 
FROM modifier_groups 
WHERE tenant_id = '56ac557e-589d-4602-bc9b-946b201fb6f6'
  AND deleted_at IS NOT NULL 
  AND (required = false OR required IS NULL);

COMMIT;

-- Final summary queries
SELECT 
  'SUMMARY - All items (groups):' as description,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted_count,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_count
FROM modifier_groups 
WHERE tenant_id = '56ac557e-589d-4602-bc9b-946b201fb6f6';

SELECT 
  'SUMMARY - All items (options):' as description,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted_count,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_count
FROM modifier_options 
WHERE tenant_id = '56ac557e-589d-4602-bc9b-946b201fb6f6';

SELECT 
  'SUMMARY - All items (products):' as description,
  COUNT(*) as total_count,
  COUNT(*) FILTER (WHERE deleted_at IS NOT NULL) as deleted_count,
  COUNT(*) FILTER (WHERE deleted_at IS NULL) as active_count
FROM products 
WHERE tenant_id = '56ac557e-589d-4602-bc9b-946b201fb6f6';