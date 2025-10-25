-- 20250915_defer_activation_until_device_requests.sql — make activated_at nullable and remove defaults
-- 1) Ensure devices.activated_at is nullable and has no default
ALTER TABLE IF EXISTS devices
  ALTER COLUMN activated_at DROP NOT NULL,
  ALTER COLUMN activated_at DROP DEFAULT;

-- 2) Optional: For any existing rows where activated_at was auto-set at creation but never used,
--    we cannot programmatically distinguish here. We leave values as-is. Future activations
--    will set activated_at at first device action (activate API or presence heartbeat).
