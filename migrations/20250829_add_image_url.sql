-- Add image_url to products for serving remote image links in API
ALTER TABLE IF EXISTS products
  ADD COLUMN IF NOT EXISTS image_url text;

