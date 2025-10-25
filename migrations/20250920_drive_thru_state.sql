BEGIN;

CREATE TABLE IF NOT EXISTS drive_thru_state (
  tenant_id uuid PRIMARY KEY,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMIT;
