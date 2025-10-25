-- Grant admin access to hussain@mosawi.com for Koobs tenant
-- Tenant ID: f8578f9c-782b-4d31-b04f-3b2d890c5896

-- 1. Ensure user exists in users table
INSERT INTO users (id, email, created_at) 
VALUES (gen_random_uuid(), 'hussain@mosawi.com', now()) 
ON CONFLICT (email) DO NOTHING;

-- 2. Grant admin role to user for Koobs tenant
INSERT INTO tenant_users (tenant_id, user_id, role, created_at)
SELECT 'f8578f9c-782b-4d31-b04f-3b2d890c5896', u.id, 'admin'::tenant_role, now()
FROM users u WHERE u.email = 'hussain@mosawi.com'
ON CONFLICT (tenant_id, user_id) DO UPDATE SET role = 'admin'::tenant_role;

-- 3. Verify the grant
SELECT tu.role, u.email, t.company_name FROM tenant_users tu
JOIN users u ON u.id = tu.user_id
JOIN tenants t ON t.tenant_id = tu.tenant_id
WHERE tu.tenant_id = 'f8578f9c-782b-4d31-b04f-3b2d890c5896' AND u.email = 'hussain@mosawi.com';