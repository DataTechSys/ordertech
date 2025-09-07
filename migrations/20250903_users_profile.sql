-- 20250903_users_profile.sql — add user profile fields
-- Idempotent and safe

ALTER TABLE IF EXISTS public.users
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS mobile text;
