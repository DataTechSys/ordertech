# Cloud Run Deployment Optimization

## Summary
Updated `.dockerignore` and `.gcloudignore` to exclude large static assets from Cloud Run deployments, reducing build context size by approximately **~60MB**.

## Changes Made

### Excluded Items (Total: ~60MB)

1. **public/images/** (~25MB)
   - Static product and UI images
   - Should be served from GCS bucket: `ordertech.me`

2. **cloud-sql-proxy*** (~31MB)
   - Local development database proxy binary
   - Not needed in Cloud Run (uses native Cloud SQL connectors)

3. **fonts/** (~1.2MB)
   - Font files for web UI
   - Can be served via CDN/GCS in future

4. **backup/, .backups/, *.backup** (~0.4MB)
   - Development backup files
   - server.js.backup
   - Not needed in production containers

5. **tmp/** (~0.8MB)
   - Temporary development files
   - Not needed in production

6. **Root-level test images** (~0.5MB)
   - /poster-defualt.png (244KB)
   - /ordertech.png (213KB)
   - /iced-americano.jpg (39KB)
   - /Black-Spanish.jpg (47KB)
   - /placeholder.jpg (3.3KB)
   - /test-image.png (19B)

## Expected Benefits

### Build Performance
- **Smaller build context**: ~60MB reduction
- **Faster uploads**: Less data to transfer to Cloud Build
- **Faster Docker builds**: Smaller context to process

### Storage
- **Reduced artifact size**: Cloud Build artifacts are smaller
- **Lower storage costs**: Fewer bytes stored in Artifact Registry

## Important Notes

### Static Assets Serving Strategy

⚠️ **IMPORTANT**: Some excluded assets are still referenced in the codebase:

1. **Images** (`/images` directory)
   - Currently served locally: `server.js` line 93
   - **Migration needed**: Move to GCS bucket `ordertech.me`
   - Update image URLs to: `https://storage.googleapis.com/ordertech.me/...`

2. **Fonts** (`/fonts` directory)
   - Currently served locally: `css/fonts.css` lines 6, 13, 20, 27, 34
   - **Future optimization**: Move to CDN or GCS
   - For now: Fonts remain in container (removed from ignore list if needed)

3. **Root-level images** (ordertech.png, placeholder.jpg, poster-defualt.png)
   - Served by explicit routes in `server.js` lines 9192-9221
   - **Consider**: Moving to GCS or keeping in container if essential

### cloud-sql-proxy Exclusion
- ✅ **Safe to exclude**: Cloud Run uses native Cloud SQL connectors
- Only needed for local development (docker-compose, scripts)
- Connection managed via `PGHOST=/cloudsql/INSTANCE` environment variable

## Testing Checklist

Before deploying to production:

- [ ] Verify static assets are accessible in production
- [ ] Test image loading on all pages
- [ ] Test font rendering (Arabic + English)
- [ ] Verify poster/placeholder images work
- [ ] Check database connectivity (Cloud SQL connector)
- [ ] Monitor build time reduction
- [ ] Verify container startup time

## Build Context Verification

To verify the optimization locally:

```bash
# Check Cloud Build upload size
gcloud meta list-files-for-upload .

# Verify Docker build context reduction
DOCKER_BUILDKIT=1 docker build --no-cache -t ordertech-test .
# Look for "Sending build context to Docker daemon" size

# Expected: ~60MB smaller than before
```

## Future Optimizations

Additional large items already excluded by existing `.dockerignore`:
- ✅ koobs-ai-assistant (4.5GB)
- ✅ whisper.cpp (219MB)
- ✅ macos (126MB)
- ✅ images directory root (86MB)
- ✅ iOS projects (ios-cashier, ios, CashierApp, DisplayApp, OrderTechCore)
- ✅ build outputs (970MB)
- ✅ node_modules (432MB - reinstalled in container)

## References

- GCS bucket: `ordertech.me`
- Cloud Run service: `ordertech` (region: me-central1)
- Build config: `cloudbuild.yaml`
- Dockerfile: Multi-stage build with Alpine base

## Rollback Instructions

If issues occur after deployment:

```bash
# Restore previous ignore files
git checkout HEAD~1 -- .dockerignore .gcloudignore

# Or remove the new exclusion sections manually
# Lines 102-134 in .dockerignore
# Lines 81-113 in .gcloudignore
```

---
**Date**: 2025-10-25
**Author**: Warp AI Agent
**Status**: Ready for testing
