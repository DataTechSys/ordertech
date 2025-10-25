-- Migration: 012_media_and_storage.sql
-- Purpose: Product media (multiple images/videos with variants) and tenant storage quotas/usage tracking

-- Create media schema
CREATE SCHEMA IF NOT EXISTS media;

-- Media assets table (images/videos per product)
CREATE TABLE IF NOT EXISTS media.assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  product_id      uuid REFERENCES catalog.products(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('image','video')),
  usage           text,                     -- e.g. hero, thumbnail, detail, gallery
  format          text,                     -- e.g. jpg, webp, mp4
  bucket          text,                     -- storage bucket/container
  object_key      text,                     -- storage object key/path
  url             text,                     -- optional CDN/public URL
  bytes           bigint NOT NULL DEFAULT 0,
  width           integer,
  height          integer,
  aspect_ratio    numeric(10,5),            -- optional saved ratio
  duration_seconds numeric(10,3),           -- for videos
  checksum        text,                     -- e.g. sha256
  order_index     integer,
  tags            text[] NOT NULL DEFAULT '{}',
  published_channels text[] NOT NULL DEFAULT '{}',
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive','deleted')),
  is_primary      boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz
);

-- Only one primary media per product per tenant
CREATE UNIQUE INDEX IF NOT EXISTS ux_media_primary
  ON media.assets(tenant_id, product_id)
  WHERE is_primary;

CREATE INDEX IF NOT EXISTS ix_media_tenant_product
  ON media.assets(tenant_id, product_id, order_index NULLS LAST);

CREATE INDEX IF NOT EXISTS ix_media_kind ON media.assets(kind);
CREATE INDEX IF NOT EXISTS gin_media_tags ON media.assets USING GIN (tags);
CREATE INDEX IF NOT EXISTS gin_media_published_channels ON media.assets USING GIN (published_channels);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_media_assets_updated_at ON media.assets;
CREATE TRIGGER trg_media_assets_updated_at
BEFORE UPDATE ON media.assets
FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();

-- Media asset variants (derived sizes/aspect ratios)
CREATE TABLE IF NOT EXISTS media.asset_variants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  asset_id        uuid NOT NULL REFERENCES media.assets(id) ON DELETE CASCADE,
  variant_code    text NOT NULL,            -- e.g. 1x1, 4x3, 16x9, 800w, thumb
  format          text,
  bucket          text,
  object_key      text,
  url             text,
  bytes           bigint NOT NULL DEFAULT 0,
  width           integer,
  height          integer,
  checksum        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz,
  UNIQUE (asset_id, variant_code)
);

CREATE INDEX IF NOT EXISTS ix_media_variant_tenant_asset ON media.asset_variants(tenant_id, asset_id);

DROP TRIGGER IF EXISTS trg_media_variants_updated_at ON media.asset_variants;
CREATE TRIGGER trg_media_variants_updated_at
BEFORE UPDATE ON media.asset_variants
FOR EACH ROW EXECUTE FUNCTION util.touch_updated_at();

-- Tenant storage tracking
CREATE TABLE IF NOT EXISTS saas.tenant_storage (
  tenant_id    uuid PRIMARY KEY REFERENCES saas.tenants(tenant_id) ON DELETE RESTRICT,
  quota_bytes  bigint NOT NULL DEFAULT 0,   -- assigned quota
  used_bytes   bigint NOT NULL DEFAULT 0,   -- maintained by triggers
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Bump function: adjust used_bytes by delta, clamp at >= 0
CREATE OR REPLACE FUNCTION util.bump_tenant_storage(p_tenant_id uuid, p_delta_bytes bigint)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO saas.tenant_storage(tenant_id, quota_bytes, used_bytes, updated_at)
  VALUES (p_tenant_id, 0, GREATEST(p_delta_bytes, 0), now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET used_bytes = GREATEST(0, saas.tenant_storage.used_bytes + p_delta_bytes),
        updated_at = now();
END $$;

-- Storage delta triggers for media.assets
CREATE OR REPLACE FUNCTION media.asset_storage_delta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  delta bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := COALESCE(NEW.bytes, 0);
    PERFORM util.bump_tenant_storage(NEW.tenant_id, delta);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.tenant_id = OLD.tenant_id THEN
      delta := COALESCE(NEW.bytes, 0) - COALESCE(OLD.bytes, 0);
      IF delta <> 0 THEN
        PERFORM util.bump_tenant_storage(NEW.tenant_id, delta);
      END IF;
    ELSE
      -- Tenant moved: subtract old, add new
      PERFORM util.bump_tenant_storage(OLD.tenant_id, -COALESCE(OLD.bytes,0));
      PERFORM util.bump_tenant_storage(NEW.tenant_id,  COALESCE(NEW.bytes,0));
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    delta := -COALESCE(OLD.bytes, 0);
    PERFORM util.bump_tenant_storage(OLD.tenant_id, delta);
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_media_assets_after_insert ON media.assets;
DROP TRIGGER IF EXISTS trg_media_assets_after_update ON media.assets;
DROP TRIGGER IF EXISTS trg_media_assets_after_delete ON media.assets;
CREATE TRIGGER trg_media_assets_after_insert
AFTER INSERT ON media.assets
FOR EACH ROW EXECUTE FUNCTION media.asset_storage_delta();
CREATE TRIGGER trg_media_assets_after_update
AFTER UPDATE ON media.assets
FOR EACH ROW EXECUTE FUNCTION media.asset_storage_delta();
CREATE TRIGGER trg_media_assets_after_delete
AFTER DELETE ON media.assets
FOR EACH ROW EXECUTE FUNCTION media.asset_storage_delta();

-- Storage delta triggers for media.asset_variants
CREATE OR REPLACE FUNCTION media.asset_variant_storage_delta()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  delta bigint;
  t_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT tenant_id INTO t_id FROM media.assets WHERE id = NEW.asset_id;
    delta := COALESCE(NEW.bytes, 0);
    IF t_id IS NOT NULL THEN
      PERFORM util.bump_tenant_storage(t_id, delta);
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT tenant_id INTO t_id FROM media.assets WHERE id = NEW.asset_id;
    IF NEW.asset_id = OLD.asset_id THEN
      delta := COALESCE(NEW.bytes,0) - COALESCE(OLD.bytes,0);
      IF t_id IS NOT NULL AND delta <> 0 THEN
        PERFORM util.bump_tenant_storage(t_id, delta);
      END IF;
    ELSE
      -- Variant moved to another asset: adjust both tenants (usually same tenant)
      PERFORM util.bump_tenant_storage((SELECT tenant_id FROM media.assets WHERE id = OLD.asset_id), -COALESCE(OLD.bytes,0));
      PERFORM util.bump_tenant_storage((SELECT tenant_id FROM media.assets WHERE id = NEW.asset_id),  COALESCE(NEW.bytes,0));
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT tenant_id INTO t_id FROM media.assets WHERE id = OLD.asset_id;
    delta := -COALESCE(OLD.bytes, 0);
    IF t_id IS NOT NULL THEN
      PERFORM util.bump_tenant_storage(t_id, delta);
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_media_variants_after_insert ON media.asset_variants;
DROP TRIGGER IF EXISTS trg_media_variants_after_update ON media.asset_variants;
DROP TRIGGER IF EXISTS trg_media_variants_after_delete ON media.asset_variants;
CREATE TRIGGER trg_media_variants_after_insert
AFTER INSERT ON media.asset_variants
FOR EACH ROW EXECUTE FUNCTION media.asset_variant_storage_delta();
CREATE TRIGGER trg_media_variants_after_update
AFTER UPDATE ON media.asset_variants
FOR EACH ROW EXECUTE FUNCTION media.asset_variant_storage_delta();
CREATE TRIGGER trg_media_variants_after_delete
AFTER DELETE ON media.asset_variants
FOR EACH ROW EXECUTE FUNCTION media.asset_variant_storage_delta();

-- Enable RLS and tenant policies for media tables
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['media.assets','media.asset_variants'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format($p$
      DROP POLICY IF EXISTS tenant_isolation ON %1$s;
      CREATE POLICY tenant_isolation ON %1$s
        USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
        WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
    $p$, t);
  END LOOP;
END $$;
