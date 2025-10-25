# OrderTech Configuration Management System

This directory contains the unified configuration system for OrderTech that ensures consistency across all development sessions and eliminates port/address confusion.

## 🎯 Purpose

- **Eliminate port conflicts** and address confusion between local/production
- **Enforce strict database proxy-only** configuration (no local PostgreSQL)
- **Standardize all service ports** and endpoints
- **Provide consistent startup** across development sessions
- **Auto-sync services** to monitoring database

## 📁 Files

### `ordertech-config.json`
The master configuration file containing all service definitions, port allocations, and environment settings.

### `config-loader.js`
Configuration loader class with validation and enforcement capabilities.

### `start-ordertech.js` (in scripts/)
Smart startup script that validates environment and starts services correctly.

## 🚀 Usage

### Quick Start
```bash
# Start OrderTech with full validation
node scripts/start-ordertech.js

# Or make it executable and run directly
chmod +x scripts/start-ordertech.js
./scripts/start-ordertech.js
```

### Configuration Commands
```bash
# View current configuration
node scripts/start-ordertech.js --config

# Validate configuration without starting
node scripts/start-ordertech.js --validate

# Test configuration loader
node config/config-loader.js
```

## 🔧 Key Features

### Strict Mode Enforcement
- **Forbidden ports monitoring**: Warns if old ports (3000, 3001, 5432) are in use
- **Database proxy validation**: Ensures only Cloud SQL proxy is used
- **Environment variable validation**: Checks all required variables are set

### Service Auto-Discovery
- **Local services**: Redis, MinIO, Docker daemon
- **Cloud services**: Cloud Run, Cloud SQL, Storage, LiveKit
- **Global services**: OpenAI, Firebase, OrderTech website
- **Auto-sync to database**: Services automatically populated in monitoring DB

### Port Management
```
Reserved Ports:
├── 8080 → OrderTech Main API Server
├── 6555 → Cloud SQL Proxy  
├── 6379 → Redis
├── 9000 → MinIO API
└── 9001 → MinIO Console

Forbidden Ports:
├── 3000 → Old default (DO NOT USE)
├── 3001 → Old dashboard server (integrated)
└── 5432 → Local PostgreSQL (DISABLED)
```

## 📊 Service Configuration

### Local Services (Development)
- **Redis**: `127.0.0.1:6379` - Cache and session store
- **MinIO API**: `127.0.0.1:9000` - S3-compatible storage
- **MinIO Console**: `127.0.0.1:9001` - Admin interface
- **Docker**: Socket-based connection
- **Cloud SQL Proxy**: `127.0.0.1:6555` - ONLY database connection

### Cloud Services (Production)
- **Cloud Run**: `ordertech-715493130630.me-central1.run.app`
- **Cloud SQL**: `smart-order-469705:me-central1:ordertech-db`
- **Cloud Storage**: `ordertech.me`
- **LiveKit Cloud**: On Cloud Run instance

### Global Services
- **OpenAI API**: `api.openai.com:443` (with authentication)
- **OrderTech Website**: `ordertech.me:443`
- **Firebase**: `smart-order-469705.firebaseapp.com`

## 🔒 Database Strategy

### Cloud SQL Proxy Only
- **NO local PostgreSQL**: Completely disabled
- **Single connection method**: Cloud SQL Proxy on port 6555
- **Production database**: `smart-order-469705:me-central1:ordertech-db`
- **Credentials**: `ordertech` user with secure password

### Connection Details
```bash
Host: 127.0.0.1
Port: 6555
Database: ordertech
User: ordertech
Password: [from environment]
SSL: Handled by proxy
```

## 📋 Startup Sequence

1. **Load Configuration** - Parse and validate config file
2. **Environment Check** - Verify all required variables
3. **Prerequisites** - Ensure Cloud SQL Proxy is running
4. **Service Validation** - Check required services are available
5. **Server Start** - Launch on port 8080 with proper configuration
6. **Health Check** - Verify server responds correctly
7. **Auto-sync** - Populate monitoring database with services

## 🎮 Dashboard Access

After successful startup:
- **Admin Dashboard**: `http://localhost:8080/admin`
- **Monitoring Dashboard**: `http://localhost:8080/server`
- **Health Check**: `http://localhost:8080/health`
- **API Base**: `http://localhost:8080/api`

## ⚙️ Environment Variables

Required in `.env.local`:
```bash
PORT=8080
DB_HOST=127.0.0.1
DB_PORT=6555
DB_USER=ordertech
DB_PASSWORD=Ordertech.2020
DB_NAME=ordertech
OPENAI_API_KEY=[your-key]
```

## 🚨 Troubleshooting

### Port Conflicts
If you see port conflict errors:
```bash
# Check what's using forbidden ports
lsof -i :3000
lsof -i :3001  
lsof -i :5432

# Kill old processes
pkill -f "node server.js"
```

### Database Connection Issues
```bash
# Verify Cloud SQL Proxy is running
lsof -i :6555

# Start Cloud SQL Proxy if needed
cloud-sql-proxy smart-order-469705:me-central1:ordertech-db --port=6555
```

### Configuration Validation
```bash
# Run full validation
node scripts/start-ordertech.js --validate

# Check specific configuration
node config/config-loader.js
```

## 🔄 Updating Configuration

To add new services or change configurations:

1. Edit `config/ordertech-config.json`
2. Update service definitions in appropriate section
3. Run validation: `node scripts/start-ordertech.js --validate`
4. Restart with new config: `node scripts/start-ordertech.js`

Services will be automatically synced to the monitoring database.

## 📈 Benefits

✅ **Consistent environment** across all development sessions  
✅ **No more port conflicts** or address confusion  
✅ **Enforced database strategy** (Cloud SQL proxy only)  
✅ **Automatic service discovery** and monitoring setup  
✅ **Validation and error prevention** before startup  
✅ **Centralized configuration** management  
✅ **Documentation-driven** development