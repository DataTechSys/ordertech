-- Fix: Set company_id for Koobs tenant in production database
-- This tenant has the company_id in the sidebar but not in the database

UPDATE tenants 
SET company_id = '494675' 
WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896' 
  AND (company_id IS NULL OR company_id = '');

-- Verify the update
SELECT tenant_id, company_id, company_name 
FROM tenants 
WHERE tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896';
