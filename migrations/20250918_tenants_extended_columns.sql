-- 20250918_tenants_extended_columns.sql — add subscription and contact fields to tenants and backfill
SET lock_timeout = '10s';
SET statement_timeout = '5min';

-- Add columns on tenants
ALTER TABLE IF EXISTS tenants
  ADD COLUMN IF NOT EXISTS subdomain    text UNIQUE,
  ADD COLUMN IF NOT EXISTS email        text,
  ADD COLUMN IF NOT EXISTS status       text NOT NULL DEFAULT 'active',  -- active|trial|suspended
  ADD COLUMN IF NOT EXISTS start_date   date,
  ADD COLUMN IF NOT EXISTS renewal_date date,
  ADD COLUMN IF NOT EXISTS plan_type    text;

-- Backfill subdomain from tenant_settings.slug
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenant_settings') THEN
    UPDATE tenants t
    SET subdomain = s.slug
    FROM tenant_settings s
    WHERE s.tenant_id = t.tenant_id AND t.subdomain IS NULL AND s.slug IS NOT NULL;
  END IF;
END$$;

-- Backfill email with first owner (do not overwrite if already set)
DO $$
DECLARE has_id boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenant_users') THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='id'
    ) INTO has_id;
    IF has_id THEN
      UPDATE tenants t
      SET email = sub.email
      FROM (
        SELECT tu.tenant_id,
               (
                 SELECT lower(u.email)
                 FROM tenant_users tu2
                 JOIN users u ON u.id = tu2.user_id
                 WHERE tu2.tenant_id = tu.tenant_id AND tu2.role::text = 'owner'
                 ORDER BY tu2.created_at ASC
                 LIMIT 1
               ) AS email
        FROM tenant_users tu
        GROUP BY tu.tenant_id
      ) sub
      WHERE t.tenant_id = sub.tenant_id AND t.email IS NULL AND sub.email IS NOT NULL;
    ELSE
      UPDATE tenants t
      SET email = sub.email
      FROM (
        SELECT tu.tenant_id,
               (
                 SELECT lower(u.email)
                 FROM tenant_users tu2
                 JOIN users u ON u.user_id = tu2.user_id
                 WHERE tu2.tenant_id = tu.tenant_id AND tu2.role::text = 'owner'
                 ORDER BY tu2.created_at ASC
                 LIMIT 1
               ) AS email
        FROM tenant_users tu
        GROUP BY tu.tenant_id
      ) sub
      WHERE t.tenant_id = sub.tenant_id AND t.email IS NULL AND sub.email IS NOT NULL;
    END IF;
  END IF;
END$$;

-- Backfill plan and dates from tenant_settings (supports both settings and features columns)
DO $$
DECLARE has_settings boolean;
DECLARE has_features boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='tenant_settings') THEN
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name='tenant_settings' AND column_name='settings'
    ) INTO has_settings;
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns WHERE table_name='tenant_settings' AND column_name='features'
    ) INTO has_features;

    IF has_settings THEN
      UPDATE tenants t
      SET plan_type    = COALESCE(sub.tier, t.plan_type),
          status       = COALESCE(sub.status, t.status),
          start_date   = COALESCE(sub.started_at, t.start_date),
          renewal_date = COALESCE(sub.renewal_date, t.renewal_date)
      FROM (
        SELECT ts.tenant_id,
               (ts.settings->'features'->'subscription'->>'tier') AS tier,
               CASE
                 WHEN (ts.settings->'features'->'subscription'->>'tier') = 'trial'
                      AND NULLIF(ts.settings->'features'->'subscription'->>'trial_ends_at','')::timestamptz > now()
                   THEN 'trial'
                 ELSE 'active'
               END AS status,
               NULLIF(ts.settings->'features'->'subscription'->>'started_at','')::date AS started_at,
               NULLIF(ts.settings->'features'->'subscription'->>'renewal_date','')::date AS renewal_date
        FROM tenant_settings ts
      ) sub
      WHERE t.tenant_id = sub.tenant_id;
    ELSIF has_features THEN
      UPDATE tenants t
      SET plan_type    = COALESCE(sub.tier, t.plan_type),
          status       = COALESCE(sub.status, t.status),
          start_date   = COALESCE(sub.started_at, t.start_date),
          renewal_date = COALESCE(sub.renewal_date, t.renewal_date)
      FROM (
        SELECT ts.tenant_id,
               (ts.features->'subscription'->>'tier') AS tier,
               CASE
                 WHEN (ts.features->'subscription'->>'tier') = 'trial'
                      AND NULLIF(ts.features->'subscription'->>'trial_ends_at','')::timestamptz > now()
                   THEN 'trial'
                 ELSE 'active'
               END AS status,
               NULLIF(ts.features->'subscription'->>'started_at','')::date AS started_at,
               NULLIF(ts.features->'subscription'->>'renewal_date','')::date AS renewal_date
        FROM tenant_settings ts
      ) sub
      WHERE t.tenant_id = sub.tenant_id;
    END IF;
  END IF;
END$$;
