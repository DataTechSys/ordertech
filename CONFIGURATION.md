# 🚀 OrderTech Configuration System - Quick Reference

This system ensures **consistent, validated startup** for OrderTech across all development sessions.

## 🎯 Key Benefits

✅ **No more port confusion** (strict 8080 for server, 6555 for DB)  
✅ **Cloud SQL proxy only** (local PostgreSQL completely disabled)  
✅ **Auto-service discovery** (all monitoring services configured automatically)  
✅ **Environment validation** (catches issues before startup)  
✅ **Consistent addresses** (no mixing local/production endpoints)  

## 🚀 Quick Start Commands

```bash
# Start OrderTech (recommended)
node start.js

# Or with full path
node scripts/start-ordertech.js

# View configuration
node start.js --config

# Validate without starting  
node start.js --validate
```

## 🔧 Fixed Architecture

### Server Configuration
- **Main API**: `http://localhost:8080`
- **Admin Dashboard**: `http://localhost:8080/admin`
- **Monitoring Dashboard**: `http://localhost:8080/server`
- **Health Check**: `http://localhost:8080/health`

### Database Strategy
- **Method**: Cloud SQL Proxy ONLY
- **Local Connection**: `127.0.0.1:6555`
- **Cloud Instance**: `smart-order-469705:me-central1:ordertech-db`
- **Local PostgreSQL**: 🗑️ **COMPLETELY REMOVED** (freed ~140MB disk space)
- **Port 5432**: ❌ **FORBIDDEN** (reserved but unused)

### Service Ports (Standardized)
```
🖥️  8080  →  OrderTech API Server
💾 6555  →  Cloud SQL Proxy  
📦 6379  →  Redis
🗄️  9000  →  MinIO API
🖥️  9001  →  MinIO Console

❌ FORBIDDEN PORTS:
   3000  →  Old default port
   3001  →  Old dashboard server  
   5432  →  Local PostgreSQL
```

### Monitored Services (Auto-configured)

**Local Development:**
- Express API Server (`127.0.0.1:8080`)
- Cloud SQL Proxy (`127.0.0.1:6555`) 
- Redis (`127.0.0.1:6379`)
- MinIO API (`127.0.0.1:9000`)
- MinIO Console (`127.0.0.1:9001`)
- Docker daemon

**Production Cloud:**
- Cloud Run (`ordertech-715493130630.me-central1.run.app`)
- Cloud SQL Database (via proxy)
- Cloud Storage (`ordertech.me`)
- LiveKit on Cloud Run

**Global Services:**
- OpenAI API (authenticated)
- OrderTech Website (`ordertech.me`)
- Firebase Admin

## 🔒 Environment Requirements

Required in `.env.local`:
```bash
PORT=8080                 # Server port (enforced)
DB_HOST=127.0.0.1        # Proxy host
DB_PORT=6555             # Proxy port  
DB_USER=ordertech        # Database user
DB_PASSWORD=Ordertech.2020   # Database password
DB_NAME=ordertech        # Database name
OPENAI_API_KEY=sk-...    # OpenAI token
```

## 📋 What Happens on Startup

1. **🔍 Configuration Load** - Parses `config/ordertech-config.json`
2. **✅ Environment Validation** - Checks all required variables  
3. **🔒 Strict Mode Enforcement** - Validates ports, services
4. **🔌 Prerequisites Check** - Ensures Cloud SQL Proxy running
5. **🚀 Server Start** - Launches on port 8080 with validation
6. **💚 Health Verification** - Confirms server responds
7. **🔄 Auto-sync Services** - Populates monitoring database

## 🚨 Troubleshooting

### Port Conflicts
```bash
# Check forbidden ports
lsof -i :3000 :3001 :5432

# Kill old servers
pkill -f "node server.js"
```

### Database Issues  
```bash
# Verify Cloud SQL Proxy
lsof -i :6555

# Start if needed
cloud-sql-proxy smart-order-469705:me-central1:ordertech-db --port=6555
```

### Configuration Problems
```bash
# Full validation
node start.js --validate

# View current config  
node start.js --config
```

## 📁 Configuration Files

- **`config/ordertech-config.json`** - Master configuration
- **`config/config-loader.js`** - Configuration validator  
- **`scripts/start-ordertech.js`** - Smart startup script
- **`start.js`** - Simple wrapper (use this!)

## ✨ Success Indicators

When startup completes successfully:
```
✅ OrderTech config loaded (v1.0.0)
✅ Environment variables validated  
✅ Cloud SQL Proxy is running
🚀 Starting OrderTech server on port 8080...
✅ OrderTech server is running and healthy!
🔄 Auto-syncing services to database...
✅ Services synced to monitoring database

📋 Quick Access:
   🖥️  Admin Dashboard: http://localhost:8080/admin
   📊 Monitoring Dashboard: http://localhost:8080/server  
   🔍 Health Check: http://localhost:8080/health
   🔧 API Base: http://localhost:8080/api
```

## 🔄 Auto-Start Services (After Mac Restart)

After restarting your Mac, **services won't start automatically**. Here are your options:

### 🚀 Option 1: Manual Start (Recommended for testing)
```bash
# Start all required services
./scripts/auto-start-services.sh

# Then start OrderTech
node start.js
```

### ⚙️ Option 2: Auto-Start on Login (For daily use)
```bash
# Enable auto-start (services start when you log in)
./scripts/setup-auto-start.sh enable

# Check status
./scripts/setup-auto-start.sh status

# Disable if needed
./scripts/setup-auto-start.sh disable
```

**What gets auto-started:**
- 🖥️ Docker Desktop (if not running)
- 💾 Cloud SQL Proxy (port 6555)
- 📦 Redis (port 6379) 
- 🗄️ MinIO container (ports 9000/9001)

### 🔍 Service Status Check
```bash
# Quick status of all services
./scripts/auto-start-services.sh

# Test auto-start script
./scripts/setup-auto-start.sh test
```

## 🎯 Next Session

For future development sessions:

**If auto-start is enabled:**
1. Log in to macOS (services start automatically)
2. Run `node start.js`
3. ✅ Everything configured automatically!

**If auto-start is disabled:**
1. Run `./scripts/auto-start-services.sh`
2. Run `node start.js` 
3. ✅ Everything configured automatically!

**No more manual port configuration or service setup needed!** 🎉
