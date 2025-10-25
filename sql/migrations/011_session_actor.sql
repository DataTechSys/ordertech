-- Migration: 011_session_actor.sql
-- Purpose: Add helper to set current actor (user) in session for auditing version updates

CREATE OR REPLACE FUNCTION util.set_actor(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM set_config('app.user_id', COALESCE(p_user_id::text, ''), true);
END $$;
