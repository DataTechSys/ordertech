-- scripts/sql/structural_diff.sql — read-only structural comparison for duplicate tables
-- Safe: SELECT-only

-- 1) Columns for tables that exist in more than one of the target schemas
with dups as (
  select lower(t.table_name) as table_name
  from information_schema.tables t
  where t.table_type='BASE TABLE'
    and t.table_schema in ('public','saas','catalog','audit','media')
  group by lower(t.table_name)
  having count(*) > 1
)
select d.table_name,
       c.table_schema,
       c.column_name,
       c.ordinal_position,
       c.data_type,
       c.is_nullable,
       c.column_default
from dups d
join information_schema.columns c
  on lower(c.table_name)=d.table_name
 and c.table_schema in ('public','saas','catalog','audit','media')
order by d.table_name, c.table_schema, c.ordinal_position;

-- 2) Primary key columns for duplicates
select n.nspname as schema,
       c.relname as table,
       con.conname as pk_name,
       string_agg(a.attname, ', ' order by a.attnum) as pk_cols
from pg_constraint con
join pg_class c on c.oid=con.conrelid
join pg_namespace n on n.oid=c.relnamespace
join unnest(con.conkey) with ordinality as k(attnum, ord) on true
join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum
where con.contype='p'
  and n.nspname in ('public','saas','catalog','audit','media')
  and exists (
    select 1
    from information_schema.tables t
    where t.table_type='BASE TABLE'
      and t.table_schema in ('public','saas','catalog','audit','media')
      and lower(t.table_name)=lower(c.relname)
    group by lower(t.table_name)
    having count(*)>1
  )
group by 1,2,3
order by 2,1;

-- 3) Index counts (sanity) for the duplicates
select n.nspname as schema,
       c.relname as table,
       count(*) filter (where i.indisprimary) as pk_indexes,
       count(*) filter (where not i.indisprimary) as non_pk_indexes
from pg_index i
join pg_class c on c.oid=i.indrelid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname in ('public','saas','catalog','audit','media')
  and exists (
    select 1
    from information_schema.tables t
    where t.table_type='BASE TABLE'
      and t.table_schema in ('public','saas','catalog','audit','media')
      and lower(t.table_name)=lower(c.relname)
    group by lower(t.table_name)
    having count(*)>1
  )
group by 1,2
order by 2,1;
