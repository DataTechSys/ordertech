BEGIN;

CREATE TABLE IF NOT EXISTS webrtc_rooms (
  pair_id text PRIMARY KEY,
  offer text,
  answer text,
  ice_cashier_queued jsonb NOT NULL DEFAULT '[]'::jsonb,
  ice_display_queued jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rtc_preflight_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(tenant_id) ON DELETE CASCADE,
  device_id text,
  device_name text,
  scenario_id text,
  provider text,
  policy text,
  connect_time_ms integer,
  rtt_avg_ms integer,
  local_candidate text,
  local_protocol text,
  remote_candidate text,
  remote_protocol text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_rtc_preflight_tenant_created ON rtc_preflight_logs(tenant_id, created_at DESC);

COMMIT;
