-- scripts/sql/inventory.sql — read-only DB inventory for duplicates and counts
-- Target: database ordertech on instance smart-order-469705:me-central1:ordertech-db
-- Scope: schemas public, saas, catalog, audit, media, staging
-- Safe: SELECT-only; no writes

-- 0) Session info
select current_database() as current_database,
       current_user as current_user,
       current_setting('search_path', true) as search_path;

-- 1) Which of the target schemas exist
select nspname as schema
from pg_namespace
where nspname in ('public','saas','catalog','audit','media','staging')
order by 1;

-- 2) Table counts per schema
select table_schema,
       count(*) as tables
from information_schema.tables
where table_type='BASE TABLE'
  and table_schema in ('public','saas','catalog','audit','media','staging')
group by table_schema
order by table_schema;

-- 3) Duplicate table names across target schemas (public vs saas/catalog/audit/media)
with t as (
  select table_schema, lower(table_name) as table_name
  from information_schema.tables
  where table_type='BASE TABLE'
    and table_schema in ('public','saas','catalog','audit','media')
)
select table_name,
       array_agg(table_schema order by table_schema) as schemas,
       count(*) as copies
from t
group by table_name
having count(*) > 1
order by table_name;

-- 4) Canonical row counts (avoid referencing missing public tables)
select 'saas.tenants'        as rel, (select count(*)::bigint from saas.tenants)        as rows;
select 'saas.branches'       as rel, (select count(*)::bigint from saas.branches)       as rows;
select 'saas.users'          as rel, (select count(*)::bigint from saas.users)          as rows;
select 'saas.roles'          as rel, (select count(*)::bigint from saas.roles)          as rows;
select 'saas.permissions'    as rel, (select count(*)::bigint from saas.permissions)    as rows;
select 'saas.role_permissions' as rel, (select count(*)::bigint from saas.role_permissions) as rows;
select 'saas.devices'        as rel, (select count(*)::bigint from saas.devices)        as rows;
select 'saas.subscriptions'  as rel, (select count(*)::bigint from saas.subscriptions)  as rows;
select 'audit.audit_logs'    as rel, (select count(*)::bigint from audit.audit_logs)    as rows;
select 'catalog.categories'  as rel, (select count(*)::bigint from catalog.categories)  as rows;
select 'catalog.products'    as rel, (select count(*)::bigint from catalog.products)    as rows;

-- 5) Archived tables snapshot (public duplicates moved)
select n.nspname as schema, c.relname as archived
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='archive' and c.relname like 'public__%'
order by archived;
