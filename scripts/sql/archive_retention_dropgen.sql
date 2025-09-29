-- scripts/sql/archive_retention_dropgen.sql — generate DROP statements for archive.public__* older than 90 days (dry-run output)
-- Safe: SELECT-only. Prints DROP statements you can review and execute later.
\pset format unaligned
\pset tuples_only on
with a as (
  select table_name,
         substring(table_name from '_([0-9]{8})(?:_[0-9]{6})?$') as ymd
  from information_schema.tables
  where table_schema='archive'
    and table_name like 'public__%'
),
parsed as (
  select table_name, to_date(ymd,'YYYYMMDD') as dt from a where ymd is not null
)
select 'DROP TABLE archive.'||quote_ident(table_name)||';' as drop_sql
from parsed
where dt < current_date - interval '90 days'
order by 1;
