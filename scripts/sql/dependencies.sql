-- scripts/sql/dependencies.sql — read-only discovery of references to public duplicates
-- Safe: SELECT-only

-- 1) Views/materialized views referencing public.* duplicate tables
select distinct n.nspname as schema,
       c.relkind,
       c.relname as object_name,
       pg_get_viewdef(c.oid, true) as definition
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname not in ('pg_catalog','information_schema')
  and c.relkind in ('v','m')
  and pg_get_viewdef(c.oid, true) ~* (
    'public\.(tenants|branches|users|roles|permissions|role_permissions|devices|subscriptions|audit_logs|categories|products)'
  )
order by 1,3;

-- 2) Functions/procedures referencing public.* duplicate tables
select n.nspname as schema,
       p.proname as function_name,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid=p.pronamespace
where n.nspname not in ('pg_catalog','information_schema')
  and pg_get_functiondef(p.oid) ~* (
    'public\.(tenants|branches|users|roles|permissions|role_permissions|devices|subscriptions|audit_logs|categories|products)'
  )
order by 1,2;

-- 3) Foreign keys referencing public.* duplicates (incoming references)
select tc.table_schema,
       tc.table_name,
       kcu.column_name,
       ccu.table_schema as foreign_table_schema,
       ccu.table_name   as foreign_table_name,
       ccu.column_name  as foreign_column_name
from information_schema.table_constraints tc
join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema   = kcu.table_schema
join information_schema.constraint_column_usage ccu
  on ccu.constraint_name = tc.constraint_name
 and ccu.table_schema   = tc.table_schema
where tc.constraint_type = 'FOREIGN KEY'
  and ccu.table_schema='public'
  and ccu.table_name in (
    'tenants','branches','users','roles','permissions','role_permissions','devices','subscriptions','audit_logs','categories','products'
  )
order by 1,2,3;