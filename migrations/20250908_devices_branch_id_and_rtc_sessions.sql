-- 20250908_devices_branch_id_and_rtc_sessions.sql — add devices.branch_id and RTC session tables
-- Idempotent and safe for repeated runs

-- 1) Enhance devices with branch_id (FK) and optional location for richer context
ALTER TABLE IF EXISTS devices
  ADD COLUMN IF NOT EXISTS branch_id uuid;

ALTER TABLE IF EXISTS devices
  ADD COLUMN IF NOT EXISTS location text;

-- Helpful indexes for branch-based lookups
CREATE INDEX IF NOT EXISTS ix_devices_tenant_branch
  ON devices(tenant_id, branch);

CREATE INDEX IF NOT EXISTS ix_devices_tenant_branch_id
  ON devices(tenant_id, branch_id);


-- 2) RTC sessions header table
CREATE TABLE IF NOT EXISTS rtc_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  basket_id text,
  cashier_device_id uuid,
  display_device_id uuid,
  provider text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  summary jsonb
);

CREATE INDEX IF NOT EXISTS ix_rtc_sessions_tenant_started
  ON rtc_sessions(tenant_id, started_at DESC);

CREATE INDEX IF NOT EXISTS ix_rtc_sessions_basket
  ON rtc_sessions(basket_id);

CREATE INDEX IF NOT EXISTS ix_rtc_sessions_cashier_started
  ON rtc_sessions(cashier_device_id, started_at DESC);

CREATE INDEX IF NOT EXISTS ix_rtc_sessions_display_started
  ON rtc_sessions(display_device_id, started_at DESC);


-- 3) RTC session stats (time-series)
CREATE TABLE IF NOT EXISTS rtc_session_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL,
  side text NOT NULL CHECK (side IN ('cashier','display')),
  ts timestamptz NOT NULL DEFAULT now(),
  metrics jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS ix_rtc_session_stats_session_ts
  ON rtc_session_stats(session_id, ts);

