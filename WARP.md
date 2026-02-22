# OrderTech Project - Warp Configuration

I'm working on the OrderTech Drive-Thru System project.

**Project Location**: `/Volumes/MOSAWI-T9/DATATECH/ordertech/`
**GitHub**: https://github.com/DataTechSys/ordertech (Private)

---

## ⚠️ CRITICAL RULES - READ FIRST

### Database Configuration
- **Database Engine**: MySQL 8.0 (NOT PostgreSQL!)
- **Cloud SQL Instance**: `ordertech-db` (smart-order-469705:me-central1:ordertech-db)
- **Local Connection**: Cloud SQL Proxy on port **6556** (NOT 6555)
- **Connection String**: `mysql://ordertech:Ordertech.2020@127.0.0.1:6556/ordertech`

### Region Configuration
⚠️ **ALWAYS USE `me-central1` REGION ONLY!**
- ✅ Correct: `me-central1`
- ❌ NEVER: `us-central1`, `us-east1`, `europe-west1`, or any other region
- All Cloud Run services MUST be in `me-central1`
- All Cloud SQL instances MUST be in `me-central1`
- See `REGION_CONFIG.md` for details

### Deployment Rules
- ✅ Deploy via: `./deploy-cloud-run.sh`
- ✅ Or: Cloud Build (automated via `cloudbuild.yaml`)
- ❌ NEVER: Manual `gcloud run deploy` without proper configuration

---

## Project Structure

### Backend API (Node.js/Express)
- **Location**: `/Volumes/MOSAWI-T9/DATATECH/ordertech/`
- **Main Server**: `server.js`
- **Port**: 8080 (local), 3000 (Cloud Run internal)
- **Technology Stack**:
  - Node.js 20
  - Express 5.1.0
  - MySQL 8.0 (via `mysql2` driver)
  - Socket.io for WebSocket
  - LiveKit for real-time video/audio
  - OpenAI for AI voice orders
  - Foodics v5 API integration

### iOS Drive-Thru App
- **Location**: `ios/OrderTech/` (Unified App)
- **Bundle ID**: `me.ordertech.app`
- **Technology**: Swift, SwiftUI, LiveKit, WebRTC
- **Modes**:
  - **Display Mode** (default): Drive-thru display device
  - **Remote Control Mode**: Control remote displays
- **Features**:
  - Video streaming (cashier ↔ customer)
  - Order basket management
  - Product catalog
  - Device activation & pairing
  - External display support

### Legacy iOS Apps (Being Deprecated)
- `ios/V-Drive/` - Original display app
- `ios/V-Cashier/` - Original cashier app

---

## Google Cloud Platform (GCP) Infrastructure

### Project Details
- **GCP Project ID**: `smart-order-469705`
- **Region**: `me-central1` (⚠️ CRITICAL - NEVER change)

### Cloud Run Services

#### Main API Service
- **Service Name**: `ordertech`
- **URL**: `https://ordertech-715493130630.me-central1.run.app`
- **Region**: `me-central1`
- **Port**: 3000 (internal)
- **Timeout**: 3600s
- **Memory**: 2Gi
- **CPU**: 2
- **Instances**: Min 1, Max 10

#### Domain Mappings
- `app.ordertech.me` → Main application
- `foodics.ordertech.me` → Foodics dashboard subdomain
- `ordertech.me` → Main website

#### Cloud Run Jobs
- `migrate-ordertech` - Database migrations

### Cloud Storage
- **Bucket**: `ordertech.me`
- **Purpose**: Tenant UI assets (logos, product images)
- **CORS Config**: `infra/gcs-cors.json`
- **Access**: Public read or signed URLs

### Cloud SQL Database

#### Production Instance
- **Instance Name**: `ordertech-db`
- **Connection Name**: `smart-order-469705:me-central1:ordertech-db`
- **Engine**: **MySQL 8.0**
- **Region**: `me-central1`
- **Database Name**: `ordertech`
- **Username**: `ordertech`
- **Password**: `Ordertech.2020` (stored in Secret Manager as `DATABASE_URL`)

#### Local Development Connection
- **Method**: Cloud SQL Proxy ONLY
- **Proxy Port**: **6556** (MySQL proxy port)
- **Connection**: `127.0.0.1:6556`
- **Connection String**: `mysql://ordertech:Ordertech.2020@127.0.0.1:6556/ordertech`

⚠️ **Important**: Local PostgreSQL is NOT used. All database connections go through Cloud SQL Proxy.

---

## Local Development Setup

### Required Services & Ports

#### Active Ports
```
8080  → OrderTech API Server (main)
6556  → Cloud SQL Proxy (MySQL database)
6379  → Redis (cache/sessions)
9000  → MinIO API (S3-compatible storage)
9001  → MinIO Console (web UI)
```

#### Forbidden Ports (Deprecated)
```
3000  → Old default port (do not use)
3001  → Old dashboard server (now integrated)
5432  → PostgreSQL (NOT USED - this project uses MySQL)
6555  → Wrong proxy port (use 6556 for MySQL)
```

### Startup Sequence

#### 1. Start Cloud SQL Proxy
```bash
# Start MySQL Cloud SQL Proxy on port 6556
cloud-sql-proxy smart-order-469705:me-central1:ordertech-db --port=6556
```

#### 2. Start Docker Services
```bash
cd dev
docker compose up -d
```

This starts:
- Redis (6379)
- MinIO (9000/9001)
- pgAdmin (5050) - for reference only

#### 3. Start OrderTech Server
```bash
# Recommended: Use startup script
node start.js

# Or: Use startup helper
node scripts/start-ordertech.js

# Or: Manual start with environment
DATABASE_URL="mysql://ordertech:Ordertech.2020@127.0.0.1:6556/ordertech" \
NODE_ENV=development \
PORT=8080 \
node server.js
```

### Access Points

#### Local Development
- **Main API**: `http://localhost:8080`
- **Admin Dashboard**: `http://localhost:8080/admin`
- **Monitoring Dashboard**: `http://localhost:8080/server`
- **Health Check**: `http://localhost:8080/health`
- **API Base**: `http://localhost:8080/api`
- **MinIO Console**: `http://localhost:9001`
- **Redis Commander**: `http://localhost:8081`

#### Production
- **Main API**: `https://ordertech-715493130630.me-central1.run.app`
- **Website**: `https://ordertech.me`
- **Admin**: `https://app.ordertech.me/admin`
- **Foodics Dashboard**: `https://foodics.ordertech.me`

---

## External Integrations

### Foodics POS System
- **API Base**: `https://api.foodics.com/v5`
- **Token**: Stored in Secret Manager (`FOODICS_TOKEN`)
- **Features**: 
  - Product/menu sync
  - Order sync
  - Modifiers sync
  - Sales import
- **Sync Schedule**: Cloud Scheduler runs 4x daily (00:00, 06:00, 12:00, 18:00 AST)

### OpenAI
- **API Key**: Stored in Secret Manager (`openai-api-key`)
- **Assistant ID**: Stored in Secret Manager (`openai-assistant-id`)
- **Features**:
  - Voice-to-text orders (drive-thru)
  - Text-to-speech responses
  - AI order assistant
- **Service**: `openai-tts-service.js`

### LiveKit (Real-Time Communication)
- **API Key**: Stored in Secret Manager (`livekit-api-key`)
- **API Secret**: Stored in Secret Manager (`livekit-api-secret`)
- **Purpose**: Video/audio streaming for drive-thru
- **Integration**: Runs on Cloud Run

### Firebase
- **Project**: `smart-order-469705`
- **Purpose**: Authentication (Firebase Admin SDK)
- **Used For**: Admin panel authentication

---

## Deployment

### Build & Deploy Process

#### 1. Deploy via Script (Recommended)
```bash
./deploy-cloud-run.sh
```

#### 2. Cloud Build (Automated)
```bash
gcloud builds submit --config=cloudbuild.yaml
```

The `cloudbuild.yaml` pipeline:
1. Validates region is `me-central1`
2. Checks build context size
3. Pulls cache image
4. Builds Docker image with cache
5. Pushes to Artifact Registry
6. Creates/updates migration job
7. Runs database migrations
8. Deploys to Cloud Run

#### 3. Manual Deploy (Not Recommended)
```bash
gcloud run deploy ordertech \
  --source . \
  --region me-central1 \
  --allow-unauthenticated
```

### Environment Variables (Production)

Set via Secret Manager:
- `DATABASE_URL` - MySQL connection string
- `LIVEKIT_API_KEY` - LiveKit authentication
- `LIVEKIT_API_SECRET` - LiveKit authentication
- `OPENAI_API_KEY` - OpenAI API access
- `OPENAI_ASSISTANT_ID` - OpenAI Assistant ID
- `FOODICS_API_TOKEN` - Foodics API access

Set via environment:
- `ASSETS_BUCKET=ordertech.me`
- `TENANTS_UI_BASE=https://storage.googleapis.com/ordertech.me/tenants/`
- `NODE_ENV=production`
- `PORT=3000` (internal)
- `ENCRYPTION_KEY` (for data encryption)

---

## Database Schema

### Multi-Tenant Tables
- `tenants` - Tenant organizations
- `tenant_users` - User-tenant relationships
- `tenant_domains` - Domain mappings (e.g., subdomain.ordertech.me)
- `tenant_settings` - Tenant-specific configuration
- `tenant_brand` - Branding assets per tenant

### Catalog & Orders
- `categories` - Menu categories
- `products` - Menu items/products
- `orders` - Customer orders
- `order_items` - Order line items
- `product_modifiers` - Product customization options

### Devices & Activation
- `devices` - Drive-thru devices (displays, cashiers)
- `device_activation_codes` - Activation codes for device pairing
- `branches` - Physical locations/branches

### Analytics
- `customer_analytics` - Customer RFM analysis and segmentation

### System
- `admin_activity_logs` - Platform and tenant activity logs
- `users` - User accounts

---

## Testing

### Test Tenants (Local Development)
1. **Koobs Cafe**
   - Tenant ID: `f8578f9c-782b-4d31-b04f-3b2d890c5896`
   - Foodics Account: `494675`

2. **Fouzi Cafe**
   - Tenant ID: `56ac557e-589d-4602-bc9b-946b201fb6f6`
   - Foodics Account: `532342`

### Test API Endpoints
```bash
# Health check
curl http://localhost:8080/health

# Database status
curl http://localhost:8080/dbz

# Tenant info
curl http://localhost:8080/admin/tenants/f8578f9c-782b-4d31-b04f-3b2d890c5896/public

# Products for tenant
curl http://localhost:8080/api/products?tenant_id=f8578f9c-782b-4d31-b04f-3b2d890c5896
```

---

## Key Configuration Files

### Core Files
- `server.js` - Main Express API server
- `package.json` - Dependencies and scripts
- `.env.local` - Local development environment variables
- `config/ordertech-config.json` - Unified configuration

### Deployment Files
- `cloudbuild.yaml` - CI/CD pipeline for Cloud Build
- `Dockerfile` - Multi-stage Docker build
- `deploy-cloud-run.sh` - Deployment helper script
- `.dockerignore` - Files excluded from Docker build

### Documentation
- `README.md` - Project overview
- `CONFIGURATION.md` - Configuration system guide
- `DEPLOYMENT_GUIDE.md` - Detailed deployment instructions
- `REGION_CONFIG.md` - Critical region configuration rules
- `START_SERVER.md` - Server startup guide
- `QUICK_START_GUIDE.md` - Quick reference

### Infrastructure
- `infra/gcs-cors.json` - Cloud Storage CORS configuration
- `scripts/apply_gcs_config.sh` - GCS configuration helper
- `migrations/*.sql` - Database migration files

---

## iOS Development

### Building the iOS App

#### Prerequisites
- Xcode 14.0+
- iOS 16.0+ deployment target
- XcodeGen 2.38.0+
- Development Team: `587PC6459F`

#### Build Steps
```bash
# Navigate to iOS project
cd ios/OrderTech

# Generate Xcode project
xcodegen generate

# Open workspace
open ../OrderTech.xcworkspace

# Build in Xcode (Cmd+R)
```

### iOS Configuration
- **API Base**: `https://ordertech.me`
- **LiveKit URL**: `https://ordertech-715493130630.me-central1.run.app`
- **WebSocket Base**: `wss://ordertech.me`

### Permissions Required
- Camera - Two-way video communication
- Microphone - Two-way audio communication
- Local Network - Device discovery via Bonjour
- Location (optional) - Improved device pairing

---

## Troubleshooting

### Database Connection Issues

#### Check Cloud SQL Proxy
```bash
# Verify proxy is running on correct port
lsof -i :6556

# If not running, start it
cloud-sql-proxy smart-order-469705:me-central1:ordertech-db --port=6556
```

#### Test Database Connection
```bash
# Test MySQL connection
mysql -h 127.0.0.1 -P 6556 -u ordertech -p ordertech
# Password: Ordertech.2020

# Inside MySQL, verify database
SHOW DATABASES;
USE ordertech;
SHOW TABLES;
```

### Port Conflicts
```bash
# Check what's using a port
lsof -i :8080

# Kill process on port
sudo lsof -ti:8080 | xargs kill

# Check all reserved ports
lsof -i :8080,6556,6379,9000,9001
```

### Server Won't Start
```bash
# Check environment variables
cat .env.local

# Verify DATABASE_URL format (should be mysql://)
echo $DATABASE_URL

# Check Node.js version
node --version  # Should be 20+

# Check for syntax errors
node --check server.js
```

### Cloud Run Deployment Issues
```bash
# Check Cloud Run service status
gcloud run services describe ordertech --region=me-central1

# View logs
gcloud logging tail "resource.type=cloud_run_revision"

# Check secrets
gcloud secrets versions access latest --secret=DATABASE_URL
```

### iOS Build Issues
```bash
# Clean build
cd ios/OrderTech
xcodegen generate
rm -rf ~/Library/Developer/Xcode/DerivedData/*

# Check dependencies
ls -la ../../OrderTechCore
```

---

## Common Commands

### Local Development
```bash
# Start all services
./scripts/auto-start-services.sh

# Start server
node start.js

# View configuration
node start.js --config

# Validate environment
node start.js --validate

# Run migrations
npm run migrate

# Seed database
npm run seed
```

### Cloud Operations
```bash
# List Cloud Run services
gcloud run services list --region=me-central1

# View service details
gcloud run services describe ordertech --region=me-central1

# View logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=ordertech" --limit=50

# Execute migration job
gcloud run jobs execute migrate-ordertech --region=me-central1 --wait

# List Cloud SQL instances
gcloud sql instances list

# Describe database instance
gcloud sql instances describe ordertech-db
```

### Database Operations
```bash
# Connect to production database via proxy
cloud-sql-proxy smart-order-469705:me-central1:ordertech-db --port=6556

# In another terminal, connect with MySQL client
mysql -h 127.0.0.1 -P 6556 -u ordertech -p ordertech

# Backup database
mysqldump -h 127.0.0.1 -P 6556 -u ordertech -p ordertech > backup.sql

# Restore database
mysql -h 127.0.0.1 -P 6556 -u ordertech -p ordertech < backup.sql
```

---

## Security Notes

### Secrets Management
- All secrets stored in Google Secret Manager
- Never commit secrets to git
- Use Secret Manager references in Cloud Run
- Local development uses `.env.local` (gitignored)

### API Security
- CORS configured for specific domains
- Firebase authentication for admin routes
- Rate limiting via `express-rate-limit`
- Helmet.js for security headers
- JWT for device authentication

### Database Security
- Cloud SQL with private IP recommended
- Access via Cloud SQL Proxy only
- Strong password required
- SSL/TLS enforced for connections

---

## Monitoring & Observability

### Health Checks
- `/health` - Simple health check
- `/readyz` - Readiness probe
- `/dbz` - Database connectivity check
- `/__health` - Alternative health endpoint

### Logging
- Cloud Logging for production
- Pino for structured logging
- Activity logs in `admin_activity_logs` table

### Monitoring Dashboard
- URL: `http://localhost:8080/server` (local)
- Shows status of:
  - Local services (Redis, MinIO, Docker)
  - Cloud services (Cloud Run, Cloud SQL, Cloud Storage)
  - Global services (OpenAI, Firebase)

---

## Important Notes

### Known Issues
⚠️ **Database Driver Mismatch**: The codebase currently imports PostgreSQL driver (`pg`) but the actual database is MySQL 8.0. This needs to be fixed by removing all PostgreSQL references and ensuring `mysql2` is used throughout.

### Migration Path
- iOS unified app (OrderTech) will replace V-Drive and V-Cashier
- Legacy apps remain for compatibility during transition
- All new features developed in OrderTech unified app

### Performance
- Cloud Run min instances: 1 (keeps service warm)
- Database connection pooling enabled
- Redis caching for frequently accessed data
- MinIO for local S3-compatible storage

---

## Support & Resources

### Documentation
- Main README: `README.md`
- Configuration: `CONFIGURATION.md`
- Deployment: `DEPLOYMENT_GUIDE.md`
- Quick Start: `QUICK_START_GUIDE.md`

### Key Contacts
- Development team on GitHub issues
- GCP Project: `smart-order-469705`

---

**Last Updated**: 2026-02-22
**Project Version**: 1.0.0
**Status**: Active Development
