# OrderTech Development Stack

**Option A - Stable Local Development with Cloud Integration**

This setup provides a local development environment with fixed ports, stable hostnames, and seamless integration with your Google Cloud production environment.

## 🌟 What You Get

### Fixed URLs (Never Change)
- **API**: `https://api.localhost` → Your OrderTech API (port 3000)
- **Database Admin**: `https://db.localhost` → pgAdmin connected to Cloud SQL
- **Storage Admin**: `https://storage.localhost` → MinIO console (mirrors Cloud Storage)
- **Storage API**: `https://s3.localhost` → S3-compatible endpoint for apps
- **Redis Admin**: `https://redis.localhost` → Redis Commander
- **LiveKit Admin**: `https://livekit.localhost` → LiveKit Console
- **LiveKit WebSocket**: `wss://livekit-ws.localhost` → LiveKit server

### Cloud Integration
- **Database**: Cloud SQL Proxy (6555) ↔ `smart-order-469705:me-central1:ordertech-db`
- **Storage**: MinIO locally ↔ `ordertech.me` Cloud Storage bucket
- **Deployment**: Direct deploy to `https://ordertech-715493130630.me-central1.run.app`

### Fixed Ports (No Random Assignment)
- Reverse Proxy (Caddy): 80/443
- OrderTech API: 3000
- Database Proxy: 6555 (Cloud SQL), 5432 (local Postgres)
- Redis: 6379
- MinIO: 9000 (S3 API), 9001 (Console)
- LiveKit: 7880 (HTTP/WS), 7881 (TCP), 7882 (UDP)
- Admin UIs: pgAdmin 5050, Redis Commander 8081, LiveKit Console 3001

## 🚀 Quick Start

### Prerequisites
1. **Install Docker Desktop**: https://www.docker.com/products/docker-desktop/
2. **Caddy is already installed** ✅
3. **Google Cloud SDK** (you already have this configured ✅)

### 1. Start the Development Stack
```bash
# Start all infrastructure services and reverse proxy
npm run dev:stack:start

# This will:
# - Start Redis, MinIO, pgAdmin, LiveKit, Redis Commander containers
# - Start Caddy reverse proxy with HTTPS certificates
# - Trust local certificates (you may be prompted for password)
# - Configure MinIO with local bucket
# - Check Cloud SQL Proxy status
```

### 2. Configure Environment
```bash
# Copy and edit environment file
cp dev/.env.cloud.example dev/.env.local

# Edit dev/.env.local with your actual credentials:
# - DB_PASSWORD (for Cloud SQL)
# - Firebase API keys
# - OpenAI API keys
# - Any other secrets from Google Secret Manager
```

### 3. Start Your API
```bash
# Option A: Use the new cloud-integrated script
npm run dev:api

# Option B: Use your existing scripts
npm run dev:tcp  # Uses Cloud SQL Proxy on 6555
```

### 4. Access Services
Open these URLs in your browser:
- **API**: https://api.localhost (your API must be running on port 3000)
- **Database**: https://db.localhost (pgAdmin - login: dev@ordertech.local / devpassword)
- **Storage**: https://storage.localhost (MinIO - login: ordertech-dev / ordertech-dev-secret)
- **Redis**: https://redis.localhost (Redis Commander)
- **LiveKit**: https://livekit.localhost (LiveKit Console)

## 📋 Daily Workflow

### Development Commands
```bash
# Start the stack (infrastructure + proxy)
npm run dev:stack:start

# Start your API (in another terminal)
npm run dev:api

# Sync data from production (optional)
npm run dev:sync:down

# Deploy to Cloud Run
npm run dev:deploy

# Stop everything when done
npm run dev:stack:stop
```

### Manual Commands
```bash
# View service status
docker compose ps
docker compose logs -f

# Check Caddy status
caddy admin localhost:2019

# Test endpoints
curl https://api.localhost/health
curl https://ordertech-715493130630.me-central1.run.app/health
```

## 🗄️ Database Setup

### pgAdmin Configuration
1. Go to https://db.localhost
2. Login with: `dev@ordertech.local` / `devpassword`
3. Add server connections:

**Cloud SQL (via Proxy)**
- Host: `127.0.0.1`
- Port: `6555`
- Database: `ordertech`
- Username: `ordertech`
- Password: [your Cloud SQL password]

**Local Postgres (if running)**
- Host: `127.0.0.1`
- Port: `5432`
- Database: `ordertech`
- Username: `postgres`
- Password: [your local password]

## 🗂️ Storage Setup

### MinIO Configuration
MinIO provides S3-compatible storage that mirrors your Cloud Storage bucket.

1. Access: https://storage.localhost
2. Login: `ordertech-dev` / `ordertech-dev-secret`
3. The `ordertech-local` bucket is auto-created

### Application Integration
```javascript
// Your app can switch between local and cloud storage
const storageConfig = {
  local: {
    endpoint: 's3.localhost:9000',
    accessKey: 'ordertech-dev',
    secretKey: 'ordertech-dev-secret',
    bucket: 'ordertech-local',
    useSSL: false
  },
  cloud: {
    // Use Google Cloud Storage SDK directly
    bucket: 'ordertech.me'
  }
};
```

## ☁️ Cloud Synchronization

### Pull Data from Production
```bash
# Download database dump, storage files, and list secrets
npm run dev:sync:down

# This will:
# - Dump Cloud SQL database to local file
# - Sync Cloud Storage files to local MinIO
# - Show available secrets from Secret Manager
```

### Deploy to Production
```bash
# Deploy current code to Cloud Run
npm run dev:deploy

# This will:
# - Check for uncommitted changes
# - Show deployment preview
# - Run the existing deploy-cloud-run.sh script
# - Test deployed service
# - Show comparison between local and cloud
```

## 🔐 Security & Secrets

### Environment Variables
- **dev/.env.local**: Your local development secrets (never commit)
- **dev/.env.cloud.example**: Template with placeholders (safe to commit)

### Getting Secrets from Production
```bash
# List available secrets
gcloud secrets list --filter="name~ordertech"

# Get specific secret
gcloud secrets versions access latest --secret=DATABASE_URL
gcloud secrets versions access latest --secret=OPENAI_API_KEY
```

## 🛠️ Customization

### Using Remote LiveKit Instead of Local
If you have a LiveKit VM running:

1. Edit `dev/docker-compose.yml`:
   ```yaml
   # Comment out the livekit service and its dependencies
   ```

2. Edit `dev/Caddyfile`:
   ```
   livekit-ws.localhost {
     tls internal
     reverse_proxy YOUR_LIVEKIT_VM_IP:7880
   }
   ```

3. Update `dev/.env.local`:
   ```
   LIVEKIT_URL=wss://rtc.ordertech.me
   LIVEKIT_API_KEY=your-production-key
   LIVEKIT_API_SECRET=your-production-secret
   ```

### Switching Storage Modes
Edit `dev/.env.local`:
```bash
# Use local MinIO
STORAGE_MODE=local

# Use Cloud Storage directly
STORAGE_MODE=cloud
```

## 📊 Monitoring & Debugging

### Service Health
```bash
# Check all services
docker compose ps

# View logs
docker compose logs redis
docker compose logs minio
docker compose logs livekit

# Check Caddy
caddy admin localhost:2019
```

### Port Usage
```bash
# See what's using your ports
lsof -i :3000,5050,6379,7880,8081,9000,9001

# Kill processes on specific ports
sudo lsof -ti:3000 | xargs kill
```

### Network Issues
```bash
# Test local endpoints
curl -k https://api.localhost/health
curl -k https://storage.localhost

# Test HTTPS certificates
caddy trust  # Re-trust if needed
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Your Browser                        │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTPS
┌─────────────────────────▼───────────────────────────────────┐
│                   Caddy (80/443)                           │
│  api.localhost → 127.0.0.1:3000                           │
│  db.localhost → 127.0.0.1:5050                            │
│  storage.localhost → 127.0.0.1:9001                       │
│  s3.localhost → 127.0.0.1:9000                            │
│  redis.localhost → 127.0.0.1:8081                         │
│  livekit.localhost → 127.0.0.1:3001                       │
│  livekit-ws.localhost → 127.0.0.1:7880                    │
└─────────────────────────┬───────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                Docker Compose Network                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │  Redis   │ │  MinIO   │ │ pgAdmin  │ │ LiveKit  │     │
│  │  :6379   │ │ :9000/01 │ │  :5050   │ │  :7880   │     │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘     │
└─────────────────────────────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────┐
│                  Host Services                              │
│  ┌──────────────────────┐  ┌──────────────────────────────┐│
│  │   OrderTech API      │  │    Cloud SQL Proxy           ││
│  │     :3000            │  │       :6555                  ││
│  └──────────────────────┘  └──────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
            ┌─────────────────────────────────┐
            │        Google Cloud             │
            │  ┌─────────────────────────────┐│
            │  │  Cloud Run (Production)     ││
            │  │  Cloud SQL Database         ││
            │  │  Cloud Storage              ││
            │  │  Secret Manager             ││
            │  └─────────────────────────────┘│
            └─────────────────────────────────┘
```

## 🚨 Troubleshooting

### Common Issues

**"Port already in use"**
```bash
# Find and kill the process
lsof -i :PORT_NUMBER
sudo kill -9 PID
```

**"Certificate not trusted"**
```bash
# Re-trust Caddy certificates
sudo caddy trust
# Restart your browser
```

**"Docker containers won't start"**
```bash
# Check Docker is running
docker info

# Reset containers
docker compose down -v
npm run dev:stack:start
```

**"Can't connect to Cloud SQL"**
```bash
# Check if Cloud SQL Proxy is running
lsof -i :6555
ps aux | grep cloud_sql_proxy

# Start it manually if needed
cloud_sql_proxy smart-order-469705:me-central1:ordertech-db --port 6555
```

**"API not accessible via HTTPS"**
```bash
# Make sure API is running on port 3000
lsof -i :3000

# Check Caddy configuration
caddy validate --config dev/Caddyfile
```

### Getting Help
```bash
# View all services status
docker compose ps

# Check Caddy admin interface
curl http://localhost:2019/config/

# Test direct port access
curl http://localhost:3000/health  # Direct API
curl http://localhost:9001         # Direct MinIO
```

## 🎯 What's Different from Before

### Before (Random Ports)
- API on random ports (3000, 3001, 3002...)
- Direct database connections
- Manual port management
- No unified SSL/HTTPS
- Mixed localhost URLs

### Now (Stable Stack)
- **Fixed URLs**: https://api.localhost, https://db.localhost, etc.
- **Single reverse proxy**: Caddy handles all HTTPS
- **Container orchestration**: Docker Compose manages infrastructure  
- **Cloud integration**: Easy sync and deploy
- **Development parity**: Local mirrors production

## 📁 File Structure
```
OrderTech/
├── dev/
│   ├── README.md                 # This file
│   ├── docker-compose.yml        # Infrastructure services
│   ├── Caddyfile                # Reverse proxy config
│   ├── .env.cloud.example       # Environment template
│   ├── .env.local               # Your secrets (git-ignored)
│   ├── scripts/
│   │   ├── dev-start.sh         # Start stack
│   │   ├── dev-stop.sh          # Stop stack  
│   │   ├── sync-from-cloud.sh   # Pull from production
│   │   └── deploy-to-cloud.sh   # Deploy to production
│   └── volumes/                 # Persistent data
│       ├── redis/
│       ├── minio/
│       └── pgadmin/
├── package.json                 # Updated with dev: scripts
└── [rest of your OrderTech code]
```

---

🎉 **You now have a professional-grade local development environment!**

- Fixed ports and stable URLs
- Cloud integration and data sync  
- One-command startup/shutdown
- Production deployment pipeline
- Comprehensive admin UIs