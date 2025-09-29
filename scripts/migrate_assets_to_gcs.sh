#!/usr/bin/env bash
# Migrate local assets to GCS and update DB URLs to use the bucket.
# Usage: scripts/migrate_assets_to_gcs.sh
# Requirements:
# - gcloud, gsutil installed and authenticated
# - DATABASE_URL or PG* envs set (or run in a context where your app can connect)
# - psql available in PATH

set -euo pipefail

BUCKET="${ASSETS_BUCKET:-ordertech.me}"
REGION="${REGION:-me-central1}"
PROJECT_ID="${PROJECT_ID:-smart-order-469705}"

# Optional: source prod config (no secrets)
if [[ -f "config/prod.env" ]]; then
  # shellcheck disable=SC1091
  . "config/prod.env"
  BUCKET="${ASSETS_BUCKET:-$BUCKET}"
fi

echo "[assets] Using bucket: gs://${BUCKET}"

# Ensure bucket exists (idempotent)
if ! gsutil ls -b "gs://${BUCKET}" >/dev/null 2>&1; then
  echo "[assets] Creating bucket gs://${BUCKET} in ${REGION}"
  gsutil mb -l "${REGION}" -b on "gs://${BUCKET}"
fi

# Option A: make objects public (optional, comment out if you use signed URLs)
# echo "[assets] Granting allUsers objectViewer (public-read objects)"
# gsutil iam ch allUsers:objectViewer "gs://${BUCKET}" || true

# Sync local images and photos if present (idempotent; skips if directories missing)
if [[ -d images ]]; then
  echo "[assets] Syncing ./images -> gs://${BUCKET}/images"
  gsutil -m rsync -r ./images "gs://${BUCKET}/images"
fi
if [[ -d photos ]]; then
  echo "[assets] Syncing ./photos -> gs://${BUCKET}/photos"
  gsutil -m rsync -r ./photos "gs://${BUCKET}/photos"
fi
if [[ -d images/uploads ]]; then
  echo "[assets] Syncing ./images/uploads -> gs://${BUCKET}"
  gsutil -m rsync -r ./images/uploads "gs://${BUCKET}"
fi

# Apply long-lived immutable caching metadata to all objects (best-effort)
echo "[assets] Applying Cache-Control metadata"
gsutil -m setmeta -h "Cache-Control:public, max-age=31536000, immutable" "gs://${BUCKET}/**" || true

# Database URL updates
# This section assumes you have psql auth via DATABASE_URL or PG* vars.
# It rewrites any relative paths starting with images/ or photos/ to Cloud Storage URLs.

GCS_BASE="https://storage.googleapis.com/${BUCKET}/"
SQL_TMP="/tmp/ordertech_migrate_assets.sql"
cat >"${SQL_TMP}" <<'SQL'
-- Normalize local/relative URLs to GCS public URLs using :gcs_base (e.g., 'https://storage.googleapis.com/ordertech.me/')

-- Helper pattern notes:
-- 1) '^/?images/uploads/' → strip optional leading slash and 'images/uploads/' prefix (old local upload path)
-- 2) '/images/%' → drop leading slash and prepend base
-- 3) 'images/%'  → prepend base
-- 4) '/photos/%' → drop leading slash and prepend base
-- 5) 'photos/%'  → prepend base

-- products.image_url
UPDATE products SET image_url = CASE
  WHEN image_url ~ '^/?images/uploads/' THEN :gcs_base || regexp_replace(image_url, '^/?images/uploads/', '')
  WHEN image_url LIKE '/images/%'        THEN :gcs_base || substring(image_url from 2)
  WHEN image_url LIKE 'images/%'         THEN :gcs_base || image_url
  WHEN image_url LIKE '/photos/%'        THEN :gcs_base || substring(image_url from 2)
  WHEN image_url LIKE 'photos/%'         THEN :gcs_base || image_url
  ELSE image_url
END
WHERE image_url IS NOT NULL AND (
  image_url ~ '^/?images/uploads/' OR
  image_url LIKE '/images/%' OR image_url LIKE 'images/%' OR
  image_url LIKE '/photos/%' OR image_url LIKE 'photos/%'
);

-- products.image_white_url
UPDATE products SET image_white_url = CASE
  WHEN image_white_url ~ '^/?images/uploads/' THEN :gcs_base || regexp_replace(image_white_url, '^/?images/uploads/', '')
  WHEN image_white_url LIKE '/images/%'        THEN :gcs_base || substring(image_white_url from 2)
  WHEN image_white_url LIKE 'images/%'         THEN :gcs_base || image_white_url
  WHEN image_white_url LIKE '/photos/%'        THEN :gcs_base || substring(image_white_url from 2)
  WHEN image_white_url LIKE 'photos/%'         THEN :gcs_base || image_white_url
  ELSE image_white_url
END
WHERE image_white_url IS NOT NULL AND (
  image_white_url ~ '^/?images/uploads/' OR
  image_white_url LIKE '/images/%' OR image_white_url LIKE 'images/%' OR
  image_white_url LIKE '/photos/%' OR image_white_url LIKE 'photos/%'
);

-- products.image_beauty_url
UPDATE products SET image_beauty_url = CASE
  WHEN image_beauty_url ~ '^/?images/uploads/' THEN :gcs_base || regexp_replace(image_beauty_url, '^/?images/uploads/', '')
  WHEN image_beauty_url LIKE '/images/%'        THEN :gcs_base || substring(image_beauty_url from 2)
  WHEN image_beauty_url LIKE 'images/%'         THEN :gcs_base || image_beauty_url
  WHEN image_beauty_url LIKE '/photos/%'        THEN :gcs_base || substring(image_beauty_url from 2)
  WHEN image_beauty_url LIKE 'photos/%'         THEN :gcs_base || image_beauty_url
  ELSE image_beauty_url
END
WHERE image_beauty_url IS NOT NULL AND (
  image_beauty_url ~ '^/?images/uploads/' OR
  image_beauty_url LIKE '/images/%' OR image_beauty_url LIKE 'images/%' OR
  image_beauty_url LIKE '/photos/%' OR image_beauty_url LIKE 'photos/%'
);

-- categories.image_url
UPDATE categories SET image_url = CASE
  WHEN image_url ~ '^/?images/uploads/' THEN :gcs_base || regexp_replace(image_url, '^/?images/uploads/', '')
  WHEN image_url LIKE '/images/%'        THEN :gcs_base || substring(image_url from 2)
  WHEN image_url LIKE 'images/%'         THEN :gcs_base || image_url
  WHEN image_url LIKE '/photos/%'        THEN :gcs_base || substring(image_url from 2)
  WHEN image_url LIKE 'photos/%'         THEN :gcs_base || image_url
  ELSE image_url
END
WHERE image_url IS NOT NULL AND (
  image_url ~ '^/?images/uploads/' OR
  image_url LIKE '/images/%' OR image_url LIKE 'images/%' OR
  image_url LIKE '/photos/%' OR image_url LIKE 'photos/%'
);

-- tenant_brand.logo_url
UPDATE tenant_brand SET logo_url = CASE
  WHEN logo_url ~ '^/?images/uploads/' THEN :gcs_base || regexp_replace(logo_url, '^/?images/uploads/', '')
  WHEN logo_url LIKE '/images/%'        THEN :gcs_base || substring(logo_url from 2)
  WHEN logo_url LIKE 'images/%'         THEN :gcs_base || logo_url
  WHEN logo_url LIKE '/photos/%'        THEN :gcs_base || substring(logo_url from 2)
  WHEN logo_url LIKE 'photos/%'         THEN :gcs_base || logo_url
  ELSE logo_url
END
WHERE logo_url IS NOT NULL AND (
  logo_url ~ '^/?images/uploads/' OR
  logo_url LIKE '/images/%' OR logo_url LIKE 'images/%' OR
  logo_url LIKE '/photos/%' OR logo_url LIKE 'photos/%'
);

-- users.photo_url
UPDATE users SET photo_url = CASE
  WHEN photo_url ~ '^/?images/uploads/' THEN :gcs_base || regexp_replace(photo_url, '^/?images/uploads/', '')
  WHEN photo_url LIKE '/images/%'        THEN :gcs_base || substring(photo_url from 2)
  WHEN photo_url LIKE 'images/%'         THEN :gcs_base || photo_url
  WHEN photo_url LIKE '/photos/%'        THEN :gcs_base || substring(photo_url from 2)
  WHEN photo_url LIKE 'photos/%'         THEN :gcs_base || photo_url
  ELSE photo_url
END
WHERE photo_url IS NOT NULL AND (
  photo_url ~ '^/?images/uploads/' OR
  photo_url LIKE '/images/%' OR photo_url LIKE 'images/%' OR
  photo_url LIKE '/photos/%' OR photo_url LIKE 'photos/%'
);
SQL

# Run SQL with psql variable substitution
# psql doesn't support named vars directly; we use env substitution for gcs_base
export gcs_base="${GCS_BASE}"
PSQL_FILE="/tmp/ordertech_migrate_assets_expanded.sql"
# Surround substitution with single quotes to form a valid SQL string literal
sed "s#:gcs_base#'${gcs_base//\//\\/}'#g" "${SQL_TMP}" > "${PSQL_FILE}"

if command -v psql >/dev/null 2>&1; then
  echo "[assets] Applying DB URL rewrites (requires DB connectivity)"
  psql -v ON_ERROR_STOP=1 -f "${PSQL_FILE}"
else
  echo "[assets] WARNING: psql not found. Skipping DB URL rewrites."
  echo "[assets] You can run the SQL manually using your preferred client: ${PSQL_FILE}"
fi

echo "[assets] Done. Consider removing local images/, photos/, and data/ from the repo once verified."
