# 🌍 REGION CONFIGURATION - CRITICAL

## ⚠️ WARNING: ALWAYS USE me-central1

**DO NOT CREATE CLOUD RUN SERVICES IN ANY OTHER REGION!**

### Current Configuration
- **Project ID:** `smart-order-469705`
- **Region:** `me-central1` ✅
- **Service Name:** `ordertech` (existing service - DO NOT CREATE NEW SERVICES)

### ❌ NEVER USE THESE REGIONS:
- ~~us-central1~~
- ~~us-east1~~
- ~~europe-west1~~
- ~~asia-southeast1~~
- ~~Any other region~~

### ✅ CORRECT Commands

#### Deploy Cloud Run Service
```bash
gcloud run deploy ordertech
  --source . \
  --region me-central1 \
  --allow-unauthenticated
```

#### Update Service Configuration  
```bash
gcloud run services update ordertech
  --region me-central1 \
  --set-env-vars "YOUR_ENV_VAR=value"
```

#### Connect to Cloud SQL
```bash
gcloud run services update ordertech \\
  --region me-central1 \\
  --add-cloudsql-instances "smart-order-469705:me-central1:your-instance-name" \\
  --set-env-vars "PGHOST=/cloudsql/smart-order-469705:me-central1:your-instance-name"
```

#### List Services (check region)
```bash
gcloud run services list --region me-central1
```

### 🚨 If You Accidentally Create in Wrong Region

**Immediately delete the wrong service:**
```bash
# List all regions to find wrong deployments
gcloud run services list

# Delete wrong region service
gcloud run services delete ordertech --region WRONG_REGION

# Redeploy in correct region
gcloud run deploy ordertech --source . --region me-central1
```

### Why me-central1?
- All existing infrastructure is in me-central1
- Database instances are in me-central1
- Consistent latency and data locality
- Cost optimization
- Simplified management

## 📋 Checklist Before Any Deployment

- [ ] Confirm region is `me-central1`
- [ ] No services exist in other regions
- [ ] All gcloud commands use `--region me-central1`
- [ ] Environment variables reference `me-central1` for Cloud SQL

**Remember: ALWAYS DOUBLE-CHECK THE REGION!**