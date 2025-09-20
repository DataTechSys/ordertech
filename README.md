# OrderTech

## Google Cloud Storage (assets) — CORS & IAM

We use a Google Cloud Storage bucket (default from `ASSETS_BUCKET`, falling back to `ordertech.me`) to host tenant UI assets like logos and product images.

CORS policy JSON lives at `infra/gcs-cors.json`.

### Prerequisites
- gsutil installed (via the Google Cloud SDK)
- Authenticated with permissions to manage the bucket (e.g., `gcloud auth login`)
- `ASSETS_BUCKET` exported in your shell (optional if using the default)

### Apply CORS and manage public-read
Use the helper script:

```bash
# set a bucket (optional if using default)
export ASSETS_BUCKET=ordertech.me

# apply CORS from infra/gcs-cors.json
scripts/apply_gcs_config.sh --apply-cors

# grant public read of objects (for public asset URLs)
scripts/apply_gcs_config.sh --set-public-read

# revoke public read if needed	scripts/apply_gcs_config.sh --revoke-public-read

# verify current settings
scripts/apply_gcs_config.sh --verify

# override bucket or CORS file explicitly
scripts/apply_gcs_config.sh --bucket my-bucket --cors-file infra/gcs-cors.json --apply-cors
```

Notes:
- Public read is optional; for private assets use backend-issued signed URLs instead.
- The script will back up the current CORS configuration to `infra/gcs-cors.backup.<timestamp>.json` before applying a new one.
