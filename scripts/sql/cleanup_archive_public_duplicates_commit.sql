-- scripts/sql/cleanup_archive_public_duplicates_commit.sql — archive-first cleanup (APPLY)
-- This script moves overlapping public.* tables to archive with a timestamped name and COMMITs.
-- No drops. Fully reversible by moving tables back from archive.
--
-- Usage:
--   ts=$(date -u +%Y%m%d%H%M%S)
--   psql -v ts="$ts" -f scripts/sql/cleanup_archive_public_duplicates_commit.sql

\set ON_ERROR_STOP on

begin;
set lock_timeout = '5s';
set statement_timeout = '60s';
create schema if not exists archive;

select current_database() as db, current_user as role, current_setting('search_path', true) as search_path;
select :'ts' as ts;

-- Tenants
select 'alter table public.tenants set schema archive; alter table archive.tenants rename to public__tenants__' || :'ts' as cmd
where to_regclass('public.tenants') is not null;\gexec

-- Branches
select 'alter table public.branches set schema archive; alter table archive.branches rename to public__branches__' || :'ts' as cmd
where to_regclass('public.branches') is not null;\gexec

-- Users
select 'alter table public.users set schema archive; alter table archive.users rename to public__users__' || :'ts' as cmd
where to_regclass('public.users') is not null;\gexec

-- Roles
select 'alter table public.roles set schema archive; alter table archive.roles rename to public__roles__' || :'ts' as cmd
where to_regclass('public.roles') is not null;\gexec

-- Permissions
select 'alter table public.permissions set schema archive; alter table archive.permissions rename to public__permissions__' || :'ts' as cmd
where to_regclass('public.permissions') is not null;\gexec

-- Role permissions
select 'alter table public.role_permissions set schema archive; alter table archive.role_permissions rename to public__role_permissions__' || :'ts' as cmd
where to_regclass('public.role_permissions') is not null;\gexec

-- Devices
select 'alter table public.devices set schema archive; alter table archive.devices rename to public__devices__' || :'ts' as cmd
where to_regclass('public.devices') is not null;\gexec

-- Subscriptions
select 'alter table public.subscriptions set schema archive; alter table archive.subscriptions rename to public__subscriptions__' || :'ts' as cmd
where to_regclass('public.subscriptions') is not null;\gexec

-- Audit logs
select 'alter table public.audit_logs set schema archive; alter table archive.audit_logs rename to public__audit_logs__' || :'ts' as cmd
where to_regclass('public.audit_logs') is not null;\gexec

commit;

-- Verification
select n.nspname as schema, c.relname as archived
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='archive'
  and (c.relname like 'public__tenants__%'
       or c.relname like 'public__branches__%'
       or c.relname like 'public__users__%'
       or c.relname like 'public__roles__%'
       or c.relname like 'public__permissions__%'
       or c.relname like 'public__role_permissions__%'
       or c.relname like 'public__devices__%'
       or c.relname like 'public__subscriptions__%'
       or c.relname like 'public__audit_logs__%')
order by archived;
