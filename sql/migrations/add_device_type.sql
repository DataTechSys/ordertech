-- Add device_type column to devices table
ALTER TABLE devices ADD COLUMN device_type VARCHAR(20);

-- Update existing devices to set their type
-- You may need to manually set the correct device_type for existing devices
-- For example:
-- UPDATE devices SET device_type = 'display' WHERE device_name LIKE '%Display%';
-- UPDATE devices SET device_type = 'pos' WHERE device_type IS NULL;
